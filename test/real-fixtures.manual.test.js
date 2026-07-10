/**
 * Invariant checks over real watch exports in test/fixtures/real/.
 *
 * The synthetic fixtures are clean by construction — perfectly monotonic
 * device streams, tidy timestamps, every field present. Real exports are
 * messier (dropped fixes, pauses, absent fields, vendor extension quirks),
 * and that mess is exactly what the "is the device stream usable?" guards
 * exist to handle. This suite makes no assumptions about any file's
 * *content*; it asserts only the invariants that must hold for ANY valid
 * activity, so any .fit/.gpx/.tcx dropped into test/fixtures/real/ is
 * picked up automatically. See test/fixtures/real/README.md for how to add
 * files. The suite skips itself when the directory is empty.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import fs from 'node:fs'
import { parse, analyze } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const realDir = join(here, 'fixtures', 'real')

const files = fs.existsSync(realDir)
  ? fs.readdirSync(realDir).filter(f => ['.fit', '.gpx', '.tcx'].includes(extname(f).toLowerCase()))
  : []

// This suite never silently opts out. It is excluded from the default `jest`
// run and reached only via `npm run test:real`, which is a deliberate act. A
// harness that passes with zero assertions because its fixtures are absent is
// worse than no harness: it reports success for a code path that never ran. If
// you invoked this suite, you meant to exercise real files; if there are none,
// that is a failure.
if (files.length === 0) {
  throw new Error(
    `No real activity files found in ${realDir}.\n` +
    'This suite is opt-in and asserts nothing without fixtures. Drop a real\n' +
    '.fit/.gpx/.tcx export into test/fixtures/real/ (see its README — the\n' +
    'directory is gitignored because exports carry home coordinates), or do\n' +
    'not run `npm run test:real`.'
  )
}

describe('real-device exports — universal invariants', () => {
  test.each(files)('%s parses and analyzes cleanly', (file) => {
    const activity = parse(join(realDir, file))

    // --- parse-level invariants -----------------------------------------
    expect(['gpx', 'tcx', 'fit']).toContain(activity.format)
    expect(Array.isArray(activity.points)).toBe(true)
    for (const p of activity.points) {
      expect(Number.isFinite(p.lat)).toBe(true)
      expect(Number.isFinite(p.lon)).toBe(true)
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180)
      // Optional fields are either absent or finite — never NaN, never an
      // Invalid Date (the parser must drop malformed values at the boundary).
      if (p.elevation != null) expect(Number.isFinite(p.elevation)).toBe(true)
      if (p.heartRate != null) expect(Number.isFinite(p.heartRate)).toBe(true)
      if (p.cadence != null) expect(Number.isFinite(p.cadence)).toBe(true)
      if (p.distanceM != null) expect(Number.isFinite(p.distanceM)).toBe(true)
      if (p.timestamp != null) expect(Number.isNaN(p.timestamp.getTime())).toBe(false)
    }

    // --- analyze-level invariants ----------------------------------------
    const stats = analyze(activity)

    // Every numeric stat is finite — NaN anywhere means corrupt input leaked
    // through a guard.
    for (const key of ['distanceM', 'elapsedTimeSec', 'movingTimeSec', 'avgPaceSecPerKm', 'elevationGainM', 'elevationLossM']) {
      expect(Number.isFinite(stats[key])).toBe(true)
      expect(stats[key]).toBeGreaterThanOrEqual(0)
    }
    for (const key of ['bestKmPaceSecPerKm', 'avgHeartRate', 'maxHeartRate', 'avgCadence', 'deviceDistanceM']) {
      if (stats[key] != null) expect(Number.isFinite(stats[key])).toBe(true)
    }

    expect(['device', 'computed']).toContain(stats.distanceSource)
    expect(['device', 'computed']).toContain(stats.elevationSource)

    // Documented guarantees (types.ts):
    // deviceDistanceM, when present, is never smaller than distanceM.
    if (stats.deviceDistanceM != null) {
      expect(stats.deviceDistanceM).toBeGreaterThanOrEqual(stats.distanceM)
    }
    // Moving time never exceeds elapsed time (when the file has timestamps).
    expect(stats.movingTimeSec).toBeLessThanOrEqual(stats.elapsedTimeSec + 1)
    // sum(splits[].distanceM) === distanceM, exactly.
    const splitSum = stats.splits.reduce((a, s) => a + s.distanceM, 0)
    expect(splitSum).toBe(stats.distanceM)
    // Every full split is exactly 1000m; only the last may be partial.
    stats.splits.slice(0, -1).forEach(s => expect(s.distanceM).toBe(1000))
    // HR zone seconds are finite and non-negative.
    if (stats.hrZones) {
      for (const z of Object.values(stats.hrZones)) {
        expect(Number.isFinite(z)).toBe(true)
        expect(z).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
