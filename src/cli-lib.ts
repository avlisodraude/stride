/**
 * Pure argument-parsing and output-formatting helpers for the CLI. Kept
 * separate from cli.ts so they're testable without touching process.argv,
 * process.exit, file I/O, or console output.
 */
import { formatPace, formatDistance, formatDuration } from './analyzer.js'
import type { ActivityStats } from './types.js'

export const HELP_TEXT = `
@alosha/stride — GPX, TCX & FIT running analytics

Usage:
  stride analyze <file.gpx|file.tcx|file.fit>            Analyze a run (metric)
  stride analyze <file.gpx|file.tcx|file.fit> --imperial  Use imperial units

Built by Alosha → https://stride.alosha.dev
`

export const MISSING_FILE_ERROR = 'Error: provide a GPX, TCX or FIT file path.\n  stride analyze run.gpx'

export type CliAction =
  | { kind: 'help' }
  | { kind: 'missingFile' }
  | { kind: 'analyze', filePath: string, units: 'metric' | 'imperial' }

export function parseArgs(argv: string[]): CliAction {
  const [, , command = 'help', filePath] = argv

  if (command !== 'analyze') return { kind: 'help' }
  if (!filePath) return { kind: 'missingFile' }

  const imperial = argv.includes('--imperial')
  return { kind: 'analyze', filePath, units: imperial ? 'imperial' : 'metric' }
}

export function formatStats(
  name: string,
  stats: ActivityStats,
  units: 'metric' | 'imperial' = 'metric',
): string {
  const lines: string[] = []

  lines.push(`\n🏃 @alosha/stride — ${name}\n`)

  lines.push(`  Distance:      ${formatDistance(stats.distanceM, units)}`)
  lines.push(`  Moving time:   ${formatDuration(stats.movingTimeSec)}`)
  lines.push(`  Elapsed time:  ${formatDuration(stats.elapsedTimeSec)}`)
  lines.push(`  Avg pace:      ${formatPace(stats.avgPaceSecPerKm, units)}`)
  if (stats.bestKmPaceSecPerKm) {
    lines.push(`  Best km pace:  ${formatPace(stats.bestKmPaceSecPerKm, units)}`)
  }
  lines.push(`  Elevation ↑:   ${stats.elevationGainM}m`)
  lines.push(`  Elevation ↓:   ${stats.elevationLossM}m`)
  if (stats.avgHeartRate) {
    lines.push(`  Avg HR:        ${stats.avgHeartRate} bpm`)
    lines.push(`  Max HR:        ${stats.maxHeartRate} bpm`)
  }
  if (stats.avgCadence) {
    lines.push(`  Avg cadence:   ${stats.avgCadence} spm`)
  }

  if (stats.splits.length > 0) {
    lines.push('\n  Splits:')
    for (const split of stats.splits) {
      const hr = split.avgHeartRate ? `  HR ${split.avgHeartRate}bpm` : ''
      const elev = split.elevationGainM > 0 ? `  ↑${split.elevationGainM}m` : ''
      lines.push(`    km ${split.km.toString().padStart(2)}  ${formatPace(split.paceSecPerKm, units)}${elev}${hr}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
