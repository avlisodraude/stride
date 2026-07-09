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
import {
  parse,
  analyze,
  paceChartConfig,
  elevationChartConfig,
  heartRateChartConfig,
  hrZonesChartConfig,
  splitsChartConfig,
} from '../dist/index.js'

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

describe('elevationChartConfig', () => {
  test('line chart with one dataset, y = elevation in metres, matching labels length', () => {
    const config = elevationChartConfig(activity, stats)

    expect(config.type).toBe('line')
    expect(config.data.datasets.length).toBe(1)

    const data = config.data.datasets[0].data
    expect(data.length).toBeGreaterThan(0)
    expect(config.data.labels.length).toBe(data.length)

    // Fixture's raw elevation samples range 2-14m; sampled/downsampled points
    // must stay within that envelope and never be undefined.
    data.forEach(v => {
      expect(v).not.toBeUndefined()
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThanOrEqual(14)
    })
  })

  // Regression guard for the flat-earth + decimated-cumulative-sum bug: the
  // chart's own distance maths must agree with analyze()'s, not drift from
  // it (they used to disagree by ~60% on this fixture).
  test('final x-axis label matches stats.distanceM, to within the label\'s own rounding', () => {
    const config = elevationChartConfig(activity, stats)
    const lastLabel = config.data.labels[config.data.labels.length - 1]
    const labelKm = parseFloat(lastLabel)

    expect(lastLabel.endsWith('km')).toBe(true)
    // Label is rounded to one decimal place (100m), so allow up to 50m of
    // rounding slack on either side.
    expect(Math.abs(labelKm * 1000 - stats.distanceM)).toBeLessThanOrEqual(50)
  })
})

describe('heartRateChartConfig', () => {
  test('line chart with one dataset, y = heart rate in bpm, matching labels length', () => {
    const config = heartRateChartConfig(activity, stats)

    expect(config.type).toBe('line')
    expect(config.data.datasets.length).toBe(1)

    const data = config.data.datasets[0].data
    expect(data.length).toBeGreaterThan(0)
    expect(config.data.labels.length).toBe(data.length)

    // Fixture's raw HR samples range 120-163bpm.
    data.forEach(v => {
      expect(v).not.toBeUndefined()
      expect(v).toBeGreaterThanOrEqual(120)
      expect(v).toBeLessThanOrEqual(163)
    })
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

  // KNOWN BUG: hrZonesChartConfig throws when stats.hrZones is null instead
  // of returning a usable empty chart. Left failing and unskipped on
  // purpose; charts.ts is fixed for this in the very next commit.
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

  // KNOWN BUG: the trailing partial split (fixture's last split is 983m, not
  // 1000m) gets the exact same "km N" label as a full kilometre split, so the
  // chart presents it as if a whole extra kilometre had been run. Left
  // failing and unskipped on purpose; charts.ts is fixed for this in the
  // very next commit.
  test('does not label the trailing partial split as if it were a full kilometre', () => {
    const lastSplit = stats.splits[stats.splits.length - 1]
    expect(lastSplit.distanceM).toBeLessThan(1000) // sanity: fixture ends on a partial

    const config = splitsChartConfig(stats)
    const lastLabel = config.data.labels[config.data.labels.length - 1]
    expect(lastLabel).not.toBe(`km ${lastSplit.km}`)
  })
})
