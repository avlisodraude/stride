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
    const stats = analyze({ points, format: 'gpx' }, { maxHR: 190 })
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
    const stats = analyze({ points, format: 'gpx' }, { maxHR: 190 })
    // segment0->1 skipped (missing timestamp); segment1->2 also has prev.timestamp undefined -> skipped
    expect(stats.hrZones).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 })
  })

  test('§1.5 edge case — no timestamps anywhere falls back to 1s per segment', () => {
    const points = [
      pt({ heartRate: 140 }),
      pt({ heartRate: 185 }),
      pt({ heartRate: 185 }),
    ]
    const stats = analyze({ points, format: 'gpx' }, { maxHR: 190 })
    // 2 segments, 1s each, both ending samples at 185 -> z5 += 1 + 1
    expect(stats.hrZones).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 2 })
  })
})

describe('configurable HR zone model (zoneModel) and pause threshold (pauseThresholdMps)', () => {
  test('defaults reproduce the implicit hrmax/60-70-80-90/0.3 behaviour exactly', () => {
    const points = [
      pt({ lat: 52, lon: 4, timestamp: tsAt(0), heartRate: 140 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(8), heartRate: 145 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(9), heartRate: 185 }),
    ]
    const implicit = analyze({ points, format: 'gpx' }, { maxHR: 190 })
    const explicit = analyze({ points, format: 'gpx' }, {
      maxHR: 190,
      zoneModel: { type: 'hrmax', boundaries: [0.6, 0.7, 0.8, 0.9] },
      pauseThresholdMps: 0.3,
    })
    expect(explicit).toEqual(implicit)
  })

  // Karvonen / heart-rate-reserve worked example. maxHR=190, restingHR=50 ->
  // reserve = 140. Reuses the §1.6 fixture (same raw HR samples) so the
  // *only* thing that changes is the zone anchor:
  //   pct = (hr - restingHR) / (maxHR - restingHR) = (hr - 50) / 140
  //   140 -> (140-50)/140 = 90/140  = 0.6429 -> z2 (was z3 under %HRmax: 140/190=0.7368)
  //   145 -> (145-50)/140 = 95/140  = 0.6786 -> z2 (was z3: 145/190=0.7632)
  //   185 -> (185-50)/140 = 135/140 = 0.9643 -> z5 (185/190=0.9737 -> also z5)
  //   186 -> (186-50)/140 = 136/140 = 0.9714 -> z5
  //   184 -> (184-50)/140 = 134/140 = 0.9571 -> z5
  //   142 -> (142-50)/140 = 92/140  = 0.6571 -> z2 (was z3: 142/190=0.7474)
  // Segment durations are unchanged from §1.6 (ending-sample attribution):
  //   p0->p1 8s -> z2 (145), p1->p2 1s -> z5 (185), p2->p3 1s -> z5 (186),
  //   p3->p4 1s -> z5 (184), p4->p5 8s -> z2 (142)
  // so z2 = 8+8 = 16, z5 = 1+1+1 = 3 -- same totals as §1.6's z3/z5 split,
  // but relabelled into z2 because the reserve-based pct is lower than the
  // %HRmax pct for every sample here.
  test('Karvonen reserve model reclassifies zones relative to %HRmax for identical raw data', () => {
    const points = [
      pt({ lat: 52, lon: 4, timestamp: tsAt(0), heartRate: 140 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(8), heartRate: 145 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(9), heartRate: 185 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(10), heartRate: 186 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(11), heartRate: 184 }),
      pt({ lat: 52, lon: 4, timestamp: tsAt(19), heartRate: 142 }),
    ]
    const stats = analyze({ points, format: 'gpx' }, {
      maxHR: 190,
      zoneModel: { type: 'reserve', restingHR: 50 },
    })
    expect(stats.hrZones).toEqual({ z1: 0, z2: 16, z3: 0, z4: 0, z5: 3 })
    const total = stats.hrZones.z1 + stats.hrZones.z2 + stats.hrZones.z3 + stats.hrZones.z4 + stats.hrZones.z5
    expect(total).toBe(19)
  })

  test('custom boundaries reclassify a zone relative to the default 60/70/80/90 bands', () => {
    // maxHR=200, heartRate=130 -> pct = 0.65: under default boundaries that
    // is z2 (0.6 <= 0.65 < 0.7); raising the first boundary to 0.7 pushes
    // the same sample down into z1 (0.65 < 0.7).
    const points = [
      pt({ timestamp: tsAt(0), heartRate: 120 }),
      pt({ timestamp: tsAt(10), heartRate: 130 }),
    ]
    const defaultStats = analyze({ points, format: 'gpx' }, { maxHR: 200 })
    expect(defaultStats.hrZones.z2).toBe(10)

    const customStats = analyze({ points, format: 'gpx' }, {
      maxHR: 200,
      zoneModel: { type: 'hrmax', boundaries: [0.7, 0.75, 0.85, 0.95] },
    })
    expect(customStats.hrZones.z1).toBe(10)
  })

  test('invalid boundaries throw instead of silently mis-bucketing zones', () => {
    const points = [
      pt({ timestamp: tsAt(0), heartRate: 140 }),
      pt({ timestamp: tsAt(10), heartRate: 150 }),
    ]
    expect(() => analyze({ points, format: 'gpx' }, {
      zoneModel: { type: 'hrmax', boundaries: [0.7, 0.6, 0.8, 0.9] },
    })).toThrow(/strictly increasing/)
    expect(() => analyze({ points, format: 'gpx' }, {
      zoneModel: { type: 'hrmax', boundaries: [0, 0.7, 0.8, 0.9] },
    })).toThrow(/strictly between 0 and 1/)
    expect(() => analyze({ points, format: 'gpx' }, {
      zoneModel: { type: 'hrmax', boundaries: [0.6, 0.7, 0.8, 1] },
    })).toThrow(/strictly between 0 and 1/)
  })

  test('pauseThresholdMps reclassifies a borderline-speed segment as paused', () => {
    // Device distance stream (not GPS) so segment speed is exact: segment
    // 0->1 covers 0.4m in 1s (0.4 m/s), segment 1->2 covers 10m in 10s (1.0 m/s).
    const points = [
      pt({ timestamp: tsAt(0), distanceM: 0 }),
      pt({ timestamp: tsAt(1), distanceM: 0.4 }),
      pt({ timestamp: tsAt(11), distanceM: 10.4 }),
    ]
    const defaultStats = analyze({ points, format: 'gpx' })
    expect(defaultStats.movingTimeSec).toBe(11) // 0.4 m/s clears the default 0.3 m/s floor

    const customStats = analyze({ points, format: 'gpx' }, { pauseThresholdMps: 0.5 })
    expect(customStats.movingTimeSec).toBe(10) // 0.4 m/s now counts as paused
  })
})

describe('§5 elevation gain/loss — hysteresis filter', () => {
  const elevations = [100, 102, 101, 103, 104, 102, 105]

  function elevationPoints() {
    return elevations.map((elevation, i) => pt({
      lon: i * 0.0001,
      timestamp: tsAt(i),
      elevation,
    }))
  }

  test('§5.5 worked example — T=3m gives 3m gain (raw would be 8m)', () => {
    // T=3m is the worked example's own threshold (§5.5), not the library
    // default (§5.3 default is 8m, tuned for GPS-derived altitude) — passed
    // explicitly so this normative fixture stays pinned regardless of default.
    const stats = analyze({ points: elevationPoints(), format: 'gpx' }, { elevationThresholdM: 3 })
    expect(stats.elevationGainM).toBe(3)
    expect(stats.elevationLossM).toBe(0)
  })

  test('§5.3 default is now T=8m — the §5.5 fixture (max 5m from ref) clears nothing', () => {
    const stats = analyze({ points: elevationPoints(), format: 'gpx' })
    expect(stats.elevationGainM).toBe(0)
    expect(stats.elevationLossM).toBe(0)
  })

  test('§5.5 — T=2m gives 7m (documented as still too small for GPS jitter)', () => {
    const stats = analyze({ points: elevationPoints(), format: 'gpx' }, { maxHR: 190, elevationThresholdM: 2 })
    expect(stats.elevationGainM).toBe(7)
  })

  test('elevationLossM uses the same symmetric hysteresis filter (mirror of §5.5)', () => {
    // Mirror image of the §5.5 fixture: a gentle descent buried in jitter.
    // Raw deltas would give loss=8, gain=3; hysteresis (T=3) gives loss=3, gain=0.
    const points = [105, 103, 104, 102, 101, 103, 100].map((elevation, i) => pt({
      lon: i * 0.0001,
      timestamp: tsAt(i),
      elevation,
    }))
    const stats = analyze({ points, format: 'gpx' }, { elevationThresholdM: 3 })
    expect(stats.elevationGainM).toBe(0)
    expect(stats.elevationLossM).toBe(3)
  })
})

describe('§4 split boundaries — carry overshoot forward', () => {
  test('§4.3 worked example — exact km marks, no boundary drift', () => {
    // First segment overshoots the 1km mark by 400m in one step (1400m),
    // which is exactly what triggers the old drift bug.
    const points = [
      pt({ lon: 0, timestamp: tsAt(0) }),
      pt({ lon: 0.0125905, timestamp: tsAt(420) }),
      pt({ lon: 0.0215837, timestamp: tsAt(700) }),
      pt({ lon: 0.0305769, timestamp: tsAt(1000) }),
    ]
    const stats = analyze({ points, format: 'gpx' })
    const paces = stats.splits.map(s => s.paceSecPerKm)
    // Corrected: km1=300, km2=288, km3=292 (each over a true 1000m), plus a
    // trailing 400m partial at pace 300 (§3) — vs the old drifting-boundary
    // output of [300, 280, 300] over 1400/1000/1000m with the tail dropped.
    expect(paces).toEqual([300, 288, 292, 300])
  })
})

describe('§3 split accounting — trailing partial split', () => {
  test('§3.4 worked example — 2500m run emits a 500m partial split', () => {
    const points = [
      pt({ lon: 0, timestamp: tsAt(0) }),
      pt({ lon: 0.0089932, timestamp: tsAt(300) }),
      pt({ lon: 0.0179864, timestamp: tsAt(630) }),
      pt({ lon: 0.022483, timestamp: tsAt(780) }),
    ]
    const stats = analyze({ points, format: 'gpx' })
    expect(stats.splits.map(s => ({ km: s.km, distanceM: s.distanceM, paceSecPerKm: s.paceSecPerKm }))).toEqual([
      { km: 1, distanceM: 1000, paceSecPerKm: 300 },
      { km: 2, distanceM: 1000, paceSecPerKm: 330 },
      { km: 3, distanceM: 500, paceSecPerKm: 300 },
    ])
    const sum = stats.splits.reduce((a, s) => a + s.distanceM, 0)
    expect(sum).toBe(stats.distanceM)
  })

  test('invariant: sum(splits.distanceM) === distanceM on a multi-km fixture with a partial tail', () => {
    // Reuses the §4.3 fixture (3400m: 3 full km + a 400m partial).
    const points = [
      pt({ lon: 0, timestamp: tsAt(0) }),
      pt({ lon: 0.0125905, timestamp: tsAt(420) }),
      pt({ lon: 0.0215837, timestamp: tsAt(700) }),
      pt({ lon: 0.0305769, timestamp: tsAt(1000) }),
    ]
    const stats = analyze({ points, format: 'gpx' })
    expect(stats.splits.length).toBe(4)
    expect(stats.splits[3].distanceM).toBe(400)
    const sum = stats.splits.reduce((a, s) => a + s.distanceM, 0)
    expect(sum).toBe(stats.distanceM)
  })
})

describe('§2 rolling best-kilometre pace', () => {
  test('§2.5 worked example — rolling window interpolated at a non-recorded point beats the bucketed split', () => {
    const points = [
      pt({ lon: 0, timestamp: tsAt(0) }),
      pt({ lon: 0.0053959, timestamp: tsAt(180) }),
      pt({ lon: 0.0125905, timestamp: tsAt(380) }),
    ]
    const stats = analyze({ points, format: 'gpx' })
    expect(stats.bestKmPaceSecPerKm).toBe(260)
  })

  test('§4.3 — rolling best (280) equals the bucketed best there, and is independent of splits (min split pace is 288)', () => {
    const points = [
      pt({ lon: 0, timestamp: tsAt(0) }),
      pt({ lon: 0.0125905, timestamp: tsAt(420) }),
      pt({ lon: 0.0215837, timestamp: tsAt(700) }),
      pt({ lon: 0.0305769, timestamp: tsAt(1000) }),
    ]
    const stats = analyze({ points, format: 'gpx' })
    expect(stats.bestKmPaceSecPerKm).toBe(280)
    const minFullSplitPace = Math.min(...stats.splits.filter(s => s.distanceM === 1000).map(s => s.paceSecPerKm))
    expect(minFullSplitPace).toBe(288)
  })

  test('§2.4 — total distance under 1000m yields bestKmPaceSecPerKm = null', () => {
    const points = [
      pt({ lon: 0, timestamp: tsAt(0) }),
      pt({ lon: 0.001, timestamp: tsAt(10) }),
    ]
    const stats = analyze({ points, format: 'gpx' })
    expect(stats.bestKmPaceSecPerKm).toBeNull()
  })
})

describe('analyze() signature — options object vs. deprecated positional args', () => {
  const elevations = [100, 102, 101, 103, 104, 102, 105]
  const points = elevations.map((elevation, i) => pt({
    lon: i * 0.0001,
    timestamp: tsAt(i),
    elevation,
    heartRate: 140 + i,
  }))
  const activity = { points, format: 'gpx' }

  test('deprecated (activity, maxHR) form matches (activity, { maxHR }) form', () => {
    const positional = analyze(activity, 170)
    const options = analyze(activity, { maxHR: 170 })
    expect(positional).toEqual(options)
  })

  test('deprecated (activity, maxHR, elevationThresholdM) form matches (activity, { maxHR, elevationThresholdM }) form', () => {
    const positional = analyze(activity, 170, 2)
    const options = analyze(activity, { maxHR: 170, elevationThresholdM: 2 })
    expect(positional).toEqual(options)
  })

  test('omitting options/positional args entirely uses the same defaults', () => {
    expect(analyze(activity)).toEqual(analyze(activity, {}))
  })
})
