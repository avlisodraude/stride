/**
 * ActivityStats.elevationSource — whether elevationGainM/LossM came from the
 * device's own session total (FIT session.total_ascent/total_descent) or from
 * the GPS-altitude hysteresis fallback (docs/metrics-spec.md §5.3 step 1,
 * §5.6). The device total is an activity-level scalar and cannot be attributed
 * to splits, so when elevationSource === 'device' the per-split gains
 * (hysteresis-derived) deliberately do NOT sum to the total.
 *
 * Fixtures:
 *  - climb-run.fit  — carries session totalAscent=78, totalDescent=18
 *                     (reproducible via `npm run sample:climb`)
 *  - sample-run.fit — a real, common case: NO total_ascent field, so it must
 *                     stay on the computed hysteresis path
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'
import { parse, analyze } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

function readGpx(name) {
  return fs.readFileSync(join(here, 'fixtures', name), 'utf-8')
}

function readFitBytes(name) {
  return new Uint8Array(fs.readFileSync(join(here, 'fixtures', name)))
}

function pt(overrides) {
  return { lat: 0, lon: 0, ...overrides }
}

function tsAt(offsetSec) {
  return new Date(offsetSec * 1000)
}

describe('FIT device elevation — climb-run.fit carries session total_ascent/descent', () => {
  test('the parser surfaces the device totals on the Activity', () => {
    const activity = parse(readFitBytes('climb-run.fit'))
    expect(activity.deviceElevationGainM).toBe(78)
    expect(activity.deviceElevationLossM).toBe(18)
  })

  test('analyze() prefers the device totals and reports elevationSource: device', () => {
    const stats = analyze(parse(readFitBytes('climb-run.fit')))
    expect(stats.elevationSource).toBe('device')
    expect(stats.elevationGainM).toBe(78)
    expect(stats.elevationLossM).toBe(18)
  })

  // Explicit, commented assertion so a future reader cannot mistake this for a
  // bug: with elevationSource === 'device', the per-split elevation gains stay
  // hysteresis-derived (the only signal sliceable by distance) while the total
  // is the device's activity-level scalar, so the parts do NOT sum to the
  // whole. See docs/metrics-spec.md §5.6.
  test('sum(splits[].elevationGainM) !== elevationGainM when the device total is used', () => {
    const stats = analyze(parse(readFitBytes('climb-run.fit')))
    const splitSum = stats.splits.reduce((a, s) => a + s.elevationGainM, 0)
    expect(splitSum).not.toBe(stats.elevationGainM)
    // Direction here is up, not down: the barometric device saw 78 m of climb
    // where the denoised GPS altitude only shows 58 m — elevation is not
    // guaranteed to drop when we defer to the device (metrics-spec.md §5.6).
    expect(stats.elevationGainM).toBeGreaterThan(splitSum)
  })
})

describe('FIT without the field, and non-FIT formats, stay computed', () => {
  test('sample-run.fit has no session total_ascent — stays elevationSource: computed', () => {
    const activity = parse(readFitBytes('sample-run.fit'))
    expect(activity.deviceElevationGainM).toBeUndefined()
    expect(activity.deviceElevationLossM).toBeUndefined()
    expect(analyze(activity).elevationSource).toBe('computed')
  })

  const gpxFixtures = [
    'gpx-single-trk-single-seg.gpx',
    'gpx-single-trk-multi-seg.gpx',
    'gpx-multi-trk.gpx',
    'gpx-climb.gpx',
  ]

  test.each(gpxFixtures)('%s: GPX carries no device elevation — always computed', (name) => {
    const activity = parse(readGpx(name))
    expect(activity.deviceElevationGainM).toBeUndefined()
    expect(analyze(activity).elevationSource).toBe('computed')
  })

  test('TCX carries no device elevation total — stays computed', () => {
    const stats = analyze(parse(fs.readFileSync(join(here, 'fixtures', 'sample-run.tcx'), 'utf-8')))
    expect(stats.elevationSource).toBe('computed')
  })
})

describe('zero-guard on device total_ascent (metrics-spec.md §5.6)', () => {
  test('device total_ascent 0 on a clearly-climbing track falls back to computed', () => {
    // Raw altitude climbs 100 -> 120 (hysteresis at the 8 m default confirms
    // 20 m of gain), but the device wrote total_ascent: 0 — a device that
    // never populated the field, not a flat run. Fall back to the hysteresis
    // figure rather than report a false 0.
    const points = [
      pt({ lon: 0, timestamp: tsAt(0), elevation: 100 }),
      pt({ lon: 0.001, timestamp: tsAt(10), elevation: 110 }),
      pt({ lon: 0.002, timestamp: tsAt(20), elevation: 120 }),
    ]
    const stats = analyze({ points, format: 'fit', deviceElevationGainM: 0, deviceElevationLossM: 0 })
    expect(stats.elevationSource).toBe('computed')
    expect(stats.elevationGainM).toBe(20)
  })

  test('device total_ascent 0 with no real climb is honoured as a flat run', () => {
    // No altitude stream at all: 0 is a legitimate flat activity, so the
    // device value is honoured and the source stays 'device'.
    const points = [
      pt({ lon: 0, timestamp: tsAt(0) }),
      pt({ lon: 0.001, timestamp: tsAt(10) }),
      pt({ lon: 0.002, timestamp: tsAt(20) }),
    ]
    const stats = analyze({ points, format: 'fit', deviceElevationGainM: 0, deviceElevationLossM: 0 })
    expect(stats.elevationSource).toBe('device')
    expect(stats.elevationGainM).toBe(0)
    expect(stats.elevationLossM).toBe(0)
  })

  test('a present, nonzero device total is always preferred over hysteresis', () => {
    // Flat GPS altitude (hysteresis would give ~0), but the device reports a
    // real barometric total — the device wins.
    const points = [
      pt({ lon: 0, timestamp: tsAt(0), elevation: 100 }),
      pt({ lon: 0.001, timestamp: tsAt(10), elevation: 101 }),
      pt({ lon: 0.002, timestamp: tsAt(20), elevation: 100 }),
    ]
    const stats = analyze({ points, format: 'fit', deviceElevationGainM: 55, deviceElevationLossM: 40 })
    expect(stats.elevationSource).toBe('device')
    expect(stats.elevationGainM).toBe(55)
    expect(stats.elevationLossM).toBe(40)
  })
})
