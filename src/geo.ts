// ---------------------------------------------------------------------------
// Shared geo helpers — distance maths lives here so analyzer.ts and
// charts.ts never disagree about how far apart two points are.
// ---------------------------------------------------------------------------

const R = 6_371_000 // Earth radius in metres (docs/metrics-spec.md Appendix A)

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
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

/**
 * Cumulative distance in metres, one entry per point, index 0 = 0.
 *
 * Always compute this over the full point set. Callers that need a series
 * for a downsampled/decimated set of points must sample *into* the result,
 * not sum haversine distances over the decimated points themselves — that
 * measures the chords of the decimated track, not the track, and undercounts
 * the true path length.
 */
export function cumulativeDistances(points: { lat: number; lon: number }[]): number[] {
  const cumDist = new Array(points.length).fill(0)
  for (let i = 1; i < points.length; i++) {
    cumDist[i] = cumDist[i - 1] + haversine(points[i - 1], points[i])
  }
  return cumDist
}

/**
 * True when the device's own cumulative distance stream is usable for the
 * whole track: every point carries a finite `distanceM`, the series is
 * non-decreasing (a pause repeats a value — that is fine), and it is not all
 * zeros. A field that appears on only some points, goes backwards, or is
 * uniformly zero is treated as absent — half a device series is worse than
 * none, because splicing it onto haversine would put a discontinuity in the
 * cumulative distance.
 */
export function hasUsableDeviceDistance(points: { distanceM?: number }[]): boolean {
  if (points.length === 0) return false
  let prev = -Infinity
  let max = 0
  for (const p of points) {
    const d = p.distanceM
    if (d == null || !Number.isFinite(d)) return false
    if (d < prev) return false            // non-monotonic → treat as absent
    prev = d
    if (d > max) max = d
  }
  return max > 0                          // all-zero → treat as absent
}

/**
 * Cumulative distance in metres, one entry per point, index 0 = 0, built from
 * whichever source is trustworthy for the *whole* track: the device's own
 * `distanceM` stream when {@link hasUsableDeviceDistance} holds, otherwise
 * summed haversine ({@link cumulativeDistances}). Never mix the two per
 * segment. The device series is re-based to the first point so it shares
 * haversine's frame (distance from the first recorded point, not from the
 * device's own zero, which may sit before the first GPS fix).
 *
 * This is the single series that must feed `distanceM`, `splits[]`,
 * `bestKmPaceSecPerKm` and the elevation chart's x-axis — compute it once.
 */
export function cumulativeDistanceSeries(
  points: { lat: number; lon: number; distanceM?: number }[]
): { cumDist: number[]; source: 'device' | 'computed' } {
  if (hasUsableDeviceDistance(points)) {
    const base = points[0].distanceM!
    return { cumDist: points.map(p => p.distanceM! - base), source: 'device' }
  }
  return { cumDist: cumulativeDistances(points), source: 'computed' }
}
