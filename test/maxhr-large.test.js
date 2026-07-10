/**
 * Regression: maxHeartRate must be computed with a single-pass reduce, never
 * `Math.max(...hrValues)`. Spreading a long HR array into a call throws
 * "RangeError: Maximum call stack size exceeded" once the array is large
 * enough — a multi-hour activity recorded at 1 Hz is tens of thousands of
 * samples, and some FIT files carry far more. This exercises an array large
 * enough that the old spread-based implementation crashed.
 *
 * Runs against the built output in dist/ like the rest of the suite.
 */
import { analyze } from '../dist/index.js'

test('maxHeartRate on a very long HR stream does not overflow the stack', () => {
  const N = 200_000
  const points = new Array(N)
  for (let i = 0; i < N; i++) {
    // A sawtooth HR in [100, 179] so the true maximum is a known value (179),
    // and it is not the first or last sample.
    points[i] = { lat: 0, lon: 0, timestamp: new Date(i * 1000), heartRate: 100 + (i % 80) }
  }

  let stats
  expect(() => {
    stats = analyze({ points, format: 'gpx' }, { maxHR: 190 })
  }).not.toThrow()

  expect(stats.maxHeartRate).toBe(179)
})
