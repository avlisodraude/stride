// ---------------------------------------------------------------------------
// Shared geo helpers — distance maths lives here so analyzer.ts and
// charts.ts never disagree about how far apart two points are.
// ---------------------------------------------------------------------------

const R = 6_371_000 // Earth radius in metres (docs/metrics-spec.md Appendix A)

export function hasPosition<T extends { lat?: number; lon?: number }>(p: T): p is T & { lat: number; lon: number } {
  return p.lat != null && p.lon != null
}

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const x =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon
  const clamped = Math.max(0, Math.min(1, x))
  return 2 * R * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped))
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
export function cumulativeDistances(points: { lat?: number; lon?: number; segmentStart?: boolean }[]): number[] {
  const cumDist = new Array(points.length).fill(0)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    cumDist[i] = cumDist[i - 1] + (!b.segmentStart && hasPosition(a) && hasPosition(b) ? haversine(a, b) : 0)
  }
  return cumDist
}

/**
 * True when the device's own cumulative distance stream is usable for the
 * whole track: every point carries a finite `distanceM`, the series is
 * non-decreasing inside each continuous span (a pause repeats a value), and
 * it is not all zeros. Resets at marked span starts are allowed. A field
 * that appears on only some points, goes backwards within a span, or is
 * uniformly zero is treated as absent — half a device series is worse than
 * none, because splicing it onto haversine would put a discontinuity in the
 * cumulative distance.
 */
export function hasUsableDeviceDistance(points: { distanceM?: number; segmentStart?: boolean }[]): boolean {
  return deviceDistanceFallback(points) === null
}

export function deviceDistanceFallback(points: { distanceM?: number; segmentStart?: boolean }[]): import('./types.js').DataQuality['deviceDistanceFallback'] {
  if (points.length === 0 || points.every(p => p.distanceM == null)) return 'missing'
  let prev = -Infinity
  let max = 0
  for (const p of points) {
    const d = p.distanceM
    if (d == null) return 'incomplete'
    if (!Number.isFinite(d) || d < 0) return 'invalid'
    if (!p.segmentStart && d < prev) return 'decreasing'
    prev = d
    if (d > max) max = d
  }
  return max > 0 ? null : 'all-zero'
}

/**
 * Cumulative distance in metres, one entry per point, index 0 = 0, built from
 * whichever source is trustworthy for the *whole* track: the device's own
 * `distanceM` stream when {@link hasUsableDeviceDistance} holds, otherwise
 * summed haversine ({@link cumulativeDistances}). Never mix the two per
 * segment. The device series is re-based to the first point so it shares
 * haversine's frame (progress within recorded spans, excluding edges across
 * marked breaks and any device offset before a span's first GPS fix).
 *
 * This is the single series that must feed `distanceM`, `splits[]`,
 * `bestKmPaceSecPerKm` and the elevation chart's x-axis — compute it once.
 */
export function cumulativeDistanceSeries(
  points: { lat?: number; lon?: number; distanceM?: number; segmentStart?: boolean }[]
): { cumDist: number[]; source: 'device' | 'computed' | 'unavailable' } {
  if (hasUsableDeviceDistance(points)) {
    const base = points[0].distanceM!
    let gapDistance = 0
    const cumDist = points.map((p, i) => {
      if (i > 0 && p.segmentStart) gapDistance += p.distanceM! - points[i - 1].distanceM!
      return p.distanceM! - base - gapDistance
    })
    return { cumDist, source: 'device' }
  }
  const hasGpsEdge = points.some((p, i) => i > 0 && !p.segmentStart && hasPosition(p) && hasPosition(points[i - 1]))
  // Empty/single GPS tracks retain their historical computed source.
  return { cumDist: cumulativeDistances(points), source: hasGpsEdge || points.length < 2 && points.every(hasPosition) ? 'computed' : 'unavailable' }
}

/** Inclusive index ranges for continuous recorded spans. */
export function continuousRanges(points: { segmentStart?: boolean }[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  let start = 0
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || points[i].segmentStart) {
      ranges.push({ start, end: i - 1 })
      start = i
    }
  }
  return ranges
}
