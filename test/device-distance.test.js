/**
 * Activity.deviceDistanceM / ActivityStats.deviceDistanceM — the device's own
 * reported total distance (TCX <Lap><DistanceMeters>, FIT
 * session.totalDistance), passed through unrounded and never consumed by any
 * other metric. Distinct from item 2's per-point distanceM stream, which
 * drives distanceM/splits/bestKm; this is a separate, lap/session-level
 * total that is reported as-is alongside it.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'
import { parse, analyze } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

function readFixture(name) {
  return fs.readFileSync(join(here, 'fixtures', name), 'utf-8')
}

// A minimal TCX activity with one or more laps. `laps` is an array of
// { distanceM, points: [{lon}, ...] }; lap-level <DistanceMeters> is omitted
// entirely when `distanceM` is null, and each point gets a trackpoint with
// lat 0 (equator) and 1s spacing so timestamps stay valid and monotonic.
function tcxWithLaps(laps) {
  const start = '2026-06-01T07:00:00.000Z'
  let secOffset = 0
  const lapXml = laps.map(lap => {
    const trackpoints = lap.points.map(p => {
      const t = new Date(Date.parse(start) + secOffset * 1000).toISOString()
      secOffset++
      return `<Trackpoint><Time>${t}</Time><Position>` +
        `<LatitudeDegrees>0.0000000</LatitudeDegrees>` +
        `<LongitudeDegrees>${p.lon.toFixed(7)}</LongitudeDegrees>` +
        `</Position></Trackpoint>`
    }).join('')
    const distEl = lap.distanceM == null ? '' : `<DistanceMeters>${lap.distanceM}</DistanceMeters>`
    return `<Lap StartTime="${start}">${distEl}<Track>${trackpoints}</Track></Lap>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>${start}</Id>${lapXml}</Activity></Activities>
</TrainingCenterDatabase>`
}

describe('sample fixtures — deviceDistanceM alongside distanceM', () => {
  test('sample-run.tcx: deviceDistanceM 1983.3, distanceM 1980, distanceSource device', () => {
    const stats = analyze(parse(readFixture('sample-run.tcx')))
    expect(stats.deviceDistanceM).toBe(1983.3)
    expect(stats.distanceM).toBe(1980)
    expect(stats.distanceSource).toBe('device')
  })

  test('sample-run.fit: deviceDistanceM 1983.3, distanceM 1980, distanceSource device', () => {
    const fixturePath = join(here, 'fixtures', 'sample-run.fit')
    const stats = analyze(parse(new Uint8Array(fs.readFileSync(fixturePath))))
    expect(stats.deviceDistanceM).toBe(1983.3)
    expect(stats.distanceM).toBe(1980)
    expect(stats.distanceSource).toBe('device')
  })
})

describe('GPX has no activity-level distance total', () => {
  const gpxFixtures = [
    'gpx-single-trk-single-seg.gpx',
    'gpx-single-trk-multi-seg.gpx',
    'gpx-multi-trk.gpx',
    'gpx-multi-trk-second-name.gpx',
  ]

  test.each(gpxFixtures)('%s: Activity.deviceDistanceM and stats.deviceDistanceM are undefined', (name) => {
    const activity = parse(readFixture(name))
    expect(activity.deviceDistanceM).toBeUndefined()
    expect(analyze(activity).deviceDistanceM).toBeUndefined()
  })
})

describe('TCX multi-lap: device total sums across laps', () => {
  test('two laps with distinct DistanceMeters totals sum to the activity total', () => {
    // Points barely move (the point-stream/haversine distance is ~0), so the
    // guard (device total >= point-stream distance) is trivially satisfied
    // and this test isolates the thing it's checking: summation across laps.
    const activity = parse(tcxWithLaps([
      { distanceM: 1000, points: [{ lon: 0 }, { lon: 0.0000001 }] },
      { distanceM: 983.3, points: [{ lon: 0.0000002 }, { lon: 0.0000003 }] },
    ]))
    expect(activity.deviceDistanceM).toBe(1983.3)

    const stats = analyze(activity)
    expect(stats.deviceDistanceM).toBe(1983.3)
  })
})

describe('guard: an implausible device total is treated as absent', () => {
  test('a lap total of 0 yields undefined, not 0', () => {
    const activity = parse(tcxWithLaps([
      { distanceM: 0, points: [{ lon: 0 }, { lon: 0.009 }, { lon: 0.018 }] },
    ]))
    // The raw parse still carries the literal 0 the file reported...
    expect(activity.deviceDistanceM).toBe(0)
    // ...but analyze() rejects it: 0 cannot be a real activity total, so it
    // must not be reported as if it were one.
    const stats = analyze(activity)
    expect(stats.deviceDistanceM).toBeUndefined()
    expect(stats.deviceDistanceM).not.toBe(0)
  })

  test('a device total smaller than the point-stream distance yields undefined', () => {
    // Lap claims 10m but the recorded points span ~2000m — the device total
    // can't be trusted, so it falls back to absent rather than a bogus 10.
    const activity = parse(tcxWithLaps([
      { distanceM: 10, points: [{ lon: 0 }, { lon: 0.0179864 }] },
    ]))
    const stats = analyze(activity)
    expect(stats.distanceM).toBeGreaterThan(1900)
    expect(stats.deviceDistanceM).toBeUndefined()
  })
})
