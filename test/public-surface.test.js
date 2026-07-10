/**
 * Guards the public API surface of every entry point. An accidental export
 * is a compatibility promise nobody meant to make; this test forces a
 * deliberate decision (update the hard-coded list, or don't export it) any
 * time someone adds a new export to src/index.ts, src/index.browser.ts or
 * src/charts.ts.
 */

const INDEX_EXPORTS = ['analyze', 'formatDistance', 'formatDuration', 'formatPace', 'parse', 'parseFile']

const BROWSER_EXPORTS = INDEX_EXPORTS.filter((name) => name !== 'parseFile')

const CHARTS_EXPORTS = [
  'elevationChartConfig',
  'heartRateChartConfig',
  'hrZonesChartConfig',
  'paceChartConfig',
  'splitsChartConfig',
]

test('dist/index.js exports exactly the intended public surface', async () => {
  const mod = await import('../dist/index.js')
  expect(Object.keys(mod).sort()).toEqual(INDEX_EXPORTS)
})

test('dist/index.browser.js exports the same surface minus parseFile', async () => {
  const mod = await import('../dist/index.browser.js')
  expect(Object.keys(mod).sort()).toEqual(BROWSER_EXPORTS)
})

test('dist/charts.js exports exactly the intended chart builders', async () => {
  const mod = await import('../dist/charts.js')
  expect(Object.keys(mod).sort()).toEqual(CHARTS_EXPORTS)
})
