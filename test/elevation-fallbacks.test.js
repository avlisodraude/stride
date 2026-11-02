import { analyze } from '../dist/index.js'

function downhill(totals = {}, points = [100, 80]) {
  return analyze({
    format: 'fit', ...totals,
    points: points.map((elevation, i) => ({
      lat: 0, lon: i / 100, distanceM: i * 1000, elevation, timestamp: new Date(i * 300000),
    })),
  })
}

test('missing device descent falls back without discarding device ascent', () => {
  const stats = downhill({ deviceElevationGainM: 10 })
  expect(stats.elevationGainM).toBe(10)
  expect(stats.elevationLossM).toBe(20)
  expect(stats.elevationGainSource).toBe('device')
  expect(stats.elevationLossSource).toBe('computed')
  expect(stats.elevationSource).toBe('mixed')
})

test('a device descent-only total is independently preferred', () => {
  const stats = downhill({ deviceElevationLossM: 18 })
  expect(stats.elevationGainM).toBe(0)
  expect(stats.elevationLossM).toBe(18)
  expect(stats.elevationGainSource).toBe('computed')
  expect(stats.elevationLossSource).toBe('device')
  expect(stats.elevationSource).toBe('mixed')
})

test.each([NaN, Infinity, -1])('invalid device descent (%s) does not become a false zero', raw => {
  const stats = downhill({ deviceElevationGainM: 10, deviceElevationLossM: raw })
  expect(stats.elevationLossM).toBe(20)
  expect(stats.elevationLossSource).toBe('computed')
  expect(stats.elevationGainSource).toBe('device')
})

test('a zero contradicting a confirmed descent falls back independently', () => {
  const stats = downhill({ deviceElevationGainM: 10, deviceElevationLossM: 0 })
  expect(stats.elevationGainM).toBe(10)
  expect(stats.elevationLossM).toBe(20)
  expect(stats.elevationSource).toBe('mixed')
})

test('a real device zero on a flat track is retained', () => {
  const stats = downhill({ deviceElevationGainM: 0, deviceElevationLossM: 0 }, [100, 100])
  expect(stats.elevationSource).toBe('device')
  expect(stats.elevationGainM).toBe(0)
  expect(stats.elevationLossM).toBe(0)
})

test('invalid ascent cannot erase a valid device descent', () => {
  const stats = downhill({ deviceElevationGainM: NaN, deviceElevationLossM: 18 }, [80, 100])
  expect(stats.elevationGainM).toBe(20)
  expect(stats.elevationLossM).toBe(18)
  expect(stats.elevationGainSource).toBe('computed')
  expect(stats.elevationLossSource).toBe('device')
})

test('device totals retain independent provenance on sparse tracks', () => {
  const stats = downhill({ deviceElevationLossM: 18 }, [100])
  expect(stats.elevationLossM).toBe(18)
  expect(stats.elevationGainSource).toBe('computed')
  expect(stats.elevationLossSource).toBe('device')
  expect(stats.elevationSource).toBe('mixed')
})
