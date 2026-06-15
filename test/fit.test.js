import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'
import { parse, analyze } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixtures', 'sample-run.fit')
const fixtureBytes = fs.readFileSync(fixturePath)

describe('FIT parsing', () => {
  test('parses FIT bytes into a normalised activity', () => {
    const activity = parse(new Uint8Array(fixtureBytes))
    expect(activity.format).toBe('fit')
    expect(activity.type).toBe('running')
    expect(activity.name).toBe('Morning Run')
    expect(activity.points.length).toBe(601)

    const first = activity.points[0]
    expect(first.lat).toBeCloseTo(52.35, 2)
    expect(first.lon).toBeCloseTo(4.9, 2)
    expect(first.heartRate).toBeGreaterThan(0)
    expect(first.cadence).toBeGreaterThan(0)
    expect(first.elevation).toBeGreaterThan(0)
    expect(first.timestamp instanceof Date).toBe(true)
  })

  test('auto-detects FIT from a file path', () => {
    const activity = parse(fixturePath)
    expect(activity.format).toBe('fit')
    expect(activity.points.length).toBe(601)
  })

  test('accepts an ArrayBuffer', () => {
    const ab = fixtureBytes.buffer.slice(
      fixtureBytes.byteOffset,
      fixtureBytes.byteOffset + fixtureBytes.byteLength,
    )
    const activity = parse(ab)
    expect(activity.format).toBe('fit')
    expect(activity.points.length).toBe(601)
  })

  test('computes running metrics from FIT data', () => {
    const stats = analyze(parse(new Uint8Array(fixtureBytes)))
    expect(stats.distanceM).toBeGreaterThan(1900)
    expect(stats.distanceM).toBeLessThan(2100)
    expect(stats.movingTimeSec).toBeGreaterThan(590)
    expect(stats.avgPaceSecPerKm).toBeGreaterThan(280)
    expect(stats.avgPaceSecPerKm).toBeLessThan(330)
    expect(stats.avgHeartRate).not.toBeNull()
    expect(stats.maxHeartRate).toBeGreaterThanOrEqual(stats.avgHeartRate)
    expect(stats.avgCadence).not.toBeNull()
    expect(stats.hrZones).not.toBeNull()
    expect(stats.elevationGainM).toBeGreaterThan(0)
    expect(stats.splits.length).toBeGreaterThanOrEqual(1)
  })
})

describe('GPX parsing still works', () => {
  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk><name>Tiny GPX</name><type>running</type><trkseg>
    <trkpt lat="52.3500" lon="4.9000"><ele>8</ele><time>2026-06-01T07:00:00Z</time></trkpt>
    <trkpt lat="52.3501" lon="4.9007"><ele>9</ele><time>2026-06-01T07:00:10Z</time></trkpt>
  </trkseg></trk>
</gpx>`

  test('parses a raw GPX string', () => {
    const activity = parse(gpx)
    expect(activity.format).toBe('gpx')
    expect(activity.name).toBe('Tiny GPX')
    expect(activity.points.length).toBe(2)
  })
})
