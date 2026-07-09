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
  /** Total elapsed time in seconds */
  elapsedTimeSec: number
  /** Moving time (excludes pauses) in seconds */
  movingTimeSec: number
  /** Average pace in seconds per kilometre */
  avgPaceSecPerKm: number
  /** Best 1km split pace in seconds per kilometre */
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
  /** Per-kilometre splits: array of { km, paceSecPerKm, elevationGainM } */
  splits: Split[]
}

export interface Split {
  km: number
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
