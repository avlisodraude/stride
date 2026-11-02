import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { parse, analyze } from '../dist/index.js'
import { elevationChartConfig } from '../dist/charts.js'

// Generous regression ceilings, not a promise of identical throughput on every
// machine. Run in its own process to isolate heap measurements from Jest.
const sizes = [10_000, 100_000]
for (const size of sizes) {
  let xml = '<gpx><trk><trkseg>'
  const origin = Date.UTC(2026, 0, 1)
  for (let i = 0; i < size; i++) {
    xml += `<trkpt lat="0" lon="${i * 0.00001}"><time>${new Date(origin + i * 1000).toISOString()}</time><ele>${10 + i % 10}</ele></trkpt>`
  }
  xml += '</trkseg></trk></gpx>'
  global.gc?.()
  const memoryBefore = process.memoryUsage().heapUsed
  const start = performance.now()
  const activity = parse(xml)
  const parsed = performance.now()
  const stats = analyze(activity, { splitDistanceM: 500 })
  const analyzed = performance.now()
  const profile = elevationChartConfig(activity, stats).data.datasets.flatMap(d => d.data)
  const finished = performance.now()
  const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - memoryBefore)
  assert.equal(activity.points.length, size)
  assert.equal(stats.elapsedTimeSec, size - 1)
  assert.equal(stats.splits.reduce((sum, s) => sum + s.distanceM, 0), stats.distanceM)
  assert.ok(stats.bestKmPaceSecPerKm > 0)
  assert.ok(profile.length <= 200)
  assert.equal(Math.max(...profile.map(p => p.y)), 19)
  assert.equal(Math.min(...profile.map(p => p.y)), 10)
  assert.ok(finished - start < 60_000, 'Large-file parsing and analysis exceeded 60 seconds')
  assert.ok(heapGrowth < 1024 ** 3, 'Large-file heap growth exceeded 1 GiB')
  console.log(JSON.stringify({ records: size, parseMs: Math.round(parsed - start), analyzeMs: Math.round(analyzed - parsed), chartMs: Math.round(finished - analyzed), heapGrowthMiB: Math.round(heapGrowth / 1024 ** 2) }))
}
