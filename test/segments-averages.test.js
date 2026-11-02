import { analyze, parse } from '../dist/index.js'
import { elevationChartConfig, heartRateChartConfig } from '../dist/charts.js'

const point = (distanceM, seconds, extra = {}) => ({
  lat: 0, lon: distanceM / 111195, distanceM,
  ...(seconds == null ? {} : { timestamp: new Date(seconds * 1000) }), ...extra,
})
const activity = points => ({ format: 'gpx', points })

function segmentedGpx(times = true) {
  const pt = (lon, seconds, elevation, hr) => `<trkpt lat="0" lon="${lon}">`
    + (times ? `<time>${new Date(seconds * 1000).toISOString()}</time>` : '')
    + `<ele>${elevation}</ele><extensions><TrackPointExtension><hr>${hr}</hr><cad>80</cad></TrackPointExtension></extensions></trkpt>`
  return '<gpx><trk><trkseg>' + pt(0, 0, 100, 200) + pt(0.001, 10, 110, 120)
    + '</trkseg><trkseg>' + pt(1, 100, 1000, 220) + pt(1.001, 110, 1010, 160)
    + '</trkseg></trk></gpx>'
}

describe('continuous GPX spans', () => {
  test('manually constructed boundary markers must be boolean', () => {
    expect(() => analyze(activity([point(0, 0), point(100, 30, { segmentStart: 'false' })])))
      .toThrow(/Invalid segmentStart/)
  })
  test('preserves boundaries and excludes jumps from distance, movement, elevation and sensors', () => {
    const input = parse(segmentedGpx())
    expect(input.points.map(p => !!p.segmentStart)).toEqual([false, false, true, false])
    const stats = analyze(input)
    expect(stats.distanceM).toBe(222)
    expect(stats.elapsedTimeSec).toBe(110)
    expect(stats.movingTimeSec).toBe(20)
    expect(stats.elevationGainM).toBe(20)
    expect(stats.elevationLossM).toBe(0)
    expect(stats.avgHeartRate).toBe(140)
    expect(stats.avgCadence).toBe(160)
    expect(Object.values(stats.hrZones).reduce((a, b) => a + b, 0)).toBe(20)
    expect(stats.splits[0].avgHeartRate).toBe(140)
    expect(stats.splits[0].paceSecPerKm).toBe(90)
    expect(stats.splits[0].elevationGainM).toBe(20)
  })

  test('timestamp-free spans assume one second only for recorded intervals', () => {
    const stats = analyze(parse(segmentedGpx(false)))
    expect(stats.elapsedTimeSec).toBe(2)
    expect(stats.movingTimeSec).toBe(2)
    expect(Object.values(stats.hrZones).reduce((a, b) => a + b, 0)).toBe(2)
  })

  test('does not invent a best kilometre across two shorter spans', () => {
    const stats = analyze(activity([
      point(0, 0), point(600, 180), point(5000, 500, { segmentStart: true }), point(5600, 680),
    ]))
    expect(stats.distanceM).toBe(1200)
    expect(stats.bestKmPaceSecPerKm).toBeNull()
  })

  test('best effort can come from a later span with a device-distance reset', () => {
    const stats = analyze(activity([
      point(0, 0), point(1100, 440), point(0, 1000, { segmentStart: true }), point(1100, 1330),
    ]))
    expect(stats.distanceSource).toBe('device')
    expect(stats.distanceM).toBe(2200)
    expect(stats.movingTimeSec).toBe(770)
    expect(stats.elapsedTimeSec).toBe(1330)
    expect(stats.bestKmPaceSecPerKm).toBe(300)
  })

  test('does not interpolate timestamps across a span boundary', () => {
    expect(() => analyze(activity([
      point(0, 0), point(100), point(100, 100, { segmentStart: true }), point(200, 200),
    ]))).toThrow(/Incomplete timing.*each continuous span/)
  })

  test('empty and invalid-only segments do not erase the next real boundary', () => {
    const xml = '<gpx><trk><trkseg><trkpt lat="0" lon="0"/></trkseg><trkseg/>'
      + '<trkseg><trkpt lat="bad" lon="0"/></trkseg></trk>'
      + '<trk><trkseg><trkpt lat="0" lon="1"/><trkpt lat="0" lon="1.001"/></trkseg></trk></gpx>'
    const input = parse(xml)
    expect(input.points).toHaveLength(3)
    expect(input.points[1].segmentStart).toBe(true)
    expect(analyze(input).distanceM).toBe(111)
  })

  test.each([elevationChartConfig, heartRateChartConfig])('profiles do not draw lines across gaps', build => {
    const input = parse(segmentedGpx())
    const datasets = build(input, analyze(input)).data.datasets
    expect(datasets).toHaveLength(2)
    expect(datasets.every(dataset => dataset.spanGaps === false)).toBe(true)
    expect(datasets[0].data[1].x).toBeCloseTo(datasets[1].data[0].x, 8)
    expect(datasets[1].data.at(-1).x).toBeCloseTo(0.22239, 5)
  })

  test('chart gap survives missing sensor values at the segment start', () => {
    const input = activity([
      point(0, 0, { elevation: 10 }), point(100, 10, { elevation: 20 }),
      point(5000, 100, { segmentStart: true }), point(5100, 110, { elevation: 100 }),
    ])
    const datasets = elevationChartConfig(input, analyze(input)).data.datasets
    expect(datasets.map(dataset => dataset.data)).toEqual([[{ x: 0, y: 10 }, { x: 0.1, y: 20 }], [{ x: 0.2, y: 100 }]])
  })

  test('chart downsampling preserves breaks even when boundary points are not sampled', () => {
    const input = activity(Array.from({ length: 1000 }, (_, i) => point(i * 10, i, {
      elevation: i, ...(i === 502 ? { segmentStart: true } : {}),
    })))
    const datasets = elevationChartConfig(input, analyze(input)).data.datasets
    const data = datasets.flatMap(dataset => dataset.data)
    expect(data).toHaveLength(200)
    expect(datasets).toHaveLength(2)
    expect(data[0].y).toBe(0)
    expect(data.at(-1).y).toBe(999)
  })
})

describe('duration-weighted sensor summaries', () => {
  test('uneven recording does not over-weight short hard efforts', () => {
    const times = [0, 8, 9, 10, 11, 19]
    const hr = [140, 145, 185, 186, 184, 142]
    const cadence = [100, 160, 200, 200, 200, 160]
    const stats = analyze(activity(times.map((t, i) => point(t * 50, t, { heartRate: hr[i], cadence: cadence[i] }))))
    expect(stats.avgHeartRate).toBe(150)
    expect(stats.avgCadence).toBe(166)
    expect(stats.splits[0].avgHeartRate).toBe(150)
  })

  test('distributes a long sample duration across the true km boundary', () => {
    const stats = analyze(activity([
      point(0, 0, { heartRate: 200 }), point(500, 100, { heartRate: 100 }),
      point(1500, 300, { heartRate: 200 }),
    ]))
    expect(stats.avgHeartRate).toBe(167)
    expect(stats.splits.map(s => s.avgHeartRate)).toEqual([150, 200])
  })

  test('stationary time is weighted and belongs to the correct split', () => {
    const stats = analyze(activity([
      point(0, 0, { heartRate: 200 }), point(1000, 300, { heartRate: 100 }),
      point(1000, 900, { heartRate: 180 }), point(2000, 1200, { heartRate: 120 }),
    ]))
    expect(stats.avgHeartRate).toBe(145)
    expect(stats.splits.map(s => s.avgHeartRate)).toEqual([100, 160])
  })

  test('missing sensors do not enter the denominator', () => {
    const stats = analyze(activity([
      point(0, 0, { heartRate: 200, cadence: 200 }), point(100, 10),
      point(200, 20, { heartRate: 120, cadence: 160 }),
    ]))
    expect(stats.avgHeartRate).toBe(120)
    expect(stats.avgCadence).toBe(160)
    expect(stats.splits[0].avgHeartRate).toBe(120)
  })

  test('does not assign duration to isolated or untimed samples', () => {
    const stats = analyze(activity([
      point(0, 0, { heartRate: 200 }), point(500), point(1000, 300, { heartRate: 140 }),
    ]))
    expect(stats.avgHeartRate).toBeNull()
    expect(stats.splits[0].avgHeartRate).toBeUndefined()
    expect(stats.maxHeartRate).toBe(200)
  })

  test('no-timestamp fallback averages the ending samples of recorded intervals', () => {
    const stats = analyze(activity([
      point(0, undefined, { heartRate: 220, cadence: 220 }),
      point(10, undefined, { heartRate: 120, cadence: 160 }),
      point(20, undefined, { heartRate: 160, cadence: 180 }),
    ]))
    expect(stats.avgHeartRate).toBe(140)
    expect(stats.avgCadence).toBe(170)
    expect(stats.splits[0].avgHeartRate).toBe(140)
  })
})

describe('rounded split distances', () => {
  test.each([0.2, 0.49, 0.5, 999.49, 999.6, 1000, 1000.2, 1000.49, 1000.5, 1999.6, 2000.2])('%f m emits only positive splits whose distances sum to the rounded total', total => {
    const stats = analyze(activity([point(0, 0), point(total, total * 0.3)]))
    expect(stats.splits.every(s => s.distanceM > 0)).toBe(true)
    expect(stats.splits.reduce((sum, s) => sum + s.distanceM, 0)).toBe(stats.distanceM)
    for (const split of stats.splits) expect(split.paceSecPerKm).toBe(300)
  })

  test('folds tail duration, HR and elevation into the final represented split', () => {
    const stats = analyze(activity([
      point(0, 0, { heartRate: 200, elevation: 0 }), point(1000, 300, { heartRate: 100, elevation: 10 }),
      point(1000.2, 600, { heartRate: 200, elevation: 30 }),
    ]))
    expect(stats.splits).toEqual([{ km: 1, index: 1, targetDistanceM: 1000, isPartial: false, distanceM: 1000, paceSecPerKm: 600, elevationGainM: 30, avgHeartRate: 150 }])
    expect(stats.avgHeartRate).toBe(150)
  })
})
