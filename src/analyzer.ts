import type { Activity, ActivityStats, Split, HeartRateZones } from './types.js'
import { cumulativeDistanceSeries } from './geo.js'

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
  for (const b of boundaries) {
    if (!(b > 0 && b < 1)) {
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

// Preferred long-term path (§5.3 step 1): if the source file is FIT and
// carries a device-computed session.total_ascent, that figure should be used
// in place of this filter — it is what Garmin/Strava will agree with and was
// filtered on-device. The parser does not currently surface that field, so
// this filter is the fallback used for every source today. Out of scope here.

// Default threshold per spec §5.3: 3m sits at the top of the barometric noise
// band while removing the bulk of per-fix GPS jitter. It is a deliberately
// conservative default given the library cannot always tell whether a source
// is barometric or GPS-only; expose it as a parameter so a caller who knows
// their data is GPS-only can raise it toward Strava's 10m.
export const DEFAULT_ELEVATION_THRESHOLD_M = 3

// Accumulates confirmed climbs/descents only once the *cumulative* rise from
// the last confirmed reference point clears `thresholdM`, rejecting
// oscillation within the noise band. Returns, per point, the confirmed
// gain/loss amount attributed to that point (its "ending point", consistent
// with the same convention used for HR zones and splits) so callers can slice
// the totals by distance range without re-running the filter.
function elevationHysteresis(
  points: { elevation?: number }[],
  thresholdM: number
): { gainAtPoint: number[]; lossAtPoint: number[]; totalGainM: number; totalLossM: number } {
  const gainAtPoint = new Array(points.length).fill(0)
  const lossAtPoint = new Array(points.length).fill(0)
  let ref: number | null = null
  let totalGainM = 0
  let totalLossM = 0

  for (let i = 0; i < points.length; i++) {
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
function timeAt(x: number, cumDist: number[], cumTime: number[]): number {
  const n = cumDist.length
  if (x <= cumDist[0]) return cumTime[0]
  if (x >= cumDist[n - 1]) return cumTime[n - 1]

  let lo = 1
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumDist[mid] < x) lo = mid + 1
    else hi = mid
  }
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
    const windowTime = timeAt(s + 1000, cumDist, cumTime) - timeAt(s, cumDist, cumTime)
    if (windowTime < best) best = windowTime
  }
  return Math.round(best)
}

// Splits at exact 1000m marks, carrying any overshoot forward instead of
// resetting at the emitting segment's own (drifting) distance, plus a
// trailing partial split for any remainder under 1000m (metrics-spec.md §3 +
// §4). Per-split elevation gain and average HR are attributed to whichever
// split contains each segment's *ending* point (same convention as HR zones,
// §1.2), not interpolated — the spec calls exact interpolation there
// unnecessary precision.
function buildSplits(
  pts: { heartRate?: number }[],
  cumDist: number[],
  cumTime: number[],
  gainAtPoint: number[]
): Split[] {
  const total = cumDist[cumDist.length - 1]
  const splits: Split[] = []

  let mark = 0
  let km = 1
  while (mark + 1000 <= total) {
    const t0 = timeAt(mark, cumDist, cumTime)
    const t1 = timeAt(mark + 1000, cumDist, cumTime)
    splits.push({ km: km++, distanceM: 1000, paceSecPerKm: Math.round(t1 - t0), elevationGainM: 0 })
    mark += 1000
  }

  // Trailing partial (§3.2/§3.3): epsilon guards against floating-point dust
  // emitting a spurious 0m split when total is an exact multiple of 1000.
  if (total - mark > 1e-6) {
    const remainderM = total - mark
    const remainderTimeSec = timeAt(total, cumDist, cumTime) - timeAt(mark, cumDist, cumTime)
    const pace = remainderTimeSec / (remainderM / 1000)
    splits.push({ km: km++, distanceM: Math.round(remainderM), paceSecPerKm: Math.round(pace), elevationGainM: 0 })
  }

  const numSplits = splits.length
  const hrSum = new Array(numSplits).fill(0)
  const hrCount = new Array(numSplits).fill(0)
  const elevSum = new Array(numSplits).fill(0)
  for (let i = 1; i < cumDist.length; i++) {
    const idx = Math.ceil(cumDist[i] / 1000) - 1
    if (idx < 0 || idx >= numSplits) continue
    elevSum[idx] += gainAtPoint[i]
    const hr = pts[i].heartRate
    if (hr != null) { hrSum[idx] += hr; hrCount[idx]++ }
  }
  for (let k = 0; k < numSplits; k++) {
    splits[k].elevationGainM = Math.round(elevSum[k])
    if (hrCount[k] > 0) splits[k].avgHeartRate = Math.round(hrSum[k] / hrCount[k])
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
  if (raw == null || raw <= 0) return undefined
  if (raw < pointStreamDistanceM) return undefined
  return raw
}

export interface AnalyzeOptions {
  maxHR?: number
  elevationThresholdM?: number
  /** Zone model + boundaries for `hrZones`. Default: `{ type: 'hrmax' }` with
   * boundaries {@link DEFAULT_ZONE_BOUNDARIES}, reproducing historical output. */
  zoneModel?: HrZoneModel
  /** Speed (m/s) below which a segment counts as paused, not moving. Default 0.3. */
  pauseThresholdMps?: number
}

export function analyze(activity: Activity, options?: AnalyzeOptions): ActivityStats
/**
 * @deprecated positional arguments will be removed in 3.0.0; pass an options object
 */
export function analyze(activity: Activity, maxHR: number, elevationThresholdM?: number): ActivityStats
export function analyze(activity: Activity, arg2?: AnalyzeOptions | number, arg3?: number): ActivityStats {
  const options: AnalyzeOptions = typeof arg2 === 'number' ? { maxHR: arg2, elevationThresholdM: arg3 } : (arg2 ?? {})
  const {
    maxHR = 190,
    elevationThresholdM = DEFAULT_ELEVATION_THRESHOLD_M,
    zoneModel = { type: 'hrmax' as const },
    pauseThresholdMps = 0.3,
  } = options

  const zoneBoundaries = zoneModel.boundaries ?? DEFAULT_ZONE_BOUNDARIES
  validateZoneBoundaries(zoneBoundaries)

  const pctOfMax = zoneModel.type === 'reserve'
    ? (hr: number) => (hr - zoneModel.restingHR) / (maxHR - zoneModel.restingHR)
    : (hr: number) => hr / maxHR

  const pts = activity.points
  if (pts.length < 2) {
    return {
      distanceM: 0, distanceSource: 'computed',
      deviceDistanceM: resolveDeviceDistanceM(activity.deviceDistanceM, 0),
      elapsedTimeSec: 0, movingTimeSec: 0,
      avgPaceSecPerKm: 0, bestKmPaceSecPerKm: null,
      elevationGainM: 0, elevationLossM: 0,
      avgHeartRate: null, maxHeartRate: null, hrZones: null,
      avgCadence: null, splits: [],
    }
  }

  let movingTimeSec = 0

  const { gainAtPoint, totalGainM: elevationGainM, totalLossM: elevationLossM } =
    elevationHysteresis(pts, elevationThresholdM)

  // Cumulative distance series (metrics-spec.md §2.3), from the device's own
  // distance stream when the whole track carries a usable one, else summed
  // haversine. Built once here and reused for splits, best-km and the segment
  // speeds below — every distance-derived metric shares this one source so
  // they can never disagree (the elevation chart's x-axis reads it too, via
  // stats.distanceSource). Per-segment distance is a difference of adjacent
  // entries, never re-summed a second way.
  const { cumDist, source: distanceSource } = cumulativeDistanceSeries(pts)

  // Elapsed-time companion series, index 0 = 0, filled in the loop below.
  const cumTime: number[] = [0]

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

  // Cadence
  const cadValues = pts.map(p => p.cadence).filter((c): c is number => c != null)
  const hasCadence = cadValues.length > 0

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]

    // Segment distance is a difference of the shared cumulative series, so it
    // reflects whichever source won — never a second, independent haversine.
    const segDist = cumDist[i] - cumDist[i - 1]

    // Time delta
    let segTimeSec = 1 // default 1s between points if no timestamps
    if (prev.timestamp && curr.timestamp) {
      segTimeSec = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000
    }
    if (segTimeSec <= 0) segTimeSec = 1

    const speedMps = segDist / segTimeSec
    const isMoving = speedMps > pauseThresholdMps

    if (isMoving) movingTimeSec += segTimeSec

    cumTime.push(cumTime[i - 1] + segTimeSec)

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
    hrZoneSegments.push({ heartRate: curr.heartRate, weightSec: zoneWeightSec })
  }

  const distanceM = cumDist[cumDist.length - 1]
  const splits = buildSplits(pts, cumDist, cumTime, gainAtPoint)

  const bestKmPace = computeBestKmPaceSecPerKm(cumDist, cumTime)

  const elapsedTimeSec =
    pts[0].timestamp && pts[pts.length - 1].timestamp
      ? (pts[pts.length - 1].timestamp!.getTime() - pts[0].timestamp!.getTime()) / 1000
      : movingTimeSec

  const avgPaceSecPerKm = distanceM > 0 ? (movingTimeSec / (distanceM / 1000)) : 0

  return {
    distanceM: Math.round(distanceM),
    distanceSource,
    deviceDistanceM: resolveDeviceDistanceM(activity.deviceDistanceM, distanceM),
    elapsedTimeSec: Math.round(elapsedTimeSec),
    movingTimeSec: Math.round(movingTimeSec),
    avgPaceSecPerKm: Math.round(avgPaceSecPerKm),
    bestKmPaceSecPerKm: bestKmPace != null ? Math.round(bestKmPace) : null,
    elevationGainM: Math.round(elevationGainM),
    elevationLossM: Math.round(elevationLossM),
    avgHeartRate: hasHR ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null,
    maxHeartRate: hasHR ? Math.max(...hrValues) : null,
    hrZones: hasHR ? hrZones(hrZoneSegments, pctOfMax, zoneBoundaries) : null,
    avgCadence: hasCadence ? Math.round(cadValues.reduce((a, b) => a + b, 0) / cadValues.length) : null,
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
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}
