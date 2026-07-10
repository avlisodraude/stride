// Chart builders live at @alosha/stride/charts — a separate entry point, so
// parse/analyze consumers never pull in Chart.js.
//
// To RENDER these configs you need the optional peer:  npm install chart.js
// (also needed for the ChartConfiguration type in TypeScript). The builders
// themselves never call Chart.js — they return plain config objects, which
// is why this script runs fine without chart.js installed.
import { parseFile, analyze } from '@alosha/stride'
import {
  paceChartConfig,
  elevationChartConfig,
  hrZonesChartConfig,
  splitsChartConfig,
} from '@alosha/stride/charts'

const activity = await parseFile(new URL('../test/fixtures/sample-run.tcx', import.meta.url).pathname)
const stats = analyze(activity, { maxHR: 185 })

const pace = paceChartConfig(activity, stats)
const elevation = elevationChartConfig(activity, stats, { units: 'imperial' })
const zones = hrZonesChartConfig(stats)
const splits = splitsChartConfig(stats)

console.log(`pace:      type=${pace.type}, labels=[${pace.data.labels.join(', ')}]`)
console.log(`elevation: type=${elevation.type}, ${elevation.data.labels.length} points`)
console.log(`hrZones:   type=${zones.type}, data=[${zones.data.datasets[0].data.join(', ')}]`)
console.log(`splits:    type=${splits.type}, labels=[${splits.data.labels.join(', ')}]`)

// In the browser (with chart.js installed):
//   import { Chart } from 'chart.js/auto'
//   new Chart(canvas, paceChartConfig(activity, stats))

// Output (node examples/06-charts.mjs, after npm run build at the repo root):
//
// pace:      type=line, labels=[km 1, km 2 (0.98 km)]
// elevation: type=line, 201 points
// hrZones:   type=doughnut, data=[0, 147, 184, 269, 0]
// splits:    type=bar, labels=[km 1, km 2 (0.98 km)]
