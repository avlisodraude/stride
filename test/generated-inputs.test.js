import { analyze, parse } from '../dist/index.js'

// A fixed seed makes every failure reproducible; no new test dependency.
function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function generated(seed) {
  const next = random(seed)
  let time = 0
  let distance = 0
  let expectedDistance = 0
  let recordedSeconds = 0
  const points = []
  const count = 20 + Math.floor(next() * 80)
  for (let i = 0; i < count; i++) {
    const segmentStart = i > 0 && next() < 0.07
    const deltaT = 1 + Math.floor(next() * 20)
    const deltaD = next() < 0.2 ? 0 : next() * 150
    time += deltaT
    if (segmentStart) distance = next() * 50 // reset/offset at a span boundary
    else if (i > 0) { distance += deltaD; expectedDistance += deltaD; recordedSeconds += deltaT }
    points.push({ distanceM: distance, timestamp: new Date(1_700_000_000_000 + time * 1000), heartRate: 100 + Math.floor(next() * 80), cadence: Math.floor(next() * 200), elevation: next() * 100, ...(segmentStart ? { segmentStart: true } : {}) })
  }
  return { activity: { format: 'fit', points }, expectedDistance, recordedSeconds }
}

describe('deterministic generated activities', () => {
  test.each(Array.from({ length: 100 }, (_, i) => i + 1))('seed %i preserves metric invariants across split lengths and resets', seed => {
    const { activity, expectedDistance, recordedSeconds } = generated(seed)
    const stats = analyze(activity, { splitDistanceM: [1, 7.5, 500, 1000, 1609.344][seed % 5] })
    expect(stats.distanceM).toBe(Math.round(expectedDistance))
    expect(stats.splits.reduce((sum, s) => sum + s.distanceM, 0)).toBe(stats.distanceM)
    expect(stats.splits.every(s => s.distanceM > 0 && Number.isFinite(s.paceSecPerKm) && s.paceSecPerKm >= 0)).toBe(true)
    expect(stats.splits.slice(0, -1).every(s => !s.isPartial)).toBe(true)
    expect(stats.movingTimeSec).toBeLessThanOrEqual(recordedSeconds)
    expect(stats.elapsedTimeSec).toBeGreaterThanOrEqual(stats.movingTimeSec)
    expect(Object.values(stats.hrZones).reduce((sum, sec) => sum + sec, 0)).toBe(recordedSeconds)
    expect(stats.avgHeartRate).toBeGreaterThanOrEqual(100)
    expect(stats.avgHeartRate).toBeLessThanOrEqual(179)
    expect(stats.quality).toMatchObject({ timingSource: 'recorded', deviceDistanceFallback: null, unknownDistanceIntervals: 0 })
    expect(analyze(activity, { splitDistanceM: stats.splitDistanceM })).toEqual(stats)
  })

  test.each([0.01, 0.49, 0.5, 0.51, 999.49, 999.5, 1000.49, 1000.5, 1609.344, 3218.688])('fractional total %s keeps nonzero integer split distances', total => {
    for (const splitDistanceM of [1, 1.1, 500, 1000, 1609.344]) {
      const stats = analyze({ format: 'fit', points: [{ distanceM: 0 }, { distanceM: total }] }, { splitDistanceM })
      expect(stats.splits.reduce((sum, s) => sum + s.distanceM, 0)).toBe(Math.round(total))
      expect(stats.splits.every(s => s.distanceM > 0 && Number.isFinite(s.paceSecPerKm))).toBe(true)
    }
  })

  test('generated XML encodings match equivalent parsed activities across namespace aliases', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const next = random(seed)
      const prefix = `p${seed}`
      const points = Array.from({ length: 20 }, (_, i) => ({ lat: 0, lon: i * 0.0001, heartRate: 100 + Math.floor(next() * 80) }))
      const xml = `<${prefix}:gpx xmlns:${prefix}="http://www.topografix.com/GPX/1/1" xmlns:h="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><${prefix}:trk><${prefix}:trkseg>` + points.map(p => `<${prefix}:trkpt lat="${p.lat}" lon="${p.lon}"><${prefix}:extensions><h:TrackPointExtension><h:hr>${p.heartRate}</h:hr></h:TrackPointExtension></${prefix}:extensions></${prefix}:trkpt>`).join('') + `</${prefix}:trkseg></${prefix}:trk></${prefix}:gpx>`
      expect(analyze(parse(xml))).toEqual(analyze({ format: 'gpx', points, parseDiagnostics: { totalRecords: points.length, droppedRecords: 0, invalidPositions: 0, droppedReadings: 0, droppedTimerEvents: 0 } }))
    }
  })
})
