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
