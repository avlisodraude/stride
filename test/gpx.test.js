import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'
import { parse, analyze } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

function readFixture(name) {
  return fs.readFileSync(join(here, 'fixtures', name), 'utf-8')
}

describe('GPX parsing', () => {
  test('single <trk>, single <trkseg> — baseline', () => {
    const activity = parse(readFixture('gpx-single-trk-single-seg.gpx'))
    expect(activity.format).toBe('gpx')
    expect(activity.name).toBe('Morning Run')
    expect(activity.type).toBe('running')
    expect(activity.points.length).toBe(3)
    expect(activity.points[0].lat).toBeCloseTo(52.37, 4)
    expect(activity.points[0].lon).toBeCloseTo(4.9, 4)
    expect(activity.points[2].lat).toBeCloseTo(52.3702, 4)
    expect(activity.points[2].lon).toBeCloseTo(4.9002, 4)
  })

  test('single <trk>, multiple <trkseg> — points from both segments, in order', () => {
    const activity = parse(readFixture('gpx-single-trk-multi-seg.gpx'))
    expect(activity.points.length).toBe(5)
    // First two points from segment 1, remaining three from segment 2, in order.
    expect(activity.points[0].lat).toBeCloseTo(52.1, 4)
    expect(activity.points[1].lat).toBeCloseTo(52.1001, 4)
    expect(activity.points[2].lat).toBeCloseTo(52.2, 4)
    expect(activity.points[3].lat).toBeCloseTo(52.2001, 4)
    expect(activity.points[4].lat).toBeCloseTo(52.2002, 4)
  })

  test('multiple <trk>, one <trkseg> each — regression: points must not be dropped', () => {
    const activity = parse(readFixture('gpx-multi-trk.gpx'))
    expect(activity.points.length).toBe(5)

    const first = activity.points[0]
    expect(first.lat).toBeCloseTo(10.0, 4)
    expect(first.lon).toBeCloseTo(20.0, 4)

    const last = activity.points[activity.points.length - 1]
    expect(last.lat).toBeCloseTo(30.001, 4)
    expect(last.lon).toBeCloseTo(40.001, 4)
  })

  test('multiple <trk>, only the second carries a <name> — name resolves from first track only', () => {
    const activity = parse(readFixture('gpx-multi-trk-second-name.gpx'))
    // No gpx.metadata.name, and the first track has no <name>, so the name
    // must NOT fall back to a later track's name — it stays undefined.
    expect(activity.name).toBeUndefined()
    expect(activity.type).toBe('cycling')
    expect(activity.points.length).toBe(3)
  })

  test('malformed lat is skipped, not thrown on', () => {
    const activity = parse(readFixture('gpx-malformed-lat.gpx'))
    expect(activity.points.length).toBe(2)
    expect(activity.points[0].lat).toBeCloseTo(52.5, 4)
    expect(activity.points[1].lat).toBeCloseTo(52.5002, 4)
  })

  // Every other GPX fixture in this directory has a total elevation range
  // under 3m, so none of them exercises the hysteresis filter's positive
  // case at the library's default threshold (8m, metrics-spec.md §5.3).
  // This fixture is a hand-built hill-climb profile: noise oscillation that
  // must not be counted, a confirmed climb well above 8m, a confirmed
  // descent, then more noise. Elevations (m), one point every 5s:
  //   100, 103, 97, 102, 105, 109, 115, 119, 128, 130, 118, 112, 105, 108, 100, 106, 101
  //
  // Hand-traced through elevationHysteresis (default T=8m), ref = last
  // confirmed point, diff computed against ref:
  //   ref=100 (p0)
  //   103: diff=+3  (<8)  ignore                        ref=100
  //   97:  diff=-3  (<8)  ignore                        ref=100
  //   102: diff=+2  (<8)  ignore                        ref=100
  //   105: diff=+5  (<8)  ignore                        ref=100
  //   109: diff=+9  (>=8) CONFIRMED CLIMB  gain+=9 (9)   ref=109
  //   115: diff=+6  (<8)  ignore                        ref=109
  //   119: diff=+10 (>=8) CONFIRMED CLIMB  gain+=10 (19) ref=119
  //   128: diff=+9  (>=8) CONFIRMED CLIMB  gain+=9  (28) ref=128
  //   130: diff=+2  (<8)  ignore                        ref=128
  //   118: diff=-10 (>=8) CONFIRMED DESCENT loss+=10 (10) ref=118
  //   112: diff=-6  (<8)  ignore                        ref=118
  //   105: diff=-13 (>=8) CONFIRMED DESCENT loss+=13 (23) ref=105
  //   108: diff=+3  (<8)  ignore                        ref=105
  //   100: diff=-5  (<8)  ignore                        ref=105
  //   106: diff=+1  (<8)  ignore                        ref=105
  //   101: diff=-4  (<8)  ignore                        ref=105
  // totalGainM = 9 + 10 + 9 = 28; totalLossM = 10 + 13 = 23
  test('gpx-climb fixture — hysteresis confirms the climb/descent and rejects surrounding noise', () => {
    const stats = analyze(parse(readFixture('gpx-climb.gpx')))
    expect(stats.elevationGainM).toBe(28)
    expect(stats.elevationLossM).toBe(23)
  })
})

describe('GPX parsing — malformed values are dropped, never surfaced as NaN', () => {
  const malformedGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk><name>Corrupt</name><type>running</type><trkseg>
    <trkpt lat="52.3700" lon="4.9000">
      <ele>banana</ele>
      <time>not-a-timestamp</time>
      <extensions><gpxtpx:TrackPointExtension>
        <gpxtpx:hr>oops</gpxtpx:hr>
        <gpxtpx:cad></gpxtpx:cad>
      </gpxtpx:TrackPointExtension></extensions>
    </trkpt>
    <trkpt lat="52.3701" lon="4.9001">
      <ele>3.0</ele>
      <time>2026-01-01T08:00:01Z</time>
      <extensions><gpxtpx:TrackPointExtension>
        <gpxtpx:hr>140</gpxtpx:hr>
        <gpxtpx:cad>85</gpxtpx:cad>
      </gpxtpx:TrackPointExtension></extensions>
    </trkpt>
  </trkseg></trk>
</gpx>`

  test('non-numeric ele/hr/cad and unparseable time are absent, not NaN', () => {
    const activity = parse(malformedGpx)
    expect(activity.points.length).toBe(2)
    const [bad, good] = activity.points
    expect(bad.elevation).toBeUndefined()
    expect(bad.heartRate).toBeUndefined()
    expect(bad.cadence).toBeUndefined()
    expect(bad.timestamp).toBeUndefined()
    expect(good.heartRate).toBe(140)
    expect(good.cadence).toBe(170)
  })

  test('analyze() over a partially-corrupt track yields finite HR stats, not NaN', () => {
    const stats = analyze(parse(malformedGpx))
    expect(stats.avgHeartRate).toBe(140)
    expect(stats.maxHeartRate).toBe(140)
    expect(Number.isNaN(stats.avgCadence)).toBe(false)
  })
})
