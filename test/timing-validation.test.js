import { analyze, parse } from '../dist/index.js'

const point = (distanceM, seconds, extra = {}) => ({
  lat: 0, lon: distanceM / 111195, distanceM,
  ...(seconds == null ? {} : { timestamp: new Date(seconds * 1000) }), ...extra,
})
const activity = points => ({ format: 'fit', points })

describe('timing recovery', () => {
  test('interpolates interior gaps by distance without mutating the activity', () => {
    const input = activity([point(0, 0), point(500), point(2000, 600)])
    const stats = analyze(input)
    expect(stats.elapsedTimeSec).toBe(600)
    expect(stats.movingTimeSec).toBe(600)
    expect(stats.avgPaceSecPerKm).toBe(300)
    expect(stats.bestKmPaceSecPerKm).toBe(300)
    expect(stats.splits.map(s => s.paceSecPerKm)).toEqual([300, 300])
    expect(input.points[1].timestamp).toBeUndefined()
  })

  test('stationary timestamp gaps do not invent movement', () => {
    const stats = analyze(activity([point(0, 0), point(0), point(0, 120), point(1000, 420)]))
    expect(stats.elapsedTimeSec).toBe(420)
    expect(stats.movingTimeSec).toBe(300)
    expect(stats.bestKmPaceSecPerKm).toBe(300)
  })

  test.each([
    [point(0), point(1000, 300)],
    [point(0, 0), point(1000)],
  ])('rejects uncovered timing endpoints', (...points) => {
    expect(() => analyze(activity(points))).toThrow(/Incomplete timing/)
  })

  test.each([
    [point(0, 100), point(1000, 90)],
    [point(0, 0), point(500), point(1000, 0)],
    [point(0, 0), point(500, 100), point(1000, 90)],
  ])('rejects backward clocks and instantaneous movement', (...points) => {
    expect(() => analyze(activity(points))).toThrow(/Invalid timing/)
  })

  test('accepts repeated timestamps at stationary points', () => {
    expect(analyze(activity([point(0, 0), point(0, 0), point(1000, 300)])).avgPaceSecPerKm).toBe(300)
  })

  test('keeps the documented no-timestamp fallback', () => {
    const stats = analyze(activity([point(0), point(10), point(20)]))
    expect(stats.elapsedTimeSec).toBe(2)
    expect(stats.movingTimeSec).toBe(2)
  })
})

describe('best kilometre pause boundaries', () => {
  test.each([
    [point(0, 0), point(0, 600), point(1000, 900)],
    [point(0, 0), point(1000, 300), point(1000, 900)],
    [point(0, 0), point(0, 600), point(1000, 900), point(1000, 1500)],
    [point(0, 0), point(500, 300), point(500, 900), point(1500, 1200)],
  ])('excludes stationary time outside the effort', (...points) => {
    expect(analyze(activity(points)).bestKmPaceSecPerKm).toBe(300)
  })

  test('retains a pause inside the effort and elapsed time in splits', () => {
    const stats = analyze(activity([point(0, 0), point(500, 150), point(500, 750), point(1000, 900)]))
    expect(stats.bestKmPaceSecPerKm).toBe(900)
    expect(stats.splits[0].paceSecPerKm).toBe(900)
    expect(stats.avgPaceSecPerKm).toBe(300)
  })
})

describe('runtime validation for JavaScript callers', () => {
  const input = activity([point(0, 0), point(1000, 300)])

  test.each(['pauseThresholdMps', 'elevationThresholdM'])('%s must be finite and nonnegative', field => {
    for (const value of [NaN, Infinity, -1, '2']) {
      expect(() => analyze(input, { [field]: value })).toThrow(new RegExp(`Invalid ${field}`))
    }
    expect(() => analyze(input, { [field]: 0 })).not.toThrow()
  })

  test.each([[], [0.6], [0.6, 0.7, 0.8], [0.5, 0.6, 0.7, 0.8, 0.9], 'abcd'].map(value => [value]))('requires four zone boundaries (%j)', boundaries => {
    expect(() => analyze(input, { zoneModel: { type: 'hrmax', boundaries } })).toThrow(/exactly four/)
  })

  test('rejects an unknown zone model', () => {
    expect(() => analyze(input, { zoneModel: { type: 'unknown' } })).toThrow(/Invalid zoneModel/)
  })

  test.each([['0.6', 0.7, 0.8, 0.9], [0.6, 0.7, NaN, 0.9], [0.6, 0.7, 0.8, Infinity]])('requires numeric finite boundaries (%j)', (...boundaries) => {
    expect(() => analyze(input, { zoneModel: { type: 'hrmax', boundaries } })).toThrow(/Invalid HR zone boundaries/)
  })

  test('does not surface non-finite device totals', () => {
    const stats = analyze({ ...input, deviceDistanceM: Infinity, deviceElevationGainM: NaN, deviceElevationLossM: Infinity })
    expect(stats.deviceDistanceM).toBeUndefined()
    expect(stats.elevationSource).toBe('computed')
    expect(stats.elevationGainM).toBe(0)
    expect(stats.elevationLossM).toBe(0)
  })

  test.each([{ lat: Infinity }, { lat: 91 }, { lon: -181 }, { timestamp: new Date(NaN) }, { heartRate: NaN }])('rejects invalid manually constructed points (%j)', extra => {
    expect(() => analyze(activity([point(0, 0, extra), point(1000, 300)]))).toThrow(/Invalid/)
  })

  test.each(['Infinity', 'NaN', '91', '52junk', ''])('drops invalid GPX coordinates (%s)', lat => {
    const result = parse(`<gpx><trk><trkseg><trkpt lat="${lat}" lon="4"/><trkpt lat="52" lon="4"/></trkseg></trk></gpx>`)
    expect(result.points).toEqual([{ lat: 52, lon: 4 }])
  })

  test('drops invalid TCX positions and non-finite distances', () => {
    const result = parse('<TrainingCenterDatabase><Activities><Activity><Lap><DistanceMeters>Infinity</DistanceMeters><Track>'
      + '<Trackpoint><Position><LatitudeDegrees/><LongitudeDegrees>4</LongitudeDegrees></Position></Trackpoint>'
      + '<Trackpoint><Position><LatitudeDegrees>52</LatitudeDegrees><LongitudeDegrees>4</LongitudeDegrees></Position><DistanceMeters>Infinity</DistanceMeters></Trackpoint>'
      + '</Track></Lap></Activity></Activities></TrainingCenterDatabase>')
    expect(result.points).toEqual([{ lat: 52, lon: 4 }])
    expect(result.deviceDistanceM).toBeUndefined()
  })
})
