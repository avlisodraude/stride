/**
 * Device-reported distance vs summed haversine (types.ts distanceM /
 * ActivityStats.distanceSource). Fixtures are built on the equator so that
 * haversine distance is `lon_deg × 111194.93 m` (docs/metrics-spec.md
 * Appendix A) and can be reasoned about against the device figure.
 */
import { parse, analyze } from '../dist/index.js'

// One straight-line TCX track on the equator. `pts` is [{ lon, dist }, ...]
// where `dist` becomes <DistanceMeters> (cumulative). `lat` is fixed at 0.
function tcx(pts) {
  const start = '2026-06-01T07:00:00.000Z'
  const trackpoints = pts.map((p, i) => {
    const t = new Date(Date.parse(start) + i * 1000).toISOString()
    const dist = p.dist == null ? '' : `<DistanceMeters>${p.dist}</DistanceMeters>`
    return `<Trackpoint><Time>${t}</Time><Position>` +
      `<LatitudeDegrees>0.0000000</LatitudeDegrees>` +
      `<LongitudeDegrees>${p.lon.toFixed(7)}</LongitudeDegrees>` +
      `</Position>${dist}</Trackpoint>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>${start}</Id>
    <Lap StartTime="${start}"><Track>${trackpoints}</Track></Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`
}

// lon that yields ~500 m of haversine on the equator (500 / 111194.93).
const LON_500M = 0.0044966

describe('device distance preferred over summed haversine', () => {
  test('TCX: DistanceMeters (980) wins over the ~1000m haversine sum', () => {
    // Two 500m haversine segments -> ~1000m summed, but the device says 980m.
    const activity = parse(tcx([
      { lon: 0, dist: 0 },
      { lon: LON_500M, dist: 490 },
      { lon: 2 * LON_500M, dist: 980 },
    ]))
    // Sanity: the raw GPS path really is ~1000m, so the two disagree.
    const haversineActivity = parse(tcx([
      { lon: 0 }, { lon: LON_500M }, { lon: 2 * LON_500M },
    ]))
    expect(analyze(haversineActivity).distanceM).toBeGreaterThan(995)

    const stats = analyze(activity)
    expect(stats.distanceSource).toBe('device')
    expect(stats.distanceM).toBe(980)
  })

  test('TCX: a non-monotonic DistanceMeters stream falls back to computed', () => {
    // 0 -> 500 -> 480 goes backwards, so the device stream is discarded and
    // distance is the ~1000m haversine sum instead.
    const stats = analyze(parse(tcx([
      { lon: 0, dist: 0 },
      { lon: LON_500M, dist: 500 },
      { lon: 2 * LON_500M, dist: 480 },
    ])))
    expect(stats.distanceSource).toBe('computed')
    expect(stats.distanceM).toBeGreaterThan(995)
  })

  test('TCX: an all-zero DistanceMeters stream falls back to computed', () => {
    const stats = analyze(parse(tcx([
      { lon: 0, dist: 0 },
      { lon: LON_500M, dist: 0 },
      { lon: 2 * LON_500M, dist: 0 },
    ])))
    expect(stats.distanceSource).toBe('computed')
    expect(stats.distanceM).toBeGreaterThan(995)
  })

  test('TCX: a stream present on only some points falls back to computed', () => {
    // Half a device series must be treated as absent, not spliced onto
    // haversine (that would put a discontinuity in the cumulative distance).
    const stats = analyze(parse(tcx([
      { lon: 0, dist: 0 },
      { lon: LON_500M },              // no DistanceMeters here
      { lon: 2 * LON_500M, dist: 980 },
    ])))
    expect(stats.distanceSource).toBe('computed')
  })

  test('GPX: no distance element, so distanceSource is always computed', () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="0.0" lon="0.0"><time>2026-06-01T07:00:00Z</time></trkpt>
  <trkpt lat="0.0" lon="${LON_500M}"><time>2026-06-01T07:00:01Z</time></trkpt>
  <trkpt lat="0.0" lon="${2 * LON_500M}"><time>2026-06-01T07:00:02Z</time></trkpt>
</trkseg></trk></gpx>`
    const activity = parse(gpx)
    expect(activity.points.every(p => p.distanceM == null)).toBe(true)
    expect(analyze(activity).distanceSource).toBe('computed')
  })
})
