import { analyze } from '../dist/index.js'
import { elevationChartConfig, heartRateChartConfig } from '../dist/charts.js'

const activity = points => ({ format: 'fit', points })
const plotted = config => config.data.datasets.flatMap(dataset => dataset.data)

// Exercise both builders: elevation summits/valleys and short HR efforts need
// the same guarantees, including after unit conversion and downsampling.
describe.each([
  ['elevation', elevationChartConfig],
  ['heartRate', heartRateChartConfig],
])('%s profile fidelity', (field, build) => {
  test.each(['metric', 'imperial'])('keeps a brief peak and valley between old uniform samples (%s)', units => {
    const input = activity(Array.from({ length: 1001 }, (_, i) => ({ distanceM: i, [field]: i === 501 ? 200 : i === 502 ? 50 : 100 })))
    const config = build(input, analyze(input), { units })
    const data = plotted(config)
    const factor = units === 'imperial' && field === 'elevation' ? 3.28084 : 1
    expect(data.length).toBeLessThanOrEqual(200)
    expect(Math.max(...data.map(p => p.y))).toBeCloseTo(200 * factor, 8)
    expect(Math.min(...data.map(p => p.y))).toBeCloseTo(50 * factor, 8)
    expect(data[0].x).toBe(0)
    expect(data.at(-1).x).toBeCloseTo(units === 'imperial' ? 1000 / 1609.344 : 1, 8)
    expect(data.every((p, i) => i === 0 || p.x > data[i - 1].x)).toBe(true)
  })

  test('splits datasets at missing sensor readings without moving the x-axis', () => {
    const input = activity([0, 100, 200, 300, 400].map((distanceM, i) => ({ distanceM, ...(i === 2 ? {} : { [field]: 100 + i }) })))
    const config = build(input, analyze(input))
    expect(config.data.datasets.map(d => d.data)).toEqual([
      [{ x: 0, y: 100 }, { x: 0.1, y: 101 }],
      [{ x: 0.3, y: 103 }, { x: 0.4, y: 104 }],
    ])
    expect(config.data.datasets.every(d => d.spanGaps === false)).toBe(true)
  })

  test('downsampling cannot reconnect runs when all gap points are filtered out', () => {
    const input = activity(Array.from({ length: 1001 }, (_, i) => ({ distanceM: i, ...(i >= 499 && i <= 503 ? {} : { [field]: 100 + i % 10 }) })))
    const config = build(input, analyze(input))
    const data = plotted(config)
    expect(data.length).toBeLessThanOrEqual(200)
    expect(config.data.datasets).toHaveLength(2)
    expect(config.data.datasets[0].data.every(p => p.x < 0.499)).toBe(true)
    expect(config.data.datasets[1].data.every(p => p.x > 0.503)).toBe(true)
  })

  test('route breaks and sensor dropouts are separate barriers', () => {
    const input = activity(Array.from({ length: 10 }, (_, i) => ({ distanceM: i * 100, ...(i === 4 ? { segmentStart: true } : {}), ...(i === 7 ? {} : { [field]: 100 + i }) })))
    expect(build(input, analyze(input)).data.datasets.map(d => d.data.length)).toEqual([4, 3, 2])
  })

  test('unplottable timestamps break indoor time-axis profiles', () => {
    const input = activity([0, 60, null, 180, 240].map((seconds, i) => ({ [field]: 100 + i, ...(seconds == null ? {} : { timestamp: new Date(seconds * 1000) }) })))
    const config = build(input, analyze(input))
    expect(config.data.datasets.map(d => d.data)).toEqual([
      [{ x: 0, y: 100 }, { x: 1, y: 101 }],
      [{ x: 3, y: 103 }, { x: 4, y: 104 }],
    ])
  })

  test('isolated readings remain visible rather than hidden behind zero-radius markers', () => {
    const input = activity([0, 100, 200].map((distanceM, i) => ({ distanceM, ...(i === 1 ? {} : { [field]: 100 + i }) })))
    const datasets = build(input, analyze(input)).data.datasets
    expect(datasets.map(d => d.data.length)).toEqual([1, 1])
    expect(datasets.every(d => d.pointRadius > 0)).toBe(true)
  })

  test('fragmented profiles retain a hard global point limit and never bridge a gap', () => {
    const input = activity(Array.from({ length: 1001 }, (_, i) => ({ distanceM: i, ...(i % 2 === 0 ? { [field]: i === 500 ? 200 : 100 } : {}) })))
    const config = build(input, analyze(input))
    expect(plotted(config).length).toBeLessThanOrEqual(200)
    expect(config.data.datasets.every(d => d.data.length === 1 && d.pointRadius > 0)).toBe(true)
    expect(plotted(config).some(p => p.y === 200)).toBe(true)
  })

  test('equal extrema and bucket boundaries never duplicate or reorder points', () => {
    const input = activity(Array.from({ length: 1001 }, (_, i) => ({ distanceM: i, [field]: 100 })))
    const data = plotted(build(input, analyze(input)))
    expect(data.length).toBeLessThanOrEqual(200)
    expect(data.every((p, i) => i === 0 || p.x > data[i - 1].x)).toBe(true)
    expect(data[0].x).toBe(0)
    expect(data.at(-1).x).toBe(1)
  })
})

test('missing elevation does not create a gap in a complete HR stream', () => {
  const input = activity([0, 100, 200].map((distanceM, i) => ({ distanceM, heartRate: 150, ...(i === 1 ? {} : { elevation: 10 }) })))
  const stats = analyze(input)
  expect(elevationChartConfig(input, stats).data.datasets).toHaveLength(2)
  expect(heartRateChartConfig(input, stats).data.datasets).toHaveLength(1)
})
