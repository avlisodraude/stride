import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = fileURLToPath(new URL('../../test-results/browser/', import.meta.url))
const compiled = await build({
  stdin: {
    contents: `
      import { parse, analyze } from '@alosha/stride';
      import * as charts from '@alosha/stride/charts';
      import Chart from 'chart.js/auto';
      globalThis.StrideTest = { parse, analyze, charts, Chart };
    `,
    resolveDir: root,
  },
  bundle: true, platform: 'browser', format: 'iife', write: false, target: 'es2020',
})
const browser = await chromium.launch({ channel: process.env.STRIDE_BROWSER_CHANNEL || undefined })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => route.abort())
await mkdir(output, { recursive: true })

try {
  await page.setContent('<!doctype html><html lang="en"><head><title>Stride chart checks</title></head><body></body></html>')
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  for (const [name, viewport] of [['desktop', { width: 1100, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport)
    for (const units of ['metric', 'imperial']) {
      const result = await page.evaluate(({ units }) => {
        for (const chart of Object.values(globalThis.StrideTest.Chart.instances)) chart.destroy()
        document.body.replaceChildren()
        const { analyze, charts, Chart } = globalThis.StrideTest
        const points = [
          { lat: 0, lon: 0, distanceM: 0, elevation: 10, heartRate: 120, timestamp: new Date(0) },
          { lat: 0, lon: 0.001, distanceM: 10, elevation: 20, heartRate: 140, timestamp: new Date(10000) },
          { lat: 0, lon: 0.01, distanceM: 1000, elevation: 30, heartRate: 150, timestamp: new Date(300000) },
          { lat: 0, lon: 1, distanceM: 5000, elevation: 500, heartRate: 200, timestamp: new Date(600000), segmentStart: true },
          { lat: 0, lon: 1.01, distanceM: 6000, elevation: 510, heartRate: 160, timestamp: new Date(900000) },
        ]
        const activity = { format: 'gpx', points }
        const stats = analyze(activity)
        const configs = [
          charts.paceChartConfig(activity, stats, { units }), charts.elevationChartConfig(activity, stats, { units }),
          charts.heartRateChartConfig(activity, stats, { units }), charts.hrZonesChartConfig(stats), charts.splitsChartConfig(stats, { units }),
        ]
        const results = configs.map((config, i) => {
          const canvas = document.createElement('canvas')
          canvas.width = Math.min(700, innerWidth - 32)
          canvas.height = 220
          canvas.style.display = 'block'
          document.body.appendChild(canvas)
          config.options = { ...config.options, animation: false, responsive: false }
          const chart = new Chart(canvas, config)
          const meta = chart.getDatasetMeta(0)
          const pixels = chart.ctx.getImageData(0, 0, canvas.width, canvas.height).data
          let painted = 0
          for (let j = 3; j < pixels.length; j += 4) if (pixels[j] > 0) painted++
          const visible = meta.data.filter(element => !element.skip && Number.isFinite(element.x) && Number.isFinite(element.y))
          const item = {
            painted, visible: visible.length, width: canvas.width,
            segments: i === 1 || i === 2 ? chart.data.datasets.reduce((sum, _, index) => sum + chart.getDatasetMeta(index).dataset.segments.length, 0) : null,
            distanceRatio: i === 1 || i === 2 ? (meta.data[1].x - meta.data[0].x) / (meta.data[2].x - meta.data[0].x) : null,
          }
          // Exercise actual tooltip drawing and the configured callbacks.
          chart.setActiveElements([{ datasetIndex: 0, index: 0 }])
          chart.tooltip.setActiveElements([{ datasetIndex: 0, index: 0 }], { x: visible[0].x, y: visible[0].y })
          chart.update('none')
          return item
        })
        return { distance: stats.distanceM, results }
      }, { units })
      assert.equal(result.distance, 2000)
      assert.equal(result.results.length, 5)
      for (const chart of result.results) {
        assert(chart.painted > 100, 'Canvas should contain rendered content')
        assert(chart.visible > 0, 'Dataset should have visible elements')
        assert(chart.width <= viewport.width, 'Chart should fit its viewport')
        if (chart.segments != null) {
          assert.equal(chart.segments, 2, 'Profile must draw separate continuous spans')
          assert(Math.abs(chart.distanceRatio - 0.01) < 0.001, 'Numeric x-axis must preserve unequal distances')
        }
      }
      await page.screenshot({ path: `${output}charts-${name}-${units}.png`, fullPage: true })
      console.log(`PASS five rendered charts, gap handling and tooltips: ${name}, ${units}`)
    }
  }

  const prefixed = await readFile(new URL('../fixtures/prefixed-run.gpx', import.meta.url), 'utf8')
  const parsed = await page.evaluate(xml => {
    const { parse, analyze } = globalThis.StrideTest
    const stats = analyze(parse(xml, { format: 'gpx' }))
    let malformedRejected = false
    try { parse('<gpx>') } catch { malformedRejected = true }
    const gpxGap = parse('<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="bad" lon="0"/><trkpt lat="0" lon="1"/></trkseg></trk></gpx>')
    const track = lon => `<Track><Trackpoint><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position></Trackpoint><Trackpoint><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>${lon + 0.001}</LongitudeDegrees></Position></Trackpoint></Track>`
    const tcxTracks = parse(`<TrainingCenterDatabase><Activities><Activity><Lap>${track(0)}${track(1)}</Lap></Activity></Activities></TrainingCenterDatabase>`)
    const dateInput = timestamp => `<gpx><trk><trkseg><trkpt lat="0" lon="0"><time>${timestamp}</time><extensions><TrackPointExtension><hr>150</hr></TrackPointExtension></extensions></trkpt></trkseg></trk></gpx>`
    const invalidDate = parse(dateInput('2026-02-30T12:00:00Z'))
    const validOffset = parse(dateInput('2026-03-01T00:30:00+01:00'))
    return { heartRate: stats.avgHeartRate, malformedRejected, gpxGapDistance: analyze(gpxGap).distanceM, tcxTracksDistance: analyze(tcxTracks).distanceM,
      invalidCalendarDropped: invalidDate.points[0].timestamp == null && invalidDate.parseDiagnostics.droppedReadings === 1,
      validOffset: validOffset.points[0].timestamp.toISOString(), singleMaxHR: analyze(validOffset).maxHeartRate }
  }, prefixed)
  assert.equal(parsed.heartRate, 145)
  assert.equal(parsed.malformedRejected, true)
  assert.equal(parsed.gpxGapDistance, 0)
  assert.equal(parsed.tcxTracksDistance, 222)
  assert.equal(parsed.invalidCalendarDropped, true)
  assert.equal(parsed.validOffset, '2026-02-28T23:30:00.000Z')
  assert.equal(parsed.singleMaxHR, 150)

  const indoor = await page.evaluate(() => {
    const { analyze, charts, Chart } = globalThis.StrideTest
    for (const chart of Object.values(Chart.instances)) chart.destroy()
    document.body.replaceChildren()
    const activity = { format: 'fit', points: [0, 1, 2].map(i => ({ timestamp: new Date(i * 60000), heartRate: 120 + i * 10 })) }
    const stats = analyze(activity)
    const configs = [
      charts.heartRateChartConfig(activity, stats),
      charts.splitsChartConfig(analyze({ ...activity, points: activity.points.map((p, i) => ({ ...p, distanceM: i * 1609.344 })) }, { splitDistanceM: 1609.344 })),
      charts.heartRateChartConfig({ format: 'fit', points: [{ distanceM: 0, heartRate: 120 }, { distanceM: 100 }, { distanceM: 200, heartRate: 150 }] }, analyze({ format: 'fit', points: [{ distanceM: 0, heartRate: 120 }, { distanceM: 100 }, { distanceM: 200, heartRate: 150 }] })),
    ]
    return configs.map(config => {
      const canvas = document.createElement('canvas')
      canvas.width = 350
      canvas.height = 220
      document.body.appendChild(canvas)
      config.options = { ...config.options, animation: false, responsive: false }
      const chart = new Chart(canvas, config)
      return {
        xTitle: chart.options.scales.x.title.text,
        labels: chart.data.labels,
        visible: chart.getDatasetMeta(0).data.filter(p => !p.skip && Number.isFinite(p.x) && Number.isFinite(p.y)).length,
        totalVisible: chart.data.datasets.reduce((sum, _, i) => sum + chart.getDatasetMeta(i).data.filter(p => !p.skip && Number.isFinite(p.x) && Number.isFinite(p.y)).length, 0),
        radius: chart.getDatasetMeta(0).data[0].options.radius,
      }
    })
  })
  assert.equal(indoor[0].xTitle, 'Elapsed time (min)')
  assert.equal(indoor[0].visible, 3)
  assert.deepEqual(indoor[1].labels, ['mi 1', 'mi 2'])
  assert.equal(indoor[1].visible, 2)
  assert.equal(indoor[2].totalVisible, 2)
  assert(indoor[2].radius > 0, 'Isolated sensor readings must have visible markers')
  await page.screenshot({ path: `${output}indoor-and-mile-splits.png`, fullPage: true })

  for (const units of ['metric', 'imperial']) {
    const profiles = await page.evaluate(({ units }) => {
      const { analyze, charts, Chart } = globalThis.StrideTest
      for (const chart of Object.values(Chart.instances)) chart.destroy()
      document.body.replaceChildren()
      const activity = { format: 'fit', points: Array.from({ length: 1001 }, (_, i) => ({
        distanceM: i,
        ...(i >= 600 && i <= 604 ? {} : { elevation: i === 501 ? 200 : i === 502 ? 50 : 100, heartRate: i === 501 ? 200 : i === 502 ? 50 : 100 }),
      })) }
      const stats = analyze(activity)
      const configs = [charts.elevationChartConfig(activity, stats, { units }), charts.heartRateChartConfig(activity, stats, { units })]
      return configs.map(config => {
        const canvas = document.createElement('canvas')
        canvas.width = 350
        canvas.height = 220
        document.body.appendChild(canvas)
        config.options = { ...config.options, animation: false, responsive: false }
        const chart = new Chart(canvas, config)
        const values = chart.data.datasets.flatMap(d => d.data.map(p => p.y))
        const peakDataset = chart.data.datasets.findIndex(d => d.data.some(p => p.y === Math.max(...values)))
        const peakIndex = chart.data.datasets[peakDataset].data.findIndex(p => p.y === Math.max(...values))
        const peak = chart.getDatasetMeta(peakDataset).data[peakIndex]
        chart.tooltip.setActiveElements([{ datasetIndex: peakDataset, index: peakIndex }], { x: peak.x, y: peak.y })
        chart.update('none')
        return {
          count: values.length, min: Math.min(...values), max: Math.max(...values),
          segments: chart.data.datasets.reduce((sum, _, i) => sum + chart.getDatasetMeta(i).dataset.segments.length, 0),
          peakVisible: !peak.skip && Number.isFinite(peak.x) && Number.isFinite(peak.y),
        }
      })
    }, { units })
    for (const [i, profile] of profiles.entries()) {
      const factor = units === 'imperial' && i === 0 ? 3.28084 : 1
      assert(profile.count <= 200, 'The point budget applies to all datasets combined')
      assert(Math.abs(profile.max - 200 * factor) < 1e-8, 'Brief peak must survive sampling and rendering')
      assert(Math.abs(profile.min - 50 * factor) < 1e-8, 'Brief valley must survive sampling and rendering')
      assert.equal(profile.segments, 2, 'Missing sensor readings must break the rendered line')
      assert.equal(profile.peakVisible, true)
    }
    await page.screenshot({ path: `${output}profile-peaks-and-gaps-${units}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('PASS browser namespace parsing and malformed XML rejection')
  console.log('PASS browser calendar dates, timezone offsets and single-sample maximum HR')
  console.log('PASS rendered indoor HR time axis and mile splits')
  console.log('PASS rendered brief peaks, valleys and sensor dropouts in both unit systems')
} finally {
  await browser.close()
}
