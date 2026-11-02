import type { Activity, ActivityStats, Split, HeartRateZones, DataQuality } from './types.js'
import { cumulativeDistanceSeries, continuousRanges, deviceDistanceFallback, hasPosition } from './geo.js'

// ---------------------------------------------------------------------------
// HR zone helpers
// ---------------------------------------------------------------------------

// Which reference the zone percentage is computed against. Default 'hrmax'
// reproduces the historical behaviour exactly. 'reserve' uses the Karvonen
// formula (pct = (hr - restingHR) / (maxHR - restingHR), i.e. % of heart-rate
// reserve rather than % of HRmax) — a common alternative anchor that shifts
// low-intensity samples out of z1 relative to %HRmax for the same boundaries.
export type HrZoneModel =
  | { type: 'hrmax'; boundaries?: [number, number, number, number] }
  | { type: 'reserve'; restingHR: number; boundaries?: [number, number, number, number] }

// Default boundaries reproduce the historical, hardcoded 60/70/80/90% bands
// (see metrics-spec.md §1.3: a deliberate deviation from Garmin's 50-floor
// default, kept so z1..z5 always sum to the full elapsed time).
export const DEFAULT_ZONE_BOUNDARIES: [number, number, number, number] = [0.6, 0.7, 0.8, 0.9]

function validateZoneBoundaries(boundaries: [number, number, number, number]): void {
  if (!Array.isArray(boundaries) || boundaries.length !== 4) {
    throw new Error('Invalid HR zone boundaries: expected exactly four boundaries.')
  }
  for (const b of boundaries) {
    if (!Number.isFinite(b) || !(b > 0 && b < 1)) {
      throw new Error(
        `Invalid HR zone boundaries [${boundaries.join(', ')}]: each boundary must be strictly between 0 and 1 (got ${b}).`
      )
    }
  }
  for (let i = 1; i < boundaries.length; i++) {
    if (!(boundaries[i] > boundaries[i - 1])) {
      throw new Error(
        `Invalid HR zone boundaries [${boundaries.join(', ')}]: boundaries must be strictly increasing.`
      )
    }
  }
}

// Plausible range for a *maximum* heart rate, in bpm — not a formula, just a
// screen against non-finite/nonsensical caller input (0, negative, NaN, a
// resting HR typo'd into the maxHR slot). Upper bound mirrors the ubiquitous
// age-predicted-max estimate ("220 minus your age", as published by the
// American Heart Association's target-heart-rate guidance): at age 0 that
// formula's own ceiling is 220, and this library has no infant runners.
// Lower bound is deliberately generous rather than tuned to "typical" — it
// only needs to admit every real maxHR, including heavily beta-blocked or
// elderly athletes with pronounced chronotropic incompetence during
// exercise, while still rejecting values with no physiological plausibility
// at all.
export const MIN_PLAUSIBLE_MAX_HR_BPM = 60
export const MAX_PLAUSIBLE_MAX_HR_BPM = 220

// Validates the two numbers HR zone percentages are computed *against* —
// distinct from validateZoneBoundaries, which validates the percentages
// themselves. Without this, maxHR: 0, NaN, or a negative value, and (for the
// 'reserve' model) a missing/negative/non-finite restingHR or one >= maxHR,
// each divide-by-zero or invert the pct formula silently and dump every
// segment into z1 or z5 — a confident, wrong answer, not a crash. A plain-JS
// caller gets no type error for an omitted restingHR (HrZoneModel's
// 'reserve' variant types it as required, but that's a compile-time promise
// only), so this is the only backstop.
function validateHeartRateInputs(maxHR: number, zoneModel: HrZoneModel): void {
  if (!Number.isFinite(maxHR) || maxHR < MIN_PLAUSIBLE_MAX_HR_BPM || maxHR > MAX_PLAUSIBLE_MAX_HR_BPM) {
    throw new Error(
      `Invalid maxHR: expected a finite number between ${MIN_PLAUSIBLE_MAX_HR_BPM} and ${MAX_PLAUSIBLE_MAX_HR_BPM} bpm (got ${maxHR}).`
    )
  }
  if (zoneModel.type === 'reserve') {
    const { restingHR } = zoneModel
    if (restingHR == null || !Number.isFinite(restingHR) || restingHR < 0) {
      throw new Error(
        `Invalid restingHR: expected a finite, non-negative number (got ${restingHR}).`
      )
    }
    if (restingHR >= maxHR) {
      throw new Error(
        `Invalid restingHR: must be less than maxHR (got restingHR ${restingHR}, maxHR ${maxHR}).`
      )
    }
  }
}

// Each entry is a segment: `weightSec` is the duration to attribute to the
// zone of `heartRate` (the segment's *ending* sample — see metrics-spec.md
// §1.2). A segment with no attributable duration (missing/non-monotonic
// timestamp) or no ending HR sample must carry `weightSec` / `heartRate` as
// 0 / undefined respectively so it contributes nothing.
function hrZones(
  segments: { heartRate?: number; weightSec: number }[],
  pctOf: (heartRate: number) => number,
  boundaries: [number, number, number, number]
): HeartRateZones {
  const zones: HeartRateZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  const [b1, b2, b3, b4] = boundaries

  for (const seg of segments) {
    if (seg.heartRate == null || seg.weightSec <= 0) continue
    const pct = pctOf(seg.heartRate)
    // Deliberate deviation from Garmin's 50/60/70/80/90 model: Garmin's z1
    // floor is 50% HRmax (below that is "no zone"). We have no floor — z1 is
    // "everything below the first boundary" — so that z1..z5 always sum to
    // the full elapsed time (see spec §1.3/§1.4); a floor would leave
    // below-floor samples unattributed and break that invariant.
    if (pct < b1) zones.z1 += seg.weightSec
    else if (pct < b2) zones.z2 += seg.weightSec
    else if (pct < b3) zones.z3 += seg.weightSec
    else if (pct < b4) zones.z4 += seg.weightSec
    else zones.z5 += seg.weightSec
  }

  return zones
}

// ---------------------------------------------------------------------------
// Elevation hysteresis filter (metrics-spec.md §5)
// ---------------------------------------------------------------------------

// Fallback path (§5.3 step 2). When a FIT file carries a device-computed
// session.total_ascent/total_descent, the parser surfaces it as
// Activity.deviceElevationGainM/LossM and resolveElevation() below prefers
// it over this filter (§5.3 step 1) — it is what Garmin/Strava will agree
// with and was filtered on-device. This hysteresis pass still always runs:
// splits[] need its per-point gains regardless of source, and its totals are
// the activity figures whenever no trusted device total exists (GPX and TCX
// always, FIT when the session omits the field).

// Default threshold per spec §5.3: every format this library parses is
// GPS-derived (GPX always; FIT usually, absent a device total_ascent — see
// the note above), so the 2-3m *barometric* threshold does not apply here.
// 8m sits within the GPS-derived band authoritative sources actually
// recommend (Strava ~10m for non-barometric activities, GPS Visualizer
// 6-9m). Expose it as a parameter so a caller who knows their source is
// barometric can lower it toward that 2-3m figure instead.
export const DEFAULT_ELEVATION_THRESHOLD_M = 8

// Accumulates confirmed climbs/descents only once the *cumulative* rise from
// the last confirmed reference point clears `thresholdM`, rejecting
// oscillation within the noise band. Returns, per point, the confirmed
// gain/loss amount attributed to that point (its "ending point", consistent
// with the same convention used for HR zones and splits) so callers can slice
// the totals by distance range without re-running the filter.
function elevationHysteresis(
  points: { elevation?: number; segmentStart?: boolean }[],
  thresholdM: number
): { gainAtPoint: number[]; lossAtPoint: number[]; totalGainM: number; totalLossM: number } {
  const gainAtPoint = new Array(points.length).fill(0)
  const lossAtPoint = new Array(points.length).fill(0)
  let ref: number | null = null
  let totalGainM = 0
  let totalLossM = 0

  for (let i = 0; i < points.length; i++) {
    if (points[i].segmentStart) ref = null
    const ele = points[i].elevation
    if (ele == null) continue
    if (ref == null) { ref = ele; continue }

    const diff = ele - ref
    if (diff >= thresholdM) {
      gainAtPoint[i] = diff
      totalGainM += diff
      ref = ele
    } else if (-diff >= thresholdM) {
      lossAtPoint[i] = -diff
      totalLossM += -diff
      ref = ele
    }
    // else: within the noise band — ignore, keep ref
  }

  return { gainAtPoint, lossAtPoint, totalGainM, totalLossM }
}

// ---------------------------------------------------------------------------
// Cumulative-series helpers (metrics-spec.md §2.3 / §4.2)
// ---------------------------------------------------------------------------

// Elapsed time at cumulative distance `x`, linearly interpolated within the
// segment that contains it. `cumDist`/`cumTime` must be non-decreasing and
// the same length, with index 0 = the activity's start (0, 0).
function timeAt(
  x: number, cumDist: number[], cumTime: number[],
  edge: 'split' | 'arrival' | 'departure' = 'split',
): number {
  const n = cumDist.length
  // Splits retain the activity's initial/final stationary time. Best efforts
  // start at departure and end at arrival, excluding pauses outside the effort.
  if (edge === 'split') {
    if (x <= cumDist[0]) return cumTime[0]
    if (x >= cumDist[n - 1]) return cumTime[n - 1]
  }

  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumDist[mid] < x || (edge === 'departure' && cumDist[mid] === x)) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return cumTime[0]
  if (lo === n) return cumTime[n - 1]
  const segLen = cumDist[lo] - cumDist[lo - 1]
  const f = segLen > 0 ? (x - cumDist[lo - 1]) / segLen : 0
  return cumTime[lo - 1] + f * (cumTime[lo] - cumTime[lo - 1])
}

// Fastest 1000m window anywhere in the activity (metrics-spec.md §2), found
// by scanning the finite candidate set of breakpoints where a window edge
// coincides with a recorded point — the minimum of the continuous
// timeAt(s+1000) - timeAt(s) function is always attained at one of these, so
// a continuous scan isn't needed. Computed from the cumulative series only
// — independent of splits[] (§2.4) — so it can be faster than (never slower
// than) the fastest full split, since it isn't quantised to km marks.
function computeBestKmPaceSecPerKm(cumDist: number[], cumTime: number[]): number | null {
  const total = cumDist[cumDist.length - 1]
  if (total < 1000) return null

  const candidates = new Set<number>([0, total - 1000])
  for (const d of cumDist) {
    if (d + 1000 <= total) candidates.add(d)
    if (d - 1000 >= 0) candidates.add(d - 1000)
  }

  let best = Infinity
  for (const s of candidates) {
    const windowTime = timeAt(s + 1000, cumDist, cumTime, 'arrival')
      - timeAt(s, cumDist, cumTime, 'departure')
    if (windowTime < best) best = windowTime
  }
  return Math.round(best)
}

// Splits at exact configured distance marks, carrying any overshoot forward instead of
// resetting at the emitting segment's own (drifting) distance, plus a
// trailing partial split for any remainder below the configured length (metrics-spec.md §3 +
// §4). Elevation gains follow ending points. HR uses the ending sample's
// value weighted by the interval's overlap with each split's time range.
function buildSplits(
  pts: { heartRate?: number; segmentStart?: boolean }[],
  cumDist: number[],
  cumTime: number[],
  gainAtPoint: number[],
  sensorWeights: number[],
  splitDistanceM: number,
): Split[] {
  const total = cumDist[cumDist.length - 1]
  const splits: Split[] = []
  const roundedTotal = Math.round(total)
  // Rounded cumulative boundaries preserve total distance even for mile splits.
  let numSplits = Math.ceil(total / splitDistanceM)
  if (numSplits > 0 && Math.round((numSplits - 1) * splitDistanceM) >= roundedTotal) numSplits--
  if (roundedTotal === 0) numSplits = 0
  if (numSplits > 100_000) throw new Error('Too many splits: increase splitDistanceM (maximum 100000 splits).')
  const times: { start: number; end: number }[] = []
  for (let k = 0; k < numSplits; k++) {
    const start = k * splitDistanceM
    // Fold any sub-metre tail into the last represented split, retaining its
    // time and sensor/elevation attribution. All emitted distances are > 0.
    const end = k === numSplits - 1 ? total : start + splitDistanceM
    const t0 = timeAt(start, cumDist, cumTime)
    const t1 = timeAt(end, cumDist, cumTime)
    splits.push({
      km: k + 1, index: k + 1, targetDistanceM: splitDistanceM,
      isPartial: Math.round(end) < Math.round(start + splitDistanceM),
      distanceM: Math.round(end) - Math.round(start),
      paceSecPerKm: Math.round((t1 - t0) / ((end - start) / 1000)), elevationGainM: 0,
    })
    times.push({ start: t0, end: t1 })
  }

  const hrSum = new Array(numSplits).fill(0)
  const hrWeight = new Array(numSplits).fill(0)
  const elevSum = new Array(numSplits).fill(0)
  let firstSplit = 0
  for (let i = 1; i < cumDist.length; i++) {
    if (numSplits === 0 || pts[i].segmentStart) continue
    const idx = Math.max(0, Math.min(numSplits - 1, Math.ceil(cumDist[i] / splitDistanceM) - 1))
    elevSum[idx] += gainAtPoint[i]
    const hr = pts[i].heartRate
    if (hr == null || sensorWeights[i] <= 0) continue
    const t0 = cumTime[i - 1]
    const t1 = cumTime[i]
    while (firstSplit < numSplits && times[firstSplit].end <= t0) firstSplit++
    // Split a sample's duration at the actual distance boundary rather than
    // attributing an entire long interval to its ending split.
    for (let k = firstSplit; k < numSplits && times[k].start < t1; k++) {
      const overlap = Math.max(0, Math.min(t1, times[k].end) - Math.max(t0, times[k].start))
      hrSum[k] += hr * overlap
      hrWeight[k] += overlap
    }
  }
  for (let k = 0; k < numSplits; k++) {
    splits[k].elevationGainM = Math.round(elevSum[k])
    if (hrWeight[k] > 0) splits[k].avgHeartRate = Math.round(hrSum[k] / hrWeight[k])
  }

  return splits
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

// Guards Activity.deviceDistanceM the same way item 2 guards the per-point
// device distance stream: a value that isn't plausibly "this activity's
// total" is treated as absent rather than surfaced as-is. A total of 0 means
// the device didn't record one (most formats omit the field entirely when
// they have nothing to say, but some emit a zeroed placeholder). A total
// smaller than the point-stream distance can't be this activity's total
// either — the device's own total is always at least as large as what was
// recorded between the first and last point (see Activity.deviceDistanceM
// for why it's often larger, never smaller, when genuine).
function resolveDeviceDistanceM(raw: number | undefined, pointStreamDistanceM: number): number | undefined {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return undefined
  if (raw < pointStreamDistanceM) return undefined
  return raw
}

// Resolve the activity's elevation gain/loss and record which source produced
// them (metrics-spec.md §5.3 step 1 + §5.6). The device's own session-computed
// total (FIT session.total_ascent/total_descent, surfaced as
// Activity.deviceElevationGainM/LossM) is preferred when the file carries one:
// it is barometric/fused, filtered on-device, and the figure Garmin Connect
// and Strava agree with. Otherwise fall back to the GPS-altitude hysteresis
// totals passed in.
function resolveElevation(
  activity: Activity,
  hystGainM: number,
  hystLossM: number,
  hasAltitudeStream: boolean,
): {
  gainM: number; lossM: number; source: ActivityStats['elevationSource'];
  gainSource: 'device' | 'computed'; lossSource: 'device' | 'computed';
} {
  const resolve = (raw: number | undefined, computed: number): { value: number; source: 'device' | 'computed' } => {
    // A zero contradicting a confirmed rise/fall is a placeholder. Apply this
    // guard independently so one missing or invalid total cannot erase the other.
    const usable = raw != null && Number.isFinite(raw) && raw >= 0
      && !(raw === 0 && hasAltitudeStream && computed > 0)
    return usable ? { value: raw, source: 'device' } : { value: computed, source: 'computed' }
  }
  const gain = resolve(activity.deviceElevationGainM, hystGainM)
  const loss = resolve(activity.deviceElevationLossM, hystLossM)
  return {
    gainM: gain.value, lossM: loss.value,
    source: gain.source === loss.source ? gain.source : 'mixed',
    gainSource: gain.source, lossSource: loss.source,
  }
}

export interface AnalyzeOptions {
  maxHR?: number
  elevationThresholdM?: number
  /** Zone model + boundaries for `hrZones`. Default: `{ type: 'hrmax' }` with
   * boundaries {@link DEFAULT_ZONE_BOUNDARIES}, reproducing historical output. */
  zoneModel?: HrZoneModel
  /** Speed (m/s) below which a segment counts as paused, not moving. Default 0.3. */
  pauseThresholdMps?: number
  /** Metres per split: 1000 (default), 500, 1609.344 (mile), or custom >= 1. */
  splitDistanceM?: number
  /** Auto prefers coherent FIT timer events; speed retains threshold timing. */
  pauseDetection?: 'auto' | 'speed'
}

function validatePoints(points: Activity['points']): void {
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.segmentStart != null && typeof p.segmentStart !== 'boolean') {
      throw new Error(`Invalid segmentStart at point ${i}: expected a boolean.`)
    }
    if ((p.lat != null || p.lon != null) && (!hasPosition(p) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) {
      throw new Error(`Invalid coordinates at point ${i}: latitude must be within [-90, 90] and longitude within [-180, 180].`)
    }
    for (const field of ['elevation', 'heartRate', 'cadence'] as const) {
      if (p[field] != null && !Number.isFinite(p[field])) {
        throw new Error(`Invalid ${field} at point ${i}: expected a finite number.`)
      }
    }
    if (p.heartRate != null && p.heartRate <= 0) throw new Error(`Invalid heartRate at point ${i}: expected a positive number.`)
    if (p.cadence != null && p.cadence < 0) throw new Error(`Invalid cadence at point ${i}: expected a non-negative number.`)
    if (p.timestamp != null && (!(p.timestamp instanceof Date) || !Number.isFinite(p.timestamp.getTime()))) {
      throw new Error(`Invalid timestamp at point ${i}: expected a valid Date.`)
    }
  }
}

// Timing is never guessed as one second for an isolated corrupt segment.
// Interior gaps are interpolated by distance between recorded anchors (by
// index when the whole gap is stationary). Uncovered endpoints and backward
// clocks cannot establish the activity's duration and are rejected explicitly.
function cumulativeTimes(points: Activity['points'], cumDist: number[]): number[] {
  const result = new Array<number>(points.length).fill(0)
  if (points.every(p => p.timestamp == null)) {
    for (let i = 1; i < points.length; i++) result[i] = result[i - 1] + (points[i].segmentStart ? 0 : 1)
    return result
  }
  let offset = 0
  let previousEnd: number | undefined
  for (const { start, end } of continuousRanges(points)) {
    if (points[start].timestamp == null || points[end].timestamp == null) {
      throw new Error('Incomplete timing: first and last points of each continuous span must have timestamps when any timestamps are present.')
    }
    const startTime = points[start].timestamp.getTime()
    if (previousEnd != null && startTime < previousEnd) throw new Error('Invalid timing: timestamps must never go backwards across spans.')
    result[start] = offset
    let anchor = start
    for (let i = start + 1; i <= end; i++) {
      if (points[i].timestamp == null) continue
      const t0 = points[anchor].timestamp!.getTime()
      const t1 = points[i].timestamp!.getTime()
      const distance = cumDist[i] - cumDist[anchor]
      if (t1 < t0 || (t1 === t0 && distance > 0)) {
        throw new Error(`Invalid timing at point ${i}: timestamps must increase when distance increases and must never go backwards.`)
      }
      for (let j = anchor + 1; j <= i; j++) {
        const fraction = distance > 0 ? (cumDist[j] - cumDist[anchor]) / distance : (j - anchor) / (i - anchor)
        result[j] = offset + (t0 - startTime + fraction * (t1 - t0)) / 1000
      }
      anchor = i
    }
    offset = result[end]
    previousEnd = points[end].timestamp.getTime()
  }
  return result
}

function weightedAverage(points: Activity['points'], weights: number[], field: 'heartRate' | 'cadence'): number | null {
  let sum = 0
  let weight = 0
  for (let i = 1; i < points.length; i++) {
    const value = points[i][field]
    if (value == null || weights[i] <= 0) continue
    sum += value * weights[i]
    weight += weights[i]
  }
  return weight > 0 ? Math.round(sum / weight) : null
}

function bestContinuousKm(points: Activity['points'], cumDist: number[], cumTime: number[]): number | null {
  let best: number | null = null
  for (const { start, end } of continuousRanges(points)) {
    if (cumDist[end] - cumDist[start] < 1000) continue
    const distance = cumDist.slice(start, end + 1).map(d => d - cumDist[start])
    const time = cumTime.slice(start, end + 1).map(t => t - cumTime[start])
    const pace = computeBestKmPaceSecPerKm(distance, time)!
    if (best == null || pace < best) best = pace
  }
  return best
}

function assessQuality(activity: Activity, source: ActivityStats['distanceSource']): DataQuality {
  const pts = activity.points
  const missingTimestamps = pts.filter(p => p.timestamp == null).length
  const missingPositions = pts.filter(p => !hasPosition(p)).length
  let unknownDistanceIntervals = 0
  if (source !== 'device') {
    for (let i = 1; i < pts.length; i++) {
      if (!pts[i].segmentStart && (!hasPosition(pts[i - 1]) || !hasPosition(pts[i]))) unknownDistanceIntervals++
    }
  }
  const timingSource = pts.length < 2 ? 'unavailable' : missingTimestamps === pts.length ? 'assumed'
    : missingTimestamps > 0 ? 'interpolated' : 'recorded'
  const fallback = deviceDistanceFallback(pts)
  const warnings: string[] = []
  if (timingSource === 'assumed') warnings.push('assumed-one-second-timing')
  if (timingSource === 'interpolated') warnings.push('interpolated-timing')
  if (missingPositions) warnings.push('missing-positions')
  if (unknownDistanceIntervals) warnings.push('incomplete-distance')
  if (source === 'unavailable') warnings.push('distance-unavailable')
  if (fallback != null && fallback !== 'missing') warnings.push(`device-distance-${fallback}`)
  const d = activity.parseDiagnostics
  if (d?.droppedRecords) warnings.push('dropped-records')
  if (d?.droppedReadings) warnings.push('dropped-readings')
  if (d?.invalidPositions) warnings.push('invalid-positions')
  return {
    timingSource, missingTimestamps, missingPositions, unknownDistanceIntervals,
    deviceDistanceFallback: fallback, timerFallback: 'missing',
    elevationGainFallback: null, elevationLossFallback: null,
    parseDiagnostics: d ? { ...d } : null, warnings,
  }
}

type TimerRange = { start: number; end: number }

function timerRanges(activity: Activity): { ranges: TimerRange[] | null; fallback: DataQuality['timerFallback'] } {
  const events = activity.timerEvents ?? []
  const invalid = { ranges: null, fallback: 'invalid' as const }
  if (activity.parseDiagnostics?.droppedTimerEvents) return invalid
  if (events.length === 0) return { ranges: null, fallback: 'missing' }
  const pts = activity.points
  if (pts.length < 2 || continuousRanges(pts).some(({ start, end }) => !pts[start].timestamp || !pts[end].timestamp)) {
    return { ranges: null, fallback: 'untimed' }
  }
  const ranges: TimerRange[] = []
  let start: number | null = null
  let previous = -Infinity
  for (const event of events) {
    const time = event.timestamp instanceof Date ? event.timestamp.getTime() : NaN
    if (!Number.isFinite(time) || time < previous || (event.group != null && event.group !== 0)) return invalid
    previous = time
    if (event.type === 'start' && start == null) start = time
    else if (event.type === 'stop' && start != null) { ranges.push({ start, end: time }); start = null }
    else return invalid
  }
  // Require a known initial state and a closed final interval. Malformed or
  // truncated transitions must never silently turn into activity duration.
  if (start != null || ranges.length === 0 || events[0].timestamp.getTime() > pts[0].timestamp!.getTime()) return invalid
  return { ranges, fallback: null }
}

function timerDuration(points: Activity['points'], ranges: TimerRange[]): number {
  let totalMs = 0
  let first = 0
  for (const { start, end } of continuousRanges(points)) {
    const t0 = points[start].timestamp!.getTime()
    const t1 = points[end].timestamp!.getTime()
    while (first < ranges.length && ranges[first].end <= t0) first++
    for (let i = first; i < ranges.length && ranges[i].start < t1; i++) {
      totalMs += Math.max(0, Math.min(t1, ranges[i].end) - Math.max(t0, ranges[i].start))
    }
  }
  return totalMs / 1000
}

export function analyze(activity: Activity, options?: AnalyzeOptions): ActivityStats
/**
 * @deprecated prefer an options object; positional arguments are retained for compatibility
 */
export function analyze(activity: Activity, maxHR: number, elevationThresholdM?: number): ActivityStats
export function analyze(activity: Activity, arg2?: AnalyzeOptions | number, arg3?: number): ActivityStats {
  const options: AnalyzeOptions = typeof arg2 === 'number' ? { maxHR: arg2, elevationThresholdM: arg3 } : (arg2 ?? {})
  const {
    maxHR = 190,
    elevationThresholdM = DEFAULT_ELEVATION_THRESHOLD_M,
    zoneModel = { type: 'hrmax' as const },
    pauseThresholdMps = 0.3,
    splitDistanceM = 1000,
    pauseDetection = 'auto',
  } = options

  for (const [name, value] of Object.entries({ elevationThresholdM, pauseThresholdMps })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}: expected a finite, non-negative number.`)
  }
  if (zoneModel == null || (zoneModel.type !== 'hrmax' && zoneModel.type !== 'reserve')) {
    throw new Error('Invalid zoneModel: expected type "hrmax" or "reserve".')
  }
  if (!Number.isFinite(splitDistanceM) || splitDistanceM < 1) throw new Error('Invalid splitDistanceM: expected a finite number of at least 1 metre.')
  if (pauseDetection !== 'auto' && pauseDetection !== 'speed') throw new Error('Invalid pauseDetection: expected auto or speed.')
  const zoneBoundaries = zoneModel.boundaries ?? DEFAULT_ZONE_BOUNDARIES
  validateZoneBoundaries(zoneBoundaries)
  validateHeartRateInputs(maxHR, zoneModel)

  const pctOfMax = zoneModel.type === 'reserve'
    ? (hr: number) => (hr - zoneModel.restingHR) / (maxHR - zoneModel.restingHR)
    : (hr: number) => hr / maxHR

  const pts = activity.points
  validatePoints(pts)

  const { cumDist, source: distanceSource } = cumulativeDistanceSeries(pts)
  const quality = assessQuality(activity, distanceSource)
  const timer = timerRanges(activity)
  quality.timerFallback = timer.fallback
  if (timer.fallback === 'invalid') quality.warnings.push('invalid-timer-events')
  const timerTime = timer.ranges == null ? null : timerDuration(pts, timer.ranges)
  const useTimer = pauseDetection === 'auto' && timerTime != null
  const movingTimeSource = useTimer ? 'timer' : distanceSource === 'unavailable' ? 'unavailable' : 'speed'

  // Elevation is resolved before the <2-point guard: the device totals are
  // activity-level scalars, independent of how many points were recorded, so
  // a sparse track that still carries a session total_ascent should surface
  // it. The hysteresis pass also produces gainAtPoint, which splits[] needs.
  const { gainAtPoint, totalGainM: hystGainM, totalLossM: hystLossM } =
    elevationHysteresis(pts, elevationThresholdM)
  const hasAltitudeStream = pts.some(p => p.elevation != null)
  const { gainM: elevationGainM, lossM: elevationLossM, source: elevationSource,
    gainSource: elevationGainSource, lossSource: elevationLossSource } =
    resolveElevation(activity, hystGainM, hystLossM, hasAltitudeStream)

  const elevationFallback = (raw: number | undefined, source: 'device' | 'computed'): DataQuality['elevationGainFallback'] => {
    if (source === 'device') return null
    if (raw == null) return 'missing'
    return raw === 0 ? 'contradictory-zero' : 'invalid'
  }
  quality.elevationGainFallback = elevationFallback(activity.deviceElevationGainM, elevationGainSource)
  quality.elevationLossFallback = elevationFallback(activity.deviceElevationLossM, elevationLossSource)

  if (pts.length < 2) {
    return {
      distanceM: 0, distanceSource, quality, splitDistanceM, timerTimeSec: timerTime, movingTimeSource,
      deviceDistanceM: resolveDeviceDistanceM(activity.deviceDistanceM, 0),
      elapsedTimeSec: 0, movingTimeSec: 0,
      avgPaceSecPerKm: 0, bestKmPaceSecPerKm: null,
      elevationGainM: Math.round(elevationGainM), elevationLossM: Math.round(elevationLossM),
      elevationSource, elevationGainSource, elevationLossSource,
      avgHeartRate: null, maxHeartRate: pts[0]?.heartRate ?? null, hrZones: null,
      avgCadence: null, splits: [],
    }
  }

  let movingTimeSec = 0

  // Cumulative distance series (metrics-spec.md §2.3), from the device's own
  // distance stream when the whole track carries a usable one, else summed
  // haversine. Built once here and reused for splits, best-km and the segment
  // speeds below — every distance-derived metric shares this one source so
  // they can never disagree (the elevation chart's x-axis reads it too, via
  // stats.distanceSource). Per-segment distance is a difference of adjacent
  // entries, never re-summed a second way.
  // Elapsed-time companion series, with interior timestamp gaps interpolated.
  const cumTime = cumulativeTimes(pts, cumDist)

  // HR
  const hrValues = pts.map(p => p.heartRate).filter((h): h is number => h != null)
  const hasHR = hrValues.length > 0

  // HR zone weighting (metrics-spec.md §1): if no point in the whole activity
  // carries a timestamp, fall back to counting each segment as 1s (§1.5.3).
  // Otherwise a segment with a missing/non-monotonic timestamp contributes 0s
  // — it must NOT fall back to 1s, that would re-introduce the count bias
  // for exactly the corrupt segments (§1.5.2).
  const noTimestampsAtAll = pts.every(p => p.timestamp == null)
  const hrZoneSegments: { heartRate?: number; weightSec: number }[] = []
  const sensorWeights = new Array<number>(pts.length).fill(0)

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    if (curr.segmentStart) continue

    // Segment distance is a difference of the shared cumulative series, so it
    // reflects whichever source won — never a second, independent haversine.
    const segDist = cumDist[i] - cumDist[i - 1]

    const segTimeSec = cumTime[i] - cumTime[i - 1]

    const speedMps = segTimeSec > 0 ? segDist / segTimeSec : 0
    const isMoving = speedMps > pauseThresholdMps

    if (isMoving) movingTimeSec += segTimeSec

    // HR zone weight for this segment (attributed to curr, the ending sample)
    let zoneWeightSec: number
    if (noTimestampsAtAll) {
      zoneWeightSec = 1
    } else if (prev.timestamp == null || curr.timestamp == null) {
      zoneWeightSec = 0
    } else {
      const rawDt = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000
      zoneWeightSec = rawDt > 0 ? rawDt : 0
    }
    sensorWeights[i] = zoneWeightSec
    hrZoneSegments.push({ heartRate: curr.heartRate, weightSec: zoneWeightSec })
  }

  const distanceM = cumDist[cumDist.length - 1]
  const splits = buildSplits(pts, cumDist, cumTime, gainAtPoint, sensorWeights, splitDistanceM)

  const bestKmPace = quality.unknownDistanceIntervals > 0 ? null : bestContinuousKm(pts, cumDist, cumTime)

  const elapsedTimeSec = pts[0].timestamp && pts[pts.length - 1].timestamp
    ? (pts[pts.length - 1].timestamp!.getTime() - pts[0].timestamp.getTime()) / 1000
    : cumTime[cumTime.length - 1]

  if (useTimer) movingTimeSec = timerTime!

  const avgPaceSecPerKm = distanceM > 0 ? (movingTimeSec / (distanceM / 1000)) : 0

  return {
    distanceM: Math.round(distanceM),
    distanceSource, quality, splitDistanceM, timerTimeSec: timerTime == null ? null : Math.round(timerTime), movingTimeSource,
    deviceDistanceM: resolveDeviceDistanceM(activity.deviceDistanceM, Math.round(distanceM)),
    elapsedTimeSec: Math.round(elapsedTimeSec),
    movingTimeSec: Math.round(movingTimeSec),
    avgPaceSecPerKm: Math.round(avgPaceSecPerKm),
    bestKmPaceSecPerKm: bestKmPace != null ? Math.round(bestKmPace) : null,
    elevationGainM: Math.round(elevationGainM),
    elevationLossM: Math.round(elevationLossM),
    elevationSource, elevationGainSource, elevationLossSource,
    avgHeartRate: weightedAverage(pts, sensorWeights, 'heartRate'),
    // reduce, not Math.max(...hrValues): spreading a long HR array (a multi-hour
    // activity at 1 Hz is tens of thousands of samples, some FIT files far more)
    // into a call blows the argument-count/stack limit.
    maxHeartRate: hasHR ? hrValues.reduce((m, h) => (h > m ? h : m), -Infinity) : null,
    hrZones: hasHR ? hrZones(hrZoneSegments, pctOfMax, zoneBoundaries) : null,
    avgCadence: weightedAverage(pts, sensorWeights, 'cadence'),
    splits,
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers (exported for CLI + reports)
// ---------------------------------------------------------------------------

export function formatPace(secPerKm: number, units: 'metric' | 'imperial' = 'metric'): string {
  const adjusted = units === 'imperial' ? secPerKm * 1.60934 : secPerKm
  // Round to whole seconds first, then split, so 479.6s → 8:00 (not 7:60).
  const totalSec = Math.round(adjusted)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  const unit = units === 'imperial' ? '/mi' : '/km'
  return `${min}:${sec.toString().padStart(2, '0')}${unit}`
}

export function formatDistance(metres: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (units === 'imperial') return `${(metres / 1609.34).toFixed(2)} mi`
  return `${(metres / 1000).toFixed(2)} km`
}

export function formatDuration(seconds: number): string {
  // Round to whole seconds *before* splitting so the carry propagates:
  // 59.6s → 1:00, not 0:60 (same rule formatPace applies).
  const totalSec = Math.round(seconds)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}
