import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'
import { parse } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

function readFixture(name) {
  return fs.readFileSync(join(here, 'fixtures', name), 'utf-8')
}

describe('GPX parsing', () => {
  test('single <trk>, single <trkseg> — baseline', () => {
    const activity = parse(readFixture('gpx-single-trk-single-seg.gpx'))
    expect(activity.format).toBe('gpx')
    expect(activity.name).toBe('Morning Run')
    expect(activity.type).toBe('running')
    expect(activity.points.length).toBe(3)
    expect(activity.points[0].lat).toBeCloseTo(52.37, 4)
    expect(activity.points[0].lon).toBeCloseTo(4.9, 4)
    expect(activity.points[2].lat).toBeCloseTo(52.3702, 4)
    expect(activity.points[2].lon).toBeCloseTo(4.9002, 4)
  })

  test('single <trk>, multiple <trkseg> — points from both segments, in order', () => {
    const activity = parse(readFixture('gpx-single-trk-multi-seg.gpx'))
    expect(activity.points.length).toBe(5)
    // First two points from segment 1, remaining three from segment 2, in order.
    expect(activity.points[0].lat).toBeCloseTo(52.1, 4)
    expect(activity.points[1].lat).toBeCloseTo(52.1001, 4)
    expect(activity.points[2].lat).toBeCloseTo(52.2, 4)
    expect(activity.points[3].lat).toBeCloseTo(52.2001, 4)
    expect(activity.points[4].lat).toBeCloseTo(52.2002, 4)
  })

  test('multiple <trk>, one <trkseg> each — regression: points must not be dropped', () => {
    const activity = parse(readFixture('gpx-multi-trk.gpx'))
    expect(activity.points.length).toBe(5)

    const first = activity.points[0]
    expect(first.lat).toBeCloseTo(10.0, 4)
    expect(first.lon).toBeCloseTo(20.0, 4)

    const last = activity.points[activity.points.length - 1]
    expect(last.lat).toBeCloseTo(30.001, 4)
    expect(last.lon).toBeCloseTo(40.001, 4)
  })

  test('multiple <trk>, only the second carries a <name> — name resolves from first track only', () => {
    const activity = parse(readFixture('gpx-multi-trk-second-name.gpx'))
    // No gpx.metadata.name, and the first track has no <name>, so the name
    // must NOT fall back to a later track's name — it stays undefined.
    expect(activity.name).toBeUndefined()
    expect(activity.type).toBe('cycling')
    expect(activity.points.length).toBe(3)
  })

  test('malformed lat is skipped, not thrown on', () => {
    const activity = parse(readFixture('gpx-malformed-lat.gpx'))
    expect(activity.points.length).toBe(2)
    expect(activity.points[0].lat).toBeCloseTo(52.5, 4)
    expect(activity.points[1].lat).toBeCloseTo(52.5002, 4)
  })
})
