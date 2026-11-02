import { Encoder, Profile } from '@garmin/fitsdk'
import { analyze, parse } from '../dist/index.js'
import { heartRateChartConfig, splitsChartConfig, paceChartConfig } from '../dist/charts.js'
import { parseArgs, formatStats } from '../dist/cli-lib.js'

const date = sec => new Date(Date.UTC(2026, 0, 1) + sec * 1000)
const point = (distanceM, sec, extra = {}) => ({ distanceM, timestamp: date(sec), heartRate: 150, cadence: 170, ...extra })
const activity = points => ({ format: 'fit', points })
const timer = (sec, type, extra = {}) => ({ timestamp: date(sec), type, ...extra })
const tcx = records => `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap><Track>${records}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`

function indoorFit(eventTypes = ['start', 'stopAll']) {
  const enc = new Encoder()
  const M = Profile.MesgNum
  enc.writeMesg({ mesgNum: M.FILE_ID, type: 'activity', manufacturer: 'development', timeCreated: date(0) })
  if (eventTypes[0]) enc.writeMesg({ mesgNum: M.EVENT, timestamp: date(0), event: 'timer', eventType: eventTypes[0], eventGroup: 0 })
  for (let i = 0; i < 3; i++) enc.writeMesg({ mesgNum: M.RECORD, timestamp: date(i * 60), distance: i * 200, heartRate: 150 + i, cadence: 85 })
  if (eventTypes[1]) enc.writeMesg({ mesgNum: M.EVENT, timestamp: date(120), event: 'timer', eventType: eventTypes[1], eventGroup: 0 })
  return enc.close()
}

describe('indoor samples and quality reporting', () => {
  test('FIT preserves GPS-less distance, HR, cadence and timer events', () => {
    const parsed = parse(indoorFit())
    expect(parsed.points).toHaveLength(3)
    expect(parsed.points.every(p => p.lat == null && p.lon == null)).toBe(true)
    expect(parsed.points[2]).toMatchObject({ distanceM: 400, heartRate: 152, cadence: 170 })
    expect(parsed.timerEvents.map(e => e.type)).toEqual(['start', 'stop'])
    const stats = analyze(parsed)
    expect(stats).toMatchObject({ distanceM: 400, distanceSource: 'device', avgHeartRate: 152, avgCadence: 170, timerTimeSec: 120, movingTimeSource: 'timer' })
    expect(stats.quality).toMatchObject({ missingPositions: 3, unknownDistanceIntervals: 0, timingSource: 'recorded' })
  })

  test('TCX retains indoor sensors and distance without manufacturing a position', () => {
    const parsed = parse(tcx([0, 1, 2].map(i => `<Trackpoint><Time>${date(i * 60).toISOString()}</Time><DistanceMeters>${i * 200}</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm><Extensions><TPX><RunCadence>85</RunCadence></TPX></Extensions></Trackpoint>`).join('')))
    expect(parsed.points).toHaveLength(3)
    expect(parsed.points[0].lat).toBeUndefined()
    expect(analyze(parsed)).toMatchObject({ distanceM: 400, avgHeartRate: 150, avgCadence: 170, distanceSource: 'device' })
  })

  test('sensor-only workouts report unavailable distance, retain duration and render HR over time', () => {
    const workout = activity([point(undefined, 0), point(undefined, 60), point(undefined, 120)])
    const stats = analyze(workout)
    expect(stats).toMatchObject({ distanceM: 0, distanceSource: 'unavailable', elapsedTimeSec: 120, movingTimeSource: 'unavailable', avgHeartRate: 150, splits: [] })
    expect(stats.quality.unknownDistanceIntervals).toBe(2)
    expect(stats.quality.warnings).toContain('distance-unavailable')
    const config = heartRateChartConfig(workout, stats)
    expect(config.options.scales.x.title.text).toBe('Elapsed time (min)')
    expect(config.data.datasets[0].data.map(p => p.x)).toEqual([0, 1, 2])
  })

  test('untimed sensor charts use an explicit sample index', () => {
    const workout = activity([{ heartRate: 120 }, { heartRate: 130 }, { heartRate: 140 }])
    const stats = analyze(workout)
    expect(stats.quality.timingSource).toBe('assumed')
    expect(heartRateChartConfig(workout, stats).options.scales.x.title.text).toBe('Sample index')
  })

  test('GPS fallback never bridges missing coordinates', () => {
    const workout = activity([point(undefined, 0, { lat: 0, lon: 0 }), point(undefined, 10), point(undefined, 20, { lat: 0, lon: 1 }), point(undefined, 30, { lat: 0, lon: 1.001 })])
    const stats = analyze(workout)
    expect(stats.distanceM).toBe(111)
    expect(stats.quality.unknownDistanceIntervals).toBe(2)
    expect(stats.bestKmPaceSecPerKm).toBeNull()
  })

  test('invalid coordinates in TCX discard the position while retaining valid sensors', () => {
    const parsed = parse(tcx('<Trackpoint><Position><LatitudeDegrees>95</LatitudeDegrees><LongitudeDegrees>0</LongitudeDegrees></Position><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>'))
    expect(parsed.points).toEqual([{ heartRate: 150 }])
    expect(parsed.parseDiagnostics.invalidPositions).toBe(1)
    expect(parsed.parseDiagnostics.droppedRecords).toBe(0)
  })

  test('parser reports discarded GPX records and malformed readings without their values', () => {
    const parsed = parse('<gpx><trk><trkseg><trkpt lat="999" lon="0"/><trkpt lat="0" lon="0"><time>bad</time><ele>bad</ele><extensions><TrackPointExtension><hr>0</hr><cad>-1</cad></TrackPointExtension></extensions></trkpt></trkseg></trk></gpx>')
    expect(parsed.parseDiagnostics).toEqual({ totalRecords: 2, droppedRecords: 1, invalidPositions: 1, droppedReadings: 4, droppedTimerEvents: 0 })
    expect(analyze(parsed).quality.warnings).toEqual(expect.arrayContaining(['dropped-records', 'dropped-readings', 'invalid-positions']))
    expect(JSON.stringify(parsed.parseDiagnostics)).not.toContain('999')
  })

  test.each([
    [[undefined, undefined], 'missing'], [[0, undefined], 'incomplete'], [[0, -1], 'invalid'], [[5, 4], 'decreasing'], [[0, 0], 'all-zero'], [[0, 10], null],
  ])('explains device-distance fallback for %j', (distances, reason) => {
    const stats = analyze(activity(distances.map((d, i) => point(d, i, { lat: 0, lon: i * 0.001 }))))
    expect(stats.quality.deviceDistanceFallback).toBe(reason)
  })

  test('reports interpolated timing and independent elevation fallback reasons', () => {
    const workout = { ...activity([point(0, 0, { elevation: 0 }), point(100, 10, { timestamp: undefined, elevation: 10 }), point(200, 20, { elevation: 20 })]), deviceElevationGainM: 0, deviceElevationLossM: -1 }
    const stats = analyze(workout)
    expect(stats.quality).toMatchObject({ timingSource: 'interpolated', missingTimestamps: 1, elevationGainFallback: 'contradictory-zero', elevationLossFallback: 'invalid' })
    expect(stats.quality.warnings).toContain('interpolated-timing')
    expect(formatStats('Workout', stats)).toContain('interpolated-timing')
  })

  test('a raw device total smaller than the rounded result is suppressed', () => {
    expect(analyze({ ...activity([point(0, 0), point(1000.5, 300)]), deviceDistanceM: 1000.5 }).deviceDistanceM).toBeUndefined()
  })

  test.each([{ lat: 0 }, { lon: 0 }, { lat: NaN, lon: 0 }])('rejects partial/invalid manually supplied positions (%j)', position => {
    expect(() => analyze(activity([point(0, 0, position), point(10, 10)]))).toThrow(/Invalid coordinates/)
  })
})

describe('FIT timer pause detection', () => {
  const workout = () => ({ ...activity([point(0, 0), point(200, 60), point(400, 120)]), timerEvents: [timer(0, 'start'), timer(30, 'stop'), timer(90, 'start'), timer(120, 'stop')] })

  test('clips intervals at pause/resume events between record timestamps', () => {
    expect(analyze(workout())).toMatchObject({ timerTimeSec: 60, movingTimeSec: 60, elapsedTimeSec: 120, movingTimeSource: 'timer', avgPaceSecPerKm: 150 })
    // Sensor weighting and elapsed split pace retain recorded time, including pauses.
    expect(analyze(workout()).splits[0].paceSecPerKm).toBe(300)
    expect(analyze(workout(), { pauseDetection: 'speed' })).toMatchObject({ timerTimeSec: 60, movingTimeSec: 120, movingTimeSource: 'speed' })
  })

  test('timer duration permits sensor-only indoor activity timing', () => {
    const w = workout()
    w.points.forEach(p => { delete p.distanceM })
    expect(analyze(w)).toMatchObject({ distanceSource: 'unavailable', movingTimeSec: 60, movingTimeSource: 'timer' })
  })

  test('timer intersections exclude unrecorded segment gaps', () => {
    const w = { ...activity([point(0, 0), point(100, 10), point(0, 100, { segmentStart: true }), point(100, 110)]), timerEvents: [timer(0, 'start'), timer(110, 'stop')] }
    expect(analyze(w)).toMatchObject({ timerTimeSec: 20, movingTimeSec: 20, elapsedTimeSec: 110 })
  })

  test.each([
    [timer(0, 'start')], [timer(0, 'stop')],
    [timer(0, 'start'), timer(10, 'start'), timer(120, 'stop')],
    [timer(0, 'start'), timer(-1, 'stop')],
    [timer(1, 'start'), timer(120, 'stop')],
    [timer(0, 'start', { group: 1 }), timer(120, 'stop')],
    [timer(0, 'start'), timer(120, 'unsupported')],
    [timer(0, 'start'), { timestamp: new Date(NaN), type: 'stop' }],
  ])('falls back explicitly for incoherent timer events (%j)', (...events) => {
    const stats = analyze({ ...workout(), timerEvents: events })
    expect(stats).toMatchObject({ timerTimeSec: null, movingTimeSec: 120, movingTimeSource: 'speed' })
    expect(stats.quality.timerFallback).toBe('invalid')
    expect(stats.quality.warnings).toContain('invalid-timer-events')
  })

  test.each(['stop', 'stopAll', 'stopDisable', 'stopDisableAll'])('decodes FIT %s', stop => {
    expect(analyze(parse(indoorFit(['start', stop]))).timerTimeSec).toBe(120)
  })

  test('untimed records and dropped timer messages cannot produce authoritative timer duration', () => {
    const w = workout()
    w.points.forEach(p => { delete p.timestamp })
    expect(analyze(w).quality.timerFallback).toBe('untimed')
    expect(analyze({ ...workout(), parseDiagnostics: { droppedTimerEvents: 1 } }).quality.timerFallback).toBe('invalid')
  })
})

describe('custom split lengths', () => {
  const w = activity([point(0, 0), point(3218.688, 1000)])
  test.each([500, 1000, 1609.344, 333.3])('preserves distance and time across %s metre splits', splitDistanceM => {
    const stats = analyze(w, { splitDistanceM })
    expect(stats.splits.reduce((sum, s) => sum + s.distanceM, 0)).toBe(stats.distanceM)
    expect(stats.splits.every(s => s.distanceM > 0 && s.targetDistanceM === splitDistanceM)).toBe(true)
    expect(stats.splits.map(s => s.index)).toEqual(stats.splits.map((_, i) => i + 1))
    expect(stats.splits.every(s => s.paceSecPerKm === 311)).toBe(true)
  })
  test('mile splits use cumulative rounding, full flags and mile labels', () => {
    const stats = analyze(w, { splitDistanceM: 1609.344 })
    expect(stats.splits.map(s => s.distanceM)).toEqual([1609, 1610])
    expect(stats.splits.every(s => !s.isPartial)).toBe(true)
    expect(splitsChartConfig(stats).data.labels).toEqual(['mi 1', 'mi 2'])
    expect(paceChartConfig(w, stats).options.plugins.title.text).toBe('Pace per split')
    expect(formatStats('Miles', stats)).toContain('mi  1')
  })
  test('custom trailing partials are marked and labelled', () => {
    const stats = analyze(activity([point(0, 0), point(1200, 360)]), { splitDistanceM: 500 })
    expect(stats.splits.map(s => s.isPartial)).toEqual([false, false, true])
    expect(splitsChartConfig(stats).data.labels).toEqual(['Split 1', 'Split 2', 'Split 3 (0.20 km)'])
  })
  test('fractional mile boundaries mark a rounded metre shortfall as partial', () => {
    const stats = analyze(activity([point(0, 0), point(3218.3, 1000)]), { splitDistanceM: 1609.344 })
    expect(stats.splits.map(s => s.distanceM)).toEqual([1609, 1609])
    expect(stats.splits.map(s => s.isPartial)).toEqual([false, true])
  })
  test.each([0, -1, 0.5, NaN, Infinity])('rejects invalid split length %s', splitDistanceM => {
    expect(() => analyze(w, { splitDistanceM })).toThrow(/splitDistanceM/)
  })
  test('bounds excessive split allocation and rejects unknown pause policies', () => {
    expect(() => analyze(activity([point(0, 0), point(1e12, 10)]), { splitDistanceM: 1 })).toThrow(/Too many splits/)
    expect(() => analyze(w, { pauseDetection: 'other' })).toThrow(/pauseDetection/)
  })
  test('CLI accepts custom distances and speed pause detection', () => {
    expect(parseArgs(['node', 'stride', 'analyze', 'run.fit', '--split-distance=1609.344', '--speed-pauses'])).toMatchObject({ splitDistanceM: 1609.344, pauseDetection: 'speed' })
  })
})
