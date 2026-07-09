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
    expect(stats.elevationGainM).toBeGreaterThan(0)
    expect(stats.splits.length).toBeGreaterThanOrEqual(1)
  })
})
