/**
 * Tests run as native ESM (Node's --experimental-vm-modules) against the built
 * output in dist/, so no Babel/ts-jest transform is required. Run `npm run
 * build` before running these tests directly.
 *
 * Stats are produced by running analyze() over a real fixture rather than
 * hand-built, so a drift between analyzer output shape and chart input
 * expectations shows up here instead of silently passing.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse, analyze } from '../dist/index.js'
import {
  paceChartConfig,
  elevationChartConfig,
  heartRateChartConfig,
  hrZonesChartConfig,
  splitsChartConfig,
} from '../dist/charts.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixtures', 'sample-run.tcx')

const activity = parse(fixturePath)
const stats = analyze(activity)

describe('paceChartConfig', () => {
  test('line chart with one dataset, one label/point per split, y = pace in min/km', () => {
    const config = paceChartConfig(activity, stats)

    expect(config.type).toBe('line')
    expect(config.data.datasets.length).toBe(1)
    expect(config.data.labels.length).toBe(stats.splits.length)

    const data = config.data.datasets[0].data
    expect(data.length).toBe(stats.splits.length)
    data.forEach((v, i) => {
      expect(v).not.toBeUndefined()
      expect(v).toBeCloseTo(stats.splits[i].paceSecPerKm / 60, 2)
    })
  })
})

describe.each([
  ['elevation', elevationChartConfig, 2, 14],
  ['heartRate', heartRateChartConfig, 120, 163],
])('%s profile', (field, build, min, max) => {
  test('plots numeric distance on a linear axis and preserves the full route', () => {
    const config = build(activity, stats)
    const data = config.data.datasets[0].data
    expect(config.type).toBe('line')
    expect(config.options.scales.x.type).toBe('linear')
    expect(data.length).toBeGreaterThan(0)
    expect(data.length).toBeLessThanOrEqual(200)
    for (const point of data) {
      expect(point.y).toBeGreaterThanOrEqual(min)
      expect(point.y).toBeLessThanOrEqual(max)
    }
    expect(Math.abs(data.at(-1).x * 1000 - stats.distanceM)).toBeLessThanOrEqual(0.5)
  })

  test('imperial units convert distance and elevation values', () => {
    const metric = build(activity, stats).data.datasets[0].data
    const imperial = build(activity, stats, { units: 'imperial' }).data.datasets[0].data
    expect(imperial.at(-1).x).toBeCloseTo(metric.at(-1).x / 1.609344, 6)
    expect(imperial[0].y).toBeCloseTo(metric[0].y * (field === 'elevation' ? 3.28084 : 1), 6)
  })

  test('missing readings do not move the route origin or shortcut corners', () => {
    // The unmeasured middle point is a right-angle corner: summing the
    // sensor-only coordinates would cut diagonally across it.
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01, [field]: 100 },
      { lat: 0.01, lon: 0.01 },
      { lat: 0.01, lon: 0.02, [field]: 110 },
    ]
    const sparse = { format: 'gpx', points }
    const sparseStats = analyze(sparse)
    const data = build(sparse, sparseStats).data.datasets.flatMap(dataset => dataset.data)
    expect(data[0].x).toBeCloseTo(1.111949, 5)
    expect(Math.abs(data.at(-1).x * 1000 - sparseStats.distanceM)).toBeLessThanOrEqual(0.5)
  })

  test('device distances keep missing first/last readings at their real positions', () => {
    const sparse = { format: 'fit', points: [100, 1100, 2100, 3100, 4100].map((distanceM, i) => ({
      lat: 0, lon: i / 100, distanceM, ...(i > 0 && i < 4 ? { [field]: 100 + i } : {}),
    })) }
    const data = build(sparse, analyze(sparse)).data.datasets[0].data
    expect(data.map(p => p.x)).toEqual([1, 2, 3])
  })

  test('keeps unequal distances and nearby points distinct', () => {
    const sparse = { format: 'fit', points: [0, 10, 1000].map((distanceM, i) => ({
      lat: 0, lon: i / 100, distanceM, [field]: 100 + i,
    })) }
    const data = build(sparse, analyze(sparse)).data.datasets[0].data
    expect(data.map(p => p.x)).toEqual([0, 0.01, 1])
  })

  test.each([0, 1, 199, 200, 201, 399, 1001])('bounds sampling for %i readings and keeps both endpoints', length => {
    const sparse = { format: 'fit', points: Array.from({ length }, (_, i) => ({
      lat: 0, lon: 0, distanceM: i * 10, [field]: i + 100,
    })) }
    const data = build(sparse, analyze(sparse)).data.datasets[0].data
    expect(data.length).toBe(Math.min(200, length))
    if (length > 0) {
      expect(data[0].y).toBe(100)
      expect(data.at(-1).y).toBe(length + 99)
    }
  })
})

describe('hrZonesChartConfig', () => {
  test('doughnut chart plots zone seconds (not sample counts), as of 1.0.0', () => {
    const config = hrZonesChartConfig(stats)

    expect(config.type).toBe('doughnut')
    expect(config.data.datasets.length).toBe(1)
    expect(config.data.labels.length).toBe(5)

    const data = config.data.datasets[0].data
    expect(data).toEqual([
      stats.hrZones.z1,
      stats.hrZones.z2,
      stats.hrZones.z3,
      stats.hrZones.z4,
      stats.hrZones.z5,
    ])

    // Zones are seconds and should sum to the HR-covered moving time, not to
    // a small sample count — this is what would break silently if charts.ts
    // still treated hrZones as pre-1.0.0 sample counts.
    const total = data.reduce((a, b) => a + b, 0)
    expect(total).toBe(stats.movingTimeSec)
  })

  test('handles an activity with no heart rate data (stats.hrZones === null) without throwing', () => {
    const noHrActivity = {
      points: [
        { lat: 0, lon: 0, timestamp: new Date(0) },
        { lat: 0.01, lon: 0, timestamp: new Date(10_000) },
      ],
      format: 'gpx',
    }
    const noHrStats = analyze(noHrActivity)
    expect(noHrStats.hrZones).toBeNull()

    expect(() => hrZonesChartConfig(noHrStats)).not.toThrow()
  })
})

describe('splitsChartConfig', () => {
  test('bar chart with one dataset, one label/bar per split, y = pace in min/km', () => {
    const config = splitsChartConfig(stats)

    expect(config.type).toBe('bar')
    expect(config.data.datasets.length).toBe(1)
    expect(config.data.labels.length).toBe(stats.splits.length)

    const data = config.data.datasets[0].data
    expect(data.length).toBe(stats.splits.length)
    data.forEach((v, i) => {
      expect(v).not.toBeUndefined()
      expect(v).toBeCloseTo(stats.splits[i].paceSecPerKm / 60, 2)
    })
  })

  test('does not label the trailing partial split as if it were a full kilometre', () => {
    const lastSplit = stats.splits[stats.splits.length - 1]
    expect(lastSplit.distanceM).toBeLessThan(1000) // sanity: fixture ends on a partial

    const config = splitsChartConfig(stats)
    const lastLabel = config.data.labels[config.data.labels.length - 1]
    expect(lastLabel).not.toBe(`km ${lastSplit.km}`)
  })
})
