/**
 * Tests run as native ESM (Node's --experimental-vm-modules) against the
 * built output in dist/, so no Babel/ts-jest transform is required. Run
 * `npm run build` before running these tests directly.
 *
 * cli.ts itself just reads process.argv and performs I/O — the testable
 * surface is cli-lib.ts's pure parseArgs() and formatStats().
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse, analyze } from '../dist/index.js'
import { parseArgs, formatStats, HELP_TEXT, MISSING_FILE_ERROR } from '../dist/cli-lib.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixtures', 'sample-run.tcx')

describe('parseArgs', () => {
  test('unknown command resolves to help', () => {
    expect(parseArgs(['node', 'cli.js', 'frobnicate'])).toEqual({ kind: 'help' })
  })

  test('no command at all resolves to help', () => {
    expect(parseArgs(['node', 'cli.js'])).toEqual({ kind: 'help' })
  })

  test('analyze without a file path resolves to missingFile, not a thrown error', () => {
    expect(() => parseArgs(['node', 'cli.js', 'analyze'])).not.toThrow()
    expect(parseArgs(['node', 'cli.js', 'analyze'])).toEqual({ kind: 'missingFile' })
  })

  test('analyze with a file path defaults to metric units', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx'])).toEqual({
      kind: 'analyze',
      filePath: 'run.gpx',
      units: 'metric',
    })
  })

  test('--imperial flag is honoured', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx', '--imperial'])).toEqual({
      kind: 'analyze',
      filePath: 'run.gpx',
      units: 'imperial',
    })
  })
})

describe('HELP_TEXT / MISSING_FILE_ERROR', () => {
  test('help text documents the analyze command and units flag', () => {
    expect(HELP_TEXT).toContain('stride analyze <file.gpx|file.tcx|file.fit>')
    expect(HELP_TEXT).toContain('--imperial')
  })

  test('missing-file error names the flag without a stack trace', () => {
    expect(MISSING_FILE_ERROR).toContain('provide a GPX, TCX or FIT file path')
  })
})

describe('formatStats', () => {
  const activity = parse(fixturePath)
  const stats = analyze(activity)

  test('renders the stats block for a known fixture (metric)', () => {
    const output = formatStats(activity.name ?? fixturePath, stats, 'metric')

    expect(output).toContain(`🏃 @alosha/stride — ${activity.name ?? fixturePath}`)
    expect(output).toContain('Distance:      1.98 km')
    expect(output).toContain('Moving time:   10:00')
    expect(output).toContain('Elapsed time:  10:00')
    expect(output).toContain('Avg pace:      5:03/km')
    expect(output).toContain('Best km pace:  5:03/km')
    expect(output).toContain(`Elevation ↑:   ${stats.elevationGainM}m`)
    expect(output).toContain(`Elevation ↓:   ${stats.elevationLossM}m`)
    expect(output).toContain(`Avg HR:        ${stats.avgHeartRate} bpm`)
    expect(output).toContain(`Max HR:        ${stats.maxHeartRate} bpm`)
    expect(output).toContain(`Avg cadence:   ${stats.avgCadence} spm`)

    expect(output).toContain('Splits:')
    expect(output).toContain('km  1  5:03/km  ↑6m  HR 131bpm')
    expect(output).toContain('km  2  5:03/km  ↑6m  HR 154bpm')
  })

  test('--imperial converts distance and pace units in the stats block', () => {
    const output = formatStats(activity.name ?? fixturePath, stats, 'imperial')

    expect(output).toContain('Distance:      1.23 mi')
    expect(output).toContain('Avg pace:      8:08/mi')
    expect(output).toContain('Best km pace:  8:08/mi')
    expect(output).not.toContain('/km')
    expect(output).not.toContain(' km\n')
  })

  test('omits HR/cadence lines when the activity has none, and Splits when there are none', () => {
    const bareStats = {
      ...stats,
      avgHeartRate: null,
      maxHeartRate: null,
      avgCadence: null,
      splits: [],
    }
    const output = formatStats('bare run', bareStats, 'metric')

    expect(output).not.toContain('Avg HR:')
    expect(output).not.toContain('Max HR:')
    expect(output).not.toContain('Avg cadence:')
    expect(output).not.toContain('Splits:')
  })
})
