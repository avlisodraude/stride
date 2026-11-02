// ---------------------------------------------------------------------------
// Raw activity readings
// ---------------------------------------------------------------------------

export interface TrackPoint {
  /** Both coordinates are absent for indoor/GPS-less readings. */
  lat?: number
  lon?: number
  elevation?: number   // metres
  timestamp?: Date
  heartRate?: number   // bpm
  cadence?: number     // steps/min
  /** First point of a new continuous span (GPX track/segment, TCX Track,
   * or a gap caused by a discarded record).
   * No distance, recorded-span duration, sensor weight or elevation change
   * is inferred from the preceding point. Omit for continuous points. */
  segmentStart?: boolean
  /**
   * Device-reported distance from the *activity start*, in metres —
   * **cumulative, not per-segment**. Present when the source file carries a
   * distance stream (FIT `record.distance`, TCX
   * `<DistanceMeters>`); absent for GPX, which has no standard distance
   * element. The analyzer prefers this over summed haversine when the whole
   * track has it and it is non-decreasing within each continuous span
   * (see {@link ActivityStats.distanceSource}). Resets at span starts are allowed.
   */
  distanceM?: number
}

// ---------------------------------------------------------------------------
// Parsed activity
// ---------------------------------------------------------------------------

export interface Activity {
  /** Parser counts; no original values or location data are included. */
  parseDiagnostics?: ParseDiagnostics
  /** FIT timer transitions in file order. Unsupported transitions invalidate
   * timer-based timing rather than silently changing the pause state. */
  timerEvents?: TimerEvent[]
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
   * May exceed `ActivityStats.distanceM`, which measures progress within
   * recorded continuous spans. The difference includes distance outside
   * the point stream or excluded span boundaries. That gap is expected, not a bug — the
   * two numbers answer different questions and are not required to agree.
   */
  deviceDistanceM?: number
  /**
   * The device's own total elevation gain / loss for the *whole activity*,
   * in metres, read verbatim from FIT `session.total_ascent` /
   * `session.total_descent` (summed across sessions in a multisport file).
   * Undefined for GPX and TCX, and for FIT files whose session message omits
   * the field (many watches never write it).
   *
   * Unlike {@link TrackPoint.distanceM}, these are **activity-level scalars**,
   * not a per-point stream: the device reports one total for the run,
   * computed by its barometric/fused altimeter, and does not tell us how that
   * total is distributed over distance. They therefore cannot be attributed
   * to individual splits — see {@link ActivityStats.elevationSource} and
   * `docs/metrics-spec.md` §5.6. When present and trusted, the analyzer
   * prefers them over the GPS-altitude hysteresis filter, because they are
   * the figure Garmin Connect and Strava agree with.
   */
  deviceElevationGainM?: number
  deviceElevationLossM?: number
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
   * (present on every point, non-decreasing within spans, not all-zero), `'computed'` when
   * it fell back to summing haversine distances between raw GPS points (GPX
   * always, and any track whose device stream was missing or unusable).
   * 'unavailable' means no recorded edge has either usable GPS or device distance.
   * Incomplete GPS coverage is counted in quality.unknownDistanceIntervals.
   */
  distanceSource: 'device' | 'computed' | 'unavailable'
  /** Data coverage and the reasons for any estimation/fallback. */
  quality: DataQuality
  /** Configured split length (default 1000), independent of display units. */
  splitDistanceM: number
  /** Recorded FIT timer duration within continuous spans; null if unusable. */
  timerTimeSec: number | null
  movingTimeSource: 'speed' | 'timer' | 'unavailable'
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
  /** Total wall-clock elapsed time in seconds, including gaps between spans. */
  elapsedTimeSec: number
  /** Active FIT timer duration in auto mode when usable, otherwise speed-based
   * moving time. Check movingTimeSource: a running timer can include standing. */
  movingTimeSec: number
  /** Average pace in seconds per kilometre */
  avgPaceSecPerKm: number
  /**
   * Fastest 1000m anywhere in the activity (elapsed time, seconds per km),
   * as a rolling window over the cumulative distance/time series —
   * independent of splits[] and not quantised to km marks. Null if no single
   * continuous recorded span covers 1000m. Never crosses segment breaks.
   */
  bestKmPaceSecPerKm: number | null
  /** Total elevation gain in metres */
  elevationGainM: number
  /** Total elevation loss in metres */
  elevationLossM: number
  /**
   * Combined provenance: 'device' when both totals use the device, 'computed'
   * when both use hysteresis, or 'mixed' when the sources differ. Consult the
   * per-total source fields when interpreting either value independently.
   *
   * When this is `'device'`, `sum(splits[].elevationGainM)` does **not** equal
   * `elevationGainM`: the splits are still built from the per-point hysteresis
   * pass (the only elevation signal that can be sliced by distance), while the
   * total is the device's activity-level scalar. This inconsistency is
   * deliberate and documented — see `docs/metrics-spec.md` §5.6.
   */
  elevationSource: 'device' | 'computed' | 'mixed'
  /** Provenance for elevationGainM; missing/invalid/contradictory device
   * ascent totals fall back independently to hysteresis. */
  elevationGainSource: 'device' | 'computed'
  /** Provenance for elevationLossM, resolved independently of ascent. */
  elevationLossSource: 'device' | 'computed'
  /** Duration-weighted ending-sample HR in bpm; null with no HR-covered time.
   * Missing original timestamps and span boundaries contribute no duration.
   * If the whole activity is untimed, assume 1s per recorded interval. */
  avgHeartRate: number | null
  /** Maximum recorded HR in bpm, including a lone sample; null only without HR data. */
  maxHeartRate: number | null
  /**
   * Heart rate zone breakdown in seconds (null if no HR data). Each sample's
   * zone is weighted by the duration of the segment ending at that sample,
   * not by sample count. If the activity has no timestamps at all, 1s per
   * segment is assumed as a fallback (count-weighting).
   */
  hrZones: HeartRateZones | null
  /** Duration-weighted cadence in steps/min; same timing policy as avgHeartRate.
   * Null with no cadence-covered time. */
  avgCadence: number | null
  /**
   * Splits at splitDistanceM boundaries (default 1000m), with a trailing partial.
   * Rounded cumulative boundaries preserve integer-metre totals for mile splits. Sub-metre tails that round to zero
   * are folded into the final split. `sum(splits[i].distanceM) === distanceM`.
   * Split timing excludes unrecorded gaps between continuous spans.
   */
  splits: Split[]
}

export interface Split {
  /** One-based split ordinal. `km` is retained as a legacy alias. */
  index: number
  km: number
  targetDistanceM: number
  isPartial: boolean
  /** Integer metres, computed from rounded cumulative boundaries. Use
   * isPartial to identify partial splits; fractional target lengths can
   * produce different integer distances for otherwise full splits.
   * sum(splits.distanceM) equals the activity total distanceM. */
  distanceM: number
  /** Pace normalised to seconds per kilometre, so a partial split's pace is
   * directly comparable to a full one's. */
  paceSecPerKm: number
  elevationGainM: number
  /** Ending-sample HR weighted by duration overlapping this split. */
  avgHeartRate?: number
}

export interface ParseDiagnostics {
  totalRecords: number
  droppedRecords: number
  invalidPositions: number
  droppedReadings: number
  droppedTimerEvents: number
}

export interface TimerEvent {
  timestamp: Date
  type: 'start' | 'stop' | 'unsupported'
  group?: number
}

export interface DataQuality {
  timingSource: 'recorded' | 'interpolated' | 'assumed' | 'unavailable'
  missingTimestamps: number
  missingPositions: number
  /** Edges with neither a usable device stream nor two GPS positions. */
  unknownDistanceIntervals: number
  deviceDistanceFallback: 'missing' | 'incomplete' | 'invalid' | 'decreasing' | 'all-zero' | null
  timerFallback: 'missing' | 'invalid' | 'untimed' | null
  elevationGainFallback: 'missing' | 'invalid' | 'contradictory-zero' | null
  elevationLossFallback: 'missing' | 'invalid' | 'contradictory-zero' | null
  parseDiagnostics: ParseDiagnostics | null
  /** Stable machine-readable codes, also shown in CLI output. */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Chart options
// ---------------------------------------------------------------------------

/** The five chart builders exported from `@alosha/stride/charts`. */
export type ChartType = 'pace' | 'elevation' | 'heartRate' | 'hrZones' | 'splits'

export interface ChartOptions {
  /** Unit system. Default: 'metric' */
  units?: 'metric' | 'imperial'
}
