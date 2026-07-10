import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'
import { parse, analyze } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixtures', 'sample-run.tcx')
const tcxString = fs.readFileSync(fixturePath, 'utf-8')

describe('TCX parsing', () => {
  test('parses a raw TCX string into a normalised activity', () => {
    const activity = parse(tcxString)
    expect(activity.format).toBe('tcx')
    expect(activity.type).toBe('running')
    expect(activity.points.length).toBe(601)

    const first = activity.points[0]
    expect(first.lat).toBeCloseTo(52.35, 2)
    expect(first.lon).toBeCloseTo(4.9, 2)
    expect(first.heartRate).toBeGreaterThan(0)
    expect(first.cadence).toBeGreaterThan(0)
    expect(first.elevation).toBeGreaterThan(0)
    expect(first.timestamp instanceof Date).toBe(true)
  })

  test('auto-detects TCX from a file path', () => {
    const activity = parse(fixturePath)
    expect(activity.format).toBe('tcx')
    expect(activity.points.length).toBe(601)
  })

  test('computes running metrics from TCX data', () => {
    const stats = analyze(parse(tcxString))
    // The fixture carries <DistanceMeters>, so distance comes from the device
    // stream (1980m) rather than the summed haversine path (~1983m).
    expect(stats.distanceSource).toBe('device')
    expect(stats.distanceM).toBeGreaterThan(1900)
    expect(stats.distanceM).toBeLessThan(2100)
    expect(stats.movingTimeSec).toBeGreaterThan(590)
    expect(stats.avgPaceSecPerKm).toBeGreaterThan(280)
    expect(stats.avgPaceSecPerKm).toBeLessThan(330)
    expect(stats.avgHeartRate).not.toBeNull()
    expect(stats.avgCadence).not.toBeNull()
    expect(stats.hrZones).not.toBeNull()
    // This fixture's altitude stream is essentially flat (2-14m range) and
    // never confirms a climb against the 8m GPS-derived default threshold
    // (metrics-spec.md §5.3) — correctly so, per the hysteresis filter.
    // Positive-case coverage for real climbs lives in gpx.test.js's
    // gpx-climb fixture.
    expect(stats.elevationGainM).toBe(0)
    expect(stats.splits.length).toBeGreaterThanOrEqual(1)
  })
})

describe('TCX parsing — malformed values are dropped, never surfaced as NaN', () => {
  const malformedTcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running">
  <Id>not-a-date</Id>
  <Lap StartTime="also-bad">
    <Track>
      <Trackpoint>
        <Time>garbage</Time>
        <Position><LatitudeDegrees>52.3700</LatitudeDegrees><LongitudeDegrees>4.9000</LongitudeDegrees></Position>
        <AltitudeMeters>tall</AltitudeMeters>
        <HeartRateBpm/>
        <Extensions><TPX><RunCadence>fast</RunCadence></TPX></Extensions>
      </Trackpoint>
      <Trackpoint>
        <Time>2026-01-01T08:00:01Z</Time>
        <Position><LatitudeDegrees>52.3701</LatitudeDegrees><LongitudeDegrees>4.9001</LongitudeDegrees></Position>
        <AltitudeMeters>3.0</AltitudeMeters>
        <HeartRateBpm><Value>150</Value></HeartRateBpm>
        <Extensions><TPX><RunCadence>85</RunCadence></TPX></Extensions>
      </Trackpoint>
    </Track>
  </Lap>
</Activity></Activities></TrainingCenterDatabase>`

  test('non-numeric altitude/cadence, empty HeartRateBpm and bad dates are absent, not NaN or 0', () => {
    const activity = parse(malformedTcx)
    expect(activity.points.length).toBe(2)
    const [bad, good] = activity.points
    expect(bad.elevation).toBeUndefined()
    expect(bad.heartRate).toBeUndefined() // empty <HeartRateBpm/> must not coerce to 0
    expect(bad.cadence).toBeUndefined()
    expect(bad.timestamp).toBeUndefined()
    expect(good.heartRate).toBe(150)
    expect(good.cadence).toBe(170)
    // Unparseable <Id> yields no startTime (points[0] has none either) —
    // absent, rather than an Invalid Date whose getTime() is NaN.
    expect(activity.startTime).toBeUndefined()
  })

  test('analyze() over a partially-corrupt track yields finite HR stats, not NaN', () => {
    const stats = analyze(parse(malformedTcx))
    expect(stats.avgHeartRate).toBe(150)
    expect(stats.maxHeartRate).toBe(150)
  })
})
