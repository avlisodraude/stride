/**
 * Tests run as native ESM (Node's --experimental-vm-modules) against the built
 * output in dist/, so no Babel/ts-jest transform is required. Run `npm run
 * build` before running these tests directly.
 *
 * Fixtures below are taken verbatim from docs/metrics-spec.md — they are
 * normative and must not be adjusted to match implementation output.
 */
import { analyze } from '../dist/index.js'

function pt(overrides) {
  return { lat: 0, lon: 0, ...overrides }
}

function tsAt(offsetSec) {
  return new Date(offsetSec * 1000)
}

describe('§1 HR zones — time-weighted', () => {
  test('§1.6 worked example — smart-recording bias corrected', () => {
    const points = [
      pt({ lat: 52, lon: 4, timestamp: tsAt(0), heartRate: 140 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(8), heartRate: 145 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(9), heartRate: 185 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(10), heartRate: 186 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(11), heartRate: 184 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(19), heartRate: 142 }),
    ]
    const stats = analyze({ points, format: 'gpx' }, 190)
    expect(stats.hrZones).toEqual({ z1: 0, z2: 0, z3: 16, z4: 0, z5: 3 })
    const total = stats.hrZones.z1 + stats.hrZones.z2 + stats.hrZones.z3 + stats.hrZones.z4 + stats.hrZones.z5
    expect(total).toBe(19)
  })

  test('§1.5 edge case — missing/non-monotonic timestamp segment is skipped, not clamped to 1s', () => {
    const points = [
      pt({ timestamp: tsAt(0), heartRate: 140 }),
      pt({ timestamp: undefined, heartRate: 185 }), // segment into this point has no timestamp -> skip
      pt({ timestamp: tsAt(5), heartRate: 185 }),
    ]
    const stats = analyze({ points, format: 'gpx' }, 190)
    // segment0->1 skipped (missing timestamp); segment1->2 also has prev.timestamp undefined -> skipped
    expect(stats.hrZones).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 })
  })

  test('§1.5 edge case — no timestamps anywhere falls back to 1s per segment', () => {
    const points = [
      pt({ heartRate: 140 }),
      pt({ heartRate: 185 }),
      pt({ heartRate: 185 }),
    ]
    const stats = analyze({ points, format: 'gpx' }, 190)
    // 2 segments, 1s each, both ending samples at 185 -> z5 += 1 + 1
    expect(stats.hrZones).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 2 })
  })
})
