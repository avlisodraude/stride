import type { Activity, ActivityStats, Split, HeartRateZones } from './types.js'

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

const R = 6_371_000 // Earth radius in metres

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const x =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// ---------------------------------------------------------------------------
// HR zone helpers
// ---------------------------------------------------------------------------

function hrZones(points: { heartRate?: number }[], maxHR: number): HeartRateZones {
  const zones: HeartRateZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  let count = 0

  for (const p of points) {
    if (p.heartRate == null) continue
    count++
    const pct = p.heartRate / maxHR
    if (pct < 0.6) zones.z1++
    else if (pct < 0.7) zones.z2++
    else if (pct < 0.8) zones.z3++
    else if (pct < 0.9) zones.z4++
    else zones.z5++
  }

  // Convert count (seconds approximation) to actual seconds
  // Each point ≈ 1 second apart in most GPS watches
  return count > 0 ? zones : { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export function analyze(activity: Activity, maxHR = 190): ActivityStats {
  const pts = activity.points
  if (pts.length < 2) {
    return {
      distanceM: 0, elapsedTimeSec: 0, movingTimeSec: 0,
      avgPaceSecPerKm: 0, bestKmPaceSecPerKm: null,
      elevationGainM: 0, elevationLossM: 0,
      avgHeartRate: null, maxHeartRate: null, hrZones: null,
      avgCadence: null, splits: [],
    }
  }

  let distanceM = 0
  let elevationGainM = 0
  let elevationLossM = 0
  let movingTimeSec = 0

  const PAUSE_THRESHOLD_MPS = 0.3 // below this speed = paused

  // Per-km split tracking
  const splits: Split[] = []
  let splitDistM = 0
  let splitTimeSec = 0
  let splitElevGain = 0
  let splitHrSum = 0
  let splitHrCount = 0
  let splitKm = 1

  // Best 1km pace window
  let bestKmPace: number | null = null

  // HR
  const hrValues = pts.map(p => p.heartRate).filter((h): h is number => h != null)
  const hasHR = hrValues.length > 0

  // Cadence
  const cadValues = pts.map(p => p.cadence).filter((c): c is number => c != null)
  const hasCadence = cadValues.length > 0

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]

    const segDist = haversine(prev, curr)

    // Time delta
    let segTimeSec = 1 // default 1s between points if no timestamps
    if (prev.timestamp && curr.timestamp) {
      segTimeSec = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000
    }
    if (segTimeSec <= 0) segTimeSec = 1

    const speedMps = segDist / segTimeSec
    const isMoving = speedMps > PAUSE_THRESHOLD_MPS

    distanceM += segDist
    if (isMoving) movingTimeSec += segTimeSec

    // Elevation
    if (prev.elevation != null && curr.elevation != null) {
      const diff = curr.elevation - prev.elevation
      if (diff > 0) elevationGainM += diff
      else elevationLossM += Math.abs(diff)
    }

    // Split accumulation
    splitDistM += segDist
    splitTimeSec += segTimeSec
    if (curr.elevation != null && prev.elevation != null) {
      const diff = curr.elevation - prev.elevation
      if (diff > 0) splitElevGain += diff
    }
    if (curr.heartRate != null) {
      splitHrSum += curr.heartRate
      splitHrCount++
    }

    // Emit split every 1km
    if (splitDistM >= 1000) {
      const pace = splitTimeSec / (splitDistM / 1000)
      splits.push({
        km: splitKm++,
        paceSecPerKm: Math.round(pace),
        elevationGainM: Math.round(splitElevGain),
        ...(splitHrCount > 0 ? { avgHeartRate: Math.round(splitHrSum / splitHrCount) } : {}),
      })
      if (bestKmPace === null || pace < bestKmPace) bestKmPace = pace
      splitDistM = 0; splitTimeSec = 0; splitElevGain = 0
      splitHrSum = 0; splitHrCount = 0
    }
  }

  const elapsedTimeSec =
    pts[0].timestamp && pts[pts.length - 1].timestamp
      ? (pts[pts.length - 1].timestamp!.getTime() - pts[0].timestamp!.getTime()) / 1000
      : movingTimeSec

  const avgPaceSecPerKm = distanceM > 0 ? (movingTimeSec / (distanceM / 1000)) : 0

  return {
    distanceM: Math.round(distanceM),
    elapsedTimeSec: Math.round(elapsedTimeSec),
    movingTimeSec: Math.round(movingTimeSec),
    avgPaceSecPerKm: Math.round(avgPaceSecPerKm),
    bestKmPaceSecPerKm: bestKmPace != null ? Math.round(bestKmPace) : null,
    elevationGainM: Math.round(elevationGainM),
    elevationLossM: Math.round(elevationLossM),
    avgHeartRate: hasHR ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null,
    maxHeartRate: hasHR ? Math.max(...hrValues) : null,
    hrZones: hasHR ? hrZones(pts, maxHR) : null,
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
