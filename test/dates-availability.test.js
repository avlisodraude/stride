import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, analyze } from '../dist/index.js'
import { formatStats } from '../dist/cli-lib.js'

const gpxPoint = timestamp => `<trkpt lat="0" lon="0"><time>${timestamp}</time><extensions><TrackPointExtension><hr>150</hr></TrackPointExtension></extensions></trkpt>`
const gpx = timestamp => `<gpx><trk><trkseg>${gpxPoint(timestamp)}</trkseg></trk></gpx>`
const tcxPoint = (timestamp, distance = 0) => `<Trackpoint><Time>${timestamp}</Time><DistanceMeters>${distance}</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>`
const tcx = (records, id = '') => `<TrainingCenterDatabase><Activities><Activity>${id ? `<Id>${id}</Id>` : ''}<Lap><Track>${records}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`
const at = seconds => new Date(seconds * 1000)

// Calendar validation must precede UTC conversion: the written local calendar
// date and the resulting UTC date can legitimately be on different days.
describe.each([['GPX', gpx], ['TCX', timestamp => tcx(tcxPoint(timestamp))]])('%s calendar timestamps', (_name, document) => {
  test.each([
    '2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z', '1900-02-29T12:00:00Z',
    '2026-04-31T12:00:00Z', '2026-06-31T12:00:00Z', '2026-02-30T00:00:00+14:00',
    '2026-00-01T12:00:00Z', '2026-13-01T12:00:00Z', '2026-01-00T12:00:00Z', '2026-01-32T12:00:00Z',
    '2026-01-01T24:01:00Z', '2026-01-01T24:00:00.001Z', '2026-01-01T25:00:00Z',
    '2026-01-01T12:60:00Z', '2026-01-01T12:00:60Z',
    '2026-01-01T12:00:00+14:01', '2026-01-01T12:00:00+15:00', '2026-01-01T12:00:00-14:01', '2026-01-01T12:00:00+01:60',
    '0000-01-01T12:00:00Z', '2026-02-28', 'March 2, 2026', '2026',
  ])('drops invalid dateTime %s without normalizing or discarding its valid sensors', timestamp => {
    const parsed = parse(document(timestamp))
    expect(parsed.points[0].timestamp).toBeUndefined()
    expect(parsed.points[0].heartRate).toBe(150)
    expect(parsed.parseDiagnostics.droppedReadings).toBe(1)
    expect(analyze(parsed).quality.warnings).toContain('dropped-readings')
  })

  test.each([
    ['2024-02-29T12:00:00Z', '2024-02-29T12:00:00.000Z'],
    ['2000-02-29T12:00:00Z', '2000-02-29T12:00:00.000Z'],
    ['2026-02-28T23:59:59.123456Z', '2026-02-28T23:59:59.123Z'],
    ['2026-03-01T00:30:00+01:00', '2026-02-28T23:30:00.000Z'],
    ['2024-02-29T23:30:00-01:00', '2024-03-01T00:30:00.000Z'],
    ['2026-01-01T00:00:00+14:00', '2025-12-31T10:00:00.000Z'],
    ['2026-12-31T23:59:59-14:00', '2027-01-01T13:59:59.000Z'],
    ['2026-02-28T24:00:00Z', '2026-03-01T00:00:00.000Z'],
    ['2024-02-29T24:00:00.0000+01:00', '2024-02-29T23:00:00.000Z'],
    ['0096-02-29T12:00:00Z', '0096-02-29T12:00:00.000Z'],
  ])('keeps valid dateTime %s', (timestamp, expected) => {
    const parsed = parse(document(timestamp))
    expect(parsed.points[0].timestamp.toISOString()).toBe(expected)
    expect(parsed.parseDiagnostics.droppedReadings).toBe(0)
  })

  test('keeps the existing local-time interpretation when the timezone is omitted', () => {
    const date = parse(document('2026-02-28T12:30:45')).points[0].timestamp
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([2026, 1, 28, 12, 30, 45])
  })
})

test('an invalid interior calendar date uses the existing interpolation policy', () => {
  const input = parse(tcx(tcxPoint('2026-02-28T12:00:00Z', 0) + tcxPoint('2026-02-30T12:02:30Z', 500) + tcxPoint('2026-02-28T12:05:00Z', 1000)))
  const stats = analyze(input)
  expect(stats).toMatchObject({ elapsedTimeSec: 300, avgPaceSecPerKm: 300, bestKmPaceSecPerKm: 300 })
  expect(stats.quality).toMatchObject({ timingSource: 'interpolated', missingTimestamps: 1 })
  expect(stats.quality.parseDiagnostics.droppedReadings).toBe(1)
})

test('an invalid endpoint cannot silently become a different day', () => {
  const input = parse(tcx(tcxPoint('2026-02-30T12:00:00Z', 0) + tcxPoint('2026-03-02T12:05:00Z', 1000)))
  expect(() => analyze(input)).toThrow(/Incomplete timing/)
})

test('an invalid TCX activity Id falls back to the first valid point time', () => {
  const input = parse(tcx(tcxPoint('2026-02-28T12:00:00Z'), '2026-02-30T12:00:00Z'))
  expect(input.startTime.toISOString()).toBe('2026-02-28T12:00:00.000Z')
})

describe('sparse heart-rate readings', () => {
  test.each([undefined, at(0)])('one valid sample supplies maximum HR without duration-weighted averages (time=%s)', timestamp => {
    const input = { format: 'fit', points: [{ heartRate: 150, cadence: 170, timestamp }] }
    const stats = analyze(input)
    expect(stats).toMatchObject({ maxHeartRate: 150, avgHeartRate: null, avgCadence: null, hrZones: null, elapsedTimeSec: 0 })
    expect(stats.quality.timingSource).toBe('unavailable')
    const output = formatStats('Single sample', stats)
    expect(output).toContain('Max HR:        150 bpm')
    expect(output).not.toContain('Avg HR:')
    expect(output).not.toContain('Avg cadence:')
  })

  test.each([[], [{ cadence: 170 }]].map(points => [points]))('empty/no-HR activities keep maximum HR unavailable (%j)', points => {
    expect(analyze({ format: 'fit', points }).maxHeartRate).toBeNull()
  })

  test('a known maximum is shown even when multiple points have no HR-covered duration', () => {
    const stats = analyze({ format: 'fit', points: [{ timestamp: at(0), distanceM: 0, heartRate: 150 }, { timestamp: at(60), distanceM: 100 }] })
    expect(stats).toMatchObject({ maxHeartRate: 150, avgHeartRate: null })
    expect(formatStats('Sparse HR', stats)).toContain('Max HR:        150 bpm')
  })
})

describe.each(['metric', 'imperial'])('CLI unavailable measurements (%s)', units => {
  test('sensor-only activity keeps elapsed time and HR while labelling distance, movement and pace unavailable', () => {
    const stats = analyze({ format: 'fit', points: [{ timestamp: at(0), heartRate: 140 }, { timestamp: at(60), heartRate: 150 }] })
    const output = formatStats('Indoor workout', stats, units)
    expect(output).toContain('Distance:      Unavailable')
    expect(output).toContain('Moving time:   Unavailable')
    expect(output).toContain('Avg pace:      Unavailable')
    expect(output).toContain('Elapsed time:  1:00')
    expect(output).toContain('Avg HR:        150 bpm')
    // Formatting never rewrites the machine-readable stats.
    expect(stats).toMatchObject({ distanceM: 0, avgPaceSecPerKm: 0, movingTimeSec: 0 })
  })

  test('a measured stationary activity retains its zero distance and moving time', () => {
    const stats = analyze({ format: 'gpx', points: [{ lat: 0, lon: 0, timestamp: at(0) }, { lat: 0, lon: 0, timestamp: at(60) }] })
    const output = formatStats('Stationary', stats, units)
    expect(output).toContain(`Distance:      0.00 ${units === 'metric' ? 'km' : 'mi'}`)
    expect(output).toContain('Moving time:   0:00')
    expect(output).toContain('Elapsed time:  1:00')
    expect(output).toContain('Avg pace:      Unavailable')
  })

  test('timer-backed movement remains available without a distance stream', () => {
    const stats = analyze({ format: 'fit', points: [{ timestamp: at(0), heartRate: 140 }, { timestamp: at(60), heartRate: 150 }], timerEvents: [{ timestamp: at(0), type: 'start' }, { timestamp: at(60), type: 'stop' }] })
    const output = formatStats('Indoor timer', stats, units)
    expect(output).toContain('Distance:      Unavailable')
    expect(output).toContain('Moving time:   1:00')
    expect(output).toContain('Avg pace:      Unavailable')
  })

  test.each([[], [{ lat: 0, lon: 0, timestamp: at(0), heartRate: 150 }]].map(points => [points]))('sparse activity does not present placeholders as measurements (%j)', points => {
    const output = formatStats('Sparse activity', analyze({ format: 'gpx', points }), units)
    for (const label of ['Distance:      ', 'Moving time:   ', 'Elapsed time:  ', 'Avg pace:      ']) expect(output).toContain(label + 'Unavailable')
  })

  test('documented untimed estimates remain visible and labelled assumed', () => {
    const stats = analyze({ format: 'fit', points: [{ distanceM: 0 }, { distanceM: 100 }] })
    const output = formatStats('Untimed', stats, units)
    expect(output).toContain('Elapsed time:  0:01')
    expect(output).toContain('Timing source: assumed')
    expect(output).not.toContain('Distance:      Unavailable')
  })
})

test('the actual CLI keeps numeric JSON and formats sparse text output independently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stride-availability-'))
  try {
    const file = join(directory, 'one-sample.tcx')
    writeFileSync(file, tcx(tcxPoint('2026-01-01T12:00:00Z')))
    const output = execFileSync(process.execPath, ['dist/cli.js', 'analyze', file], { encoding: 'utf8' })
    const json = JSON.parse(execFileSync(process.execPath, ['dist/cli.js', 'analyze', file, '--json'], { encoding: 'utf8' }))
    expect(output).toContain('Distance:      Unavailable')
    expect(output).toContain('Avg pace:      Unavailable')
    expect(output).toContain('Max HR:        150 bpm')
    expect(json).toMatchObject({ distanceM: 0, elapsedTimeSec: 0, avgPaceSecPerKm: 0, maxHeartRate: 150, avgHeartRate: null })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
