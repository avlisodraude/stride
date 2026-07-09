// ---------------------------------------------------------------------------
// Raw GPS data
// ---------------------------------------------------------------------------

export interface TrackPoint {
  lat: number
  lon: number
  elevation?: number   // metres
  timestamp?: Date
  heartRate?: number   // bpm
  cadence?: number     // steps/min
  /**
   * Device-reported distance from the *activity start*, in metres —
   * **cumulative, not per-segment**. Present when the source file carries a
   * distance stream (FIT `record.distance`/`enhancedDistance`, TCX
   * `<DistanceMeters>`); absent for GPX, which has no standard distance
   * element. The analyzer prefers this over summed haversine when the whole
   * track has it and it is non-decreasing (see {@link ActivityStats.distanceSource}).
   */
  distanceM?: number
}

// ---------------------------------------------------------------------------
// Parsed activity
// ---------------------------------------------------------------------------

export interface Activity {
  name?: string
  type?: string        // e.g. "running", "cycling"
  startTime?: Date
  points: TrackPoint[]
  /** Source file format */
  format: 'gpx' | 'fit' | 'tcx'
  /**
   * The device's own total distance for the activity, in metres, read
   * verbatim from the file — TCX `<Lap><DistanceMeters>` (summed across
   * laps), FIT `session.totalDistance` (summed across sessions). Undefined
   * for GPX, which has no such element.
   *
   * May exceed `ActivityStats.distanceM`, which measures only from the
   * first to the last *recorded* point: the difference is distance the
   * device accumulated before its first usable position fix, or during
   * segments with no position data. That gap is expected, not a bug — the
   * two numbers answer different questions and are not required to agree.
   */
  deviceDistanceM?: number
}

// ---------------------------------------------------------------------------
// Computed stats
// ---------------------------------------------------------------------------

export interface HeartRateZones {
  /** Below 60% HRmax (seconds). Includes warm-up/recovery/below-zone — there
   * is no separate floor, so z1..z5 always sum to the HR-covered elapsed
   * time. */
  z1: number
  z2: number   // 60–70% HRmax (seconds)
  z3: number   // 70–80% HRmax (seconds)
  z4: number   // 80–90% HRmax (seconds)
  /** ≥ 90% HRmax (seconds). */
  z5: number
}

export interface ActivityStats {
  /** Total distance in metres */
  distanceM: number
  /**
   * Which distance source produced `distanceM`, the cumulative series behind
   * `splits[]`/`bestKmPaceSecPerKm`, and the elevation chart's x-axis:
   * `'device'` when the file's own cumulative distance stream was usable
   * (present on every point, non-decreasing, not all-zero), `'computed'` when
   * it fell back to summing haversine distances between raw GPS points (GPX
   * always, and any track whose device stream was missing or unusable).
   */
  distanceSource: 'device' | 'computed'
  /**
   * The device's own total distance for the activity (see
   * {@link Activity.deviceDistanceM}), passed through unrounded and
   * otherwise unchanged — it is reported, not consumed; nothing else here is
   * derived from it. Unlike `distanceM`, which rounds to the nearest metre
   * because it is a *computed* sum over many segments, this is a single
   * value taken verbatim from the file, so rounding it would only discard
   * precision the device actually reported.
   *
   * Undefined when the source format has no such total (GPX), or when the
   * guard rejects it: a reported total of 0, or one smaller than
   * `distanceM` (this activity's own point-stream distance), means the
   * device did not actually record a usable total, and is treated as
   * absent rather than surfaced as a real, if nonsensical, number. When
   * present, `deviceDistanceM >= distanceM` always holds — see
   * {@link Activity.deviceDistanceM} for why the device figure can be
   * larger.
   */
  deviceDistanceM?: number
  /** Total elapsed time in seconds */
  elapsedTimeSec: number
  /** Moving time (excludes pauses) in seconds */
  movingTimeSec: number
  /** Average pace in seconds per kilometre */
  avgPaceSecPerKm: number
  /**
   * Fastest 1000m anywhere in the activity (elapsed time, seconds per km),
   * as a rolling window over the cumulative distance/time series —
   * independent of splits[] and not quantised to km marks. Null if the
   * activity covers less than 1000m.
   */
  bestKmPaceSecPerKm: number | null
  /** Total elevation gain in metres */
  elevationGainM: number
  /** Total elevation loss in metres */
  elevationLossM: number
  /** Average heart rate in bpm (null if no HR data) */
  avgHeartRate: number | null
  /** Max heart rate in bpm (null if no HR data) */
  maxHeartRate: number | null
  /**
   * Heart rate zone breakdown in seconds (null if no HR data). Each sample's
   * zone is weighted by the duration of the segment ending at that sample,
   * not by sample count. If the activity has no timestamps at all, 1s per
   * segment is assumed as a fallback (count-weighting).
   */
  hrZones: HeartRateZones | null
  /** Average cadence in steps/min (null if no cadence data) */
  avgCadence: number | null
  /**
   * Per-kilometre splits, including a trailing partial split for any
   * remainder under 1000m. `sum(splits[i].distanceM) === distanceM`.
   */
  splits: Split[]
}

export interface Split {
  km: number
  /** Distance covered by this split, in metres. Full splits carry 1000; the
   * final split of an activity may be a partial (< 1000) — identify it by
   * `distanceM !== 1000`, not by a separate flag. `sum(splits.distanceM)`
   * always equals the activity's total `distanceM`. */
  distanceM: number
  /** Pace normalised to seconds per kilometre, so a partial split's pace is
   * directly comparable to a full one's. */
  paceSecPerKm: number
  elevationGainM: number
  avgHeartRate?: number
}

// ---------------------------------------------------------------------------
// Chart options
// ---------------------------------------------------------------------------

export type ChartType = 'pace' | 'elevation' | 'heartRate' | 'hrZones' | 'splits'

export interface ChartOptions {
  /** Which charts to render. Default: all available based on data */
  charts?: ChartType[]
  /** Unit system. Default: 'metric' */
  units?: 'metric' | 'imperial'
  /** Max HR for zone calculation. Default: 190 */
  maxHR?: number
}
