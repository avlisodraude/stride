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
  stride analyze <file.gpx|file.tcx|file.fit> [options]

Options:
  --imperial                 Output in miles, feet and min/mi
  --json                     Print the ActivityStats object as JSON (machine-readable)
  --max-hr <bpm>             Max heart rate for HR zone calculation (default 190)
  --elevation-threshold <m>  Elevation hysteresis threshold in metres
                             (default 8 for GPS altitude; use 2 for barometric data)

Built by Alosha → https://stride.alosha.dev
`

export const MISSING_FILE_ERROR = 'Error: provide a GPX, TCX or FIT file path.\n  stride analyze run.gpx'

export type CliAction =
  | { kind: 'help' }
  | { kind: 'missingFile' }
  | { kind: 'invalidOption', message: string }
  | {
      kind: 'analyze'
      filePath: string
      units: 'metric' | 'imperial'
      json: boolean
      maxHR?: number
      elevationThresholdM?: number
    }

// Flags that take a numeric value. Range validation stays in analyze() —
// the CLI only rejects values that aren't numbers at all, so the two never
// disagree about what's acceptable.
const VALUE_FLAGS: Record<string, 'maxHR' | 'elevationThresholdM'> = {
  '--max-hr': 'maxHR',
  '--elevation-threshold': 'elevationThresholdM',
}

export function parseArgs(argv: string[]): CliAction {
  const [, , command = 'help', ...rest] = argv

  if (command !== 'analyze') return { kind: 'help' }

  let filePath: string | undefined
  let units: 'metric' | 'imperial' = 'metric'
  let json = false
  const numeric: { maxHR?: number; elevationThresholdM?: number } = {}

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]

    if (arg === '--imperial') { units = 'imperial'; continue }
    if (arg === '--json') { json = true; continue }

    // --flag value and --flag=value are both accepted.
    const eq = arg.indexOf('=')
    const flagName = eq === -1 ? arg : arg.slice(0, eq)
    const target = VALUE_FLAGS[flagName]
    if (target) {
      const raw = eq === -1 ? rest[++i] : arg.slice(eq + 1)
      const value = raw != null && raw.trim() !== '' ? Number(raw) : NaN
      if (!Number.isFinite(value)) {
        return { kind: 'invalidOption', message: `Error: ${flagName} expects a number (got ${raw ?? 'nothing'}).` }
      }
      numeric[target] = value
      continue
    }

    // Unknown flags are errors, not silence — a typo'd --imperail silently
    // producing metric output is worse than an immediate complaint.
    if (arg.startsWith('--')) {
      return { kind: 'invalidOption', message: `Error: unknown option ${flagName}. Run "stride" for usage.` }
    }

    if (filePath != null) {
      return { kind: 'invalidOption', message: `Error: unexpected argument "${arg}" — one file per run.` }
    }
    filePath = arg
  }

  if (!filePath) return { kind: 'missingFile' }
  return { kind: 'analyze', filePath, units, json, ...numeric }
}

// Elevation figures are stored in metres; convert for imperial output so the
// unit system is applied consistently (pace and distance already convert).
function formatElevation(metres: number, units: 'metric' | 'imperial'): string {
  return units === 'imperial' ? `${Math.round(metres * 3.28084)}ft` : `${metres}m`
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
  lines.push(`  Elevation ↑:   ${formatElevation(stats.elevationGainM, units)}`)
  lines.push(`  Elevation ↓:   ${formatElevation(stats.elevationLossM, units)}`)
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
      const elev = split.elevationGainM > 0 ? `  ↑${formatElevation(split.elevationGainM, units)}` : ''
      // A trailing partial split (distanceM !== 1000) is labelled with its
      // real distance — same convention as the chart builders — so a 720m
      // remainder never reads as a full kilometre.
      const partial = split.distanceM !== 1000 ? `  (${formatDistance(split.distanceM, units)})` : ''
      lines.push(`    km ${split.km.toString().padStart(2)}  ${formatPace(split.paceSecPerKm, units)}${partial}${elev}${hr}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
