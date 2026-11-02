import { analyze, parse } from '../dist/index.js'
import { elevationChartConfig, heartRateChartConfig } from '../dist/charts.js'

const metresPerDegree = 6_371_000 * Math.PI / 180
const time = seconds => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString()
const gpxPoint = (metres, seconds, elevation = 10, hr = 150) => `<trkpt lat="0" lon="${metres / metresPerDegree}"><time>${time(seconds)}</time><ele>${elevation}</ele><extensions><TrackPointExtension><hr>${hr}</hr></TrackPointExtension></extensions></trkpt>`
const gpx = points => `<gpx><trk><trkseg>${points}</trkseg></trk></gpx>`
const invalidGpx = '<trkpt lat="bad" lon="0"/>'
const tcxPoint = (metres, seconds, elevation = 10, hr = 150, distanceM) => `<Trackpoint><Time>${time(seconds)}</Time><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>${metres / metresPerDegree}</LongitudeDegrees></Position><AltitudeMeters>${elevation}</AltitudeMeters><HeartRateBpm><Value>${hr}</Value></HeartRateBpm>${distanceM == null ? '' : `<DistanceMeters>${distanceM}</DistanceMeters>`}</Trackpoint>`
const track = points => `<Track>${points}</Track>`
const tcx = laps => `<TrainingCenterDatabase><Activities><Activity Sport="Running">${laps}</Activity></Activities></TrainingCenterDatabase>`

function expectSeparateSpans(activity, distanceSource) {
  expect(activity.points.map(p => !!p.segmentStart)).toEqual([false, false, true, false])
  const stats = analyze(activity)
  expect(stats).toMatchObject({ distanceSource, distanceM: 1200, elapsedTimeSec: 680, movingTimeSec: 360, elevationGainM: 20, elevationLossM: 0, avgHeartRate: 140, bestKmPaceSecPerKm: null })
  expect(Object.values(stats.hrZones).reduce((sum, sec) => sum + sec, 0)).toBe(360)
  expect(stats.splits.reduce((sum, split) => sum + split.distanceM, 0)).toBe(1200)
  expect(stats.splits.map(split => split.paceSecPerKm)).toEqual([300, 300])
  for (const build of [elevationChartConfig, heartRateChartConfig]) {
    expect(build(activity, stats).data.datasets.map(d => d.data.length)).toEqual([2, 2])
  }
}

describe('TCX Track boundaries', () => {
  test('does not add the jump between separate tracks within a lap', () => {
    const first = track(tcxPoint(0, 0, 100, 200) + tcxPoint(600, 180, 110, 120))
    const second = track(tcxPoint(100_000, 500, 1000, 220) + tcxPoint(100_600, 680, 1010, 160))
    expectSeparateSpans(parse(tcx(`<Lap>${first}${second}</Lap>`)), 'computed')
  })

  test.each([false, true])('device offsets and resets are excluded at boundaries (reset=%s)', reset => {
    const offset = reset ? 0 : 9000
    const first = track(tcxPoint(0, 0, 100, 200, 100) + tcxPoint(600, 180, 110, 120, 700))
    const second = track(tcxPoint(100_000, 500, 1000, 220, offset) + tcxPoint(100_600, 680, 1010, 160, offset + 600))
    expectSeparateSpans(parse(tcx(`<Lap>${first}${second}</Lap>`)), 'device')
  })

  test('tracks in separate laps preserve boundaries and lap totals', () => {
    const xml = tcx(`<Lap><DistanceMeters>600</DistanceMeters>${track(tcxPoint(0, 0) + tcxPoint(600, 180))}</Lap><Lap><DistanceMeters>600</DistanceMeters>${track(tcxPoint(100_000, 500) + tcxPoint(100_600, 680))}</Lap>`)
    const activity = parse(xml)
    expect(activity.points[2].segmentStart).toBe(true)
    expect(activity.deviceDistanceM).toBe(1200)
    expect(analyze(activity).distanceM).toBe(1200)
  })

  test('empty and discarded-only tracks do not erase the next boundary', () => {
    const xml = tcx(`<Lap>${track(tcxPoint(0, 0))}<Track/><Track><Trackpoint/></Track>${track(tcxPoint(100_000, 100) + tcxPoint(100_100, 130))}</Lap>`)
    const activity = parse(xml)
    expect(activity.points.map(p => !!p.segmentStart)).toEqual([false, true, false])
    expect(activity.parseDiagnostics.droppedRecords).toBe(1)
    expect(analyze(activity).distanceM).toBe(100)
  })

  test('GPS-less track starts retain their boundary marker', () => {
    const xml = tcx(`<Lap>${track(tcxPoint(0, 0, 10, 150, 0) + tcxPoint(600, 180, 10, 150, 600))}<Track><Trackpoint><Time>${time(500)}</Time><DistanceMeters>0</DistanceMeters><HeartRateBpm><Value>180</Value></HeartRateBpm></Trackpoint><Trackpoint><Time>${time(680)}</Time><DistanceMeters>600</DistanceMeters><HeartRateBpm><Value>160</Value></HeartRateBpm></Trackpoint></Track></Lap>`)
    const activity = parse(xml)
    expect(activity.points[2]).toMatchObject({ segmentStart: true, distanceM: 0, heartRate: 180 })
    expect(activity.points[2].lat).toBeUndefined()
    expect(analyze(activity)).toMatchObject({ distanceSource: 'device', distanceM: 1200, movingTimeSec: 360 })
  })

  test('a discarded record inside a track also breaks continuity', () => {
    const activity = parse(tcx(`<Lap>${track(tcxPoint(0, 0) + '<Trackpoint/>' + tcxPoint(100_000, 100) + tcxPoint(100_100, 130))}</Lap>`))
    expect(activity.points[1].segmentStart).toBe(true)
    expect(analyze(activity).distanceM).toBe(100)
  })
})

describe('discarded GPX fixes', () => {
  test('breaks distance, duration, elevation and sensor weighting at a rejected fix', () => {
    const activity = parse(gpx(gpxPoint(0, 0, 100, 200) + gpxPoint(600, 180, 110, 120) + invalidGpx + gpxPoint(100_000, 500, 1000, 220) + gpxPoint(100_600, 680, 1010, 160)))
    expectSeparateSpans(activity, 'computed')
    expect(activity.parseDiagnostics.droppedRecords).toBe(1)
    expect(analyze(activity).quality.warnings).toContain('dropped-records')
  })

  test('multiple invalid fixes create one boundary on the next retained point', () => {
    const activity = parse(gpx(invalidGpx + gpxPoint(0, 0) + invalidGpx + invalidGpx + gpxPoint(100_000, 100) + gpxPoint(100_100, 130) + invalidGpx))
    expect(activity.points.map(p => !!p.segmentStart)).toEqual([false, true, false])
    expect(activity.parseDiagnostics.droppedRecords).toBe(4)
    expect(analyze(activity).distanceM).toBe(100)
  })

  test('two isolated fixes cannot establish distance or a best kilometre', () => {
    const stats = analyze(parse(gpx(gpxPoint(0, 0) + invalidGpx + gpxPoint(2000, 600))))
    expect(stats).toMatchObject({ distanceM: 0, movingTimeSec: 0, elapsedTimeSec: 600, bestKmPaceSecPerKm: null, splits: [] })
  })

  test('a later intact span can still provide a genuine best kilometre', () => {
    const stats = analyze(parse(gpx(gpxPoint(0, 0) + gpxPoint(600, 180) + invalidGpx + gpxPoint(100_000, 500) + gpxPoint(101_100, 830))))
    expect(stats).toMatchObject({ distanceM: 1700, movingTimeSec: 510, bestKmPaceSecPerKm: 300 })
  })
})
