import { parse } from './parser.js'
import { analyze, formatPace, formatDistance, formatDuration } from './analyzer.js'

const [, , command = 'help', filePath] = process.argv

function printStats(filePath: string, units: 'metric' | 'imperial' = 'metric') {
  const activity = parse(filePath)
  const stats = analyze(activity)

  console.log(`\n🏃 @alosha/stride — ${activity.name ?? filePath}\n`)

  console.log(`  Distance:      ${formatDistance(stats.distanceM, units)}`)
  console.log(`  Moving time:   ${formatDuration(stats.movingTimeSec)}`)
  console.log(`  Elapsed time:  ${formatDuration(stats.elapsedTimeSec)}`)
  console.log(`  Avg pace:      ${formatPace(stats.avgPaceSecPerKm, units)}`)
  if (stats.bestKmPaceSecPerKm) {
    console.log(`  Best km pace:  ${formatPace(stats.bestKmPaceSecPerKm, units)}`)
  }
  console.log(`  Elevation ↑:   ${stats.elevationGainM}m`)
  console.log(`  Elevation ↓:   ${stats.elevationLossM}m`)
  if (stats.avgHeartRate) {
    console.log(`  Avg HR:        ${stats.avgHeartRate} bpm`)
    console.log(`  Max HR:        ${stats.maxHeartRate} bpm`)
  }
  if (stats.avgCadence) {
    console.log(`  Avg cadence:   ${stats.avgCadence} spm`)
  }

  if (stats.splits.length > 0) {
    console.log('\n  Splits:')
    for (const split of stats.splits) {
      const hr = split.avgHeartRate ? `  HR ${split.avgHeartRate}bpm` : ''
      const elev = split.elevationGainM > 0 ? `  ↑${split.elevationGainM}m` : ''
      console.log(`    km ${split.km.toString().padStart(2)}  ${formatPace(split.paceSecPerKm, units)}${elev}${hr}`)
    }
  }

  console.log()
}

function help() {
  console.log(`
@alosha/stride — GPX, TCX & FIT running analytics

Usage:
  stride analyze <file.gpx|file.tcx|file.fit>            Analyze a run (metric)
  stride analyze <file.gpx|file.tcx|file.fit> --imperial  Use imperial units

Built by Alosha → https://stride.alosha.dev
`)
}

if (command === 'analyze') {
  if (!filePath) {
    console.error('Error: provide a GPX, TCX or FIT file path.\n  stride analyze run.gpx')
    process.exit(1)
  }
  const imperial = process.argv.includes('--imperial')
  try {
    printStats(filePath, imperial ? 'imperial' : 'metric')
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
} else {
  help()
}
