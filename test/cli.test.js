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

  test('analyze with a file path defaults to metric units, human output', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx'])).toEqual({
      kind: 'analyze',
      filePath: 'run.gpx',
      units: 'metric',
      json: false,
    })
  })

  test('--imperial flag is honoured', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx', '--imperial'])).toEqual({
      kind: 'analyze',
      filePath: 'run.gpx',
      units: 'imperial',
      json: false,
    })
  })

  test('--json flag is honoured, and flags may precede the file path', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', '--json', 'run.gpx'])).toEqual({
      kind: 'analyze',
      filePath: 'run.gpx',
      units: 'metric',
      json: true,
    })
  })

  test('--max-hr and --elevation-threshold accept "--flag value" and "--flag=value"', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx', '--max-hr', '185'])).toMatchObject({
      kind: 'analyze',
      maxHR: 185,
    })
    expect(parseArgs(['node', 'cli.js', 'analyze', '--elevation-threshold=2', 'run.gpx'])).toMatchObject({
      kind: 'analyze',
      elevationThresholdM: 2,
    })
  })

  test('a non-numeric or missing value for a numeric flag is an invalidOption, not NaN', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx', '--max-hr', 'high'])).toMatchObject({
      kind: 'invalidOption',
    })
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx', '--max-hr'])).toMatchObject({
      kind: 'invalidOption',
    })
  })

  test('an unknown --flag is an invalidOption, not silently ignored', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx', '--imperail'])).toMatchObject({
      kind: 'invalidOption',
    })
  })

  test('a second positional argument is an invalidOption', () => {
    expect(parseArgs(['node', 'cli.js', 'analyze', 'run.gpx', 'other.fit'])).toMatchObject({
      kind: 'invalidOption',
    })
  })
})

describe('HELP_TEXT / MISSING_FILE_ERROR', () => {
  test('help text documents the analyze command and every flag', () => {
    expect(HELP_TEXT).toContain('stride analyze <file.gpx|file.tcx|file.fit>')
    expect(HELP_TEXT).toContain('--imperial')
    expect(HELP_TEXT).toContain('--json')
    expect(HELP_TEXT).toContain('--max-hr')
    expect(HELP_TEXT).toContain('--elevation-threshold')
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

    // No "↑Xm" on either split: the fixture's altitude stream is flat
    // enough that the 8m GPS-derived default threshold (metrics-spec.md
    // §5.3) confirms no climb, and cli-lib omits the segment when gain is 0.
    // km 2 is a trailing 980m partial, labelled with its real distance —
    // the same convention the chart builders use.
    expect(output).toContain('Splits:')
    expect(output).toContain('km  1  5:03/km  HR 131bpm')
    expect(output).toContain('km  2  5:03/km  (0.98 km)  HR 154bpm')
  })

  test('--imperial converts distance and pace units in the stats block', () => {
    const output = formatStats(activity.name ?? fixturePath, stats, 'imperial')

    expect(output).toContain('Distance:      1.23 mi')
    expect(output).toContain('Avg pace:      8:08/mi')
    expect(output).toContain('Best km pace:  8:08/mi')
    // The partial-split label follows the unit system too.
    expect(output).toContain('(0.61 mi)')
    expect(output).not.toContain('/km')
    expect(output).not.toContain(' km\n')
    expect(output).not.toContain('(0.98 km)')
  })

  test('--imperial converts elevation to feet, in the totals and in split gains', () => {
    // climb-run.fit: deviceElevationGainM 78 / loss 18, split gain 58 (hysteresis).
    const climb = parse(join(here, 'fixtures', 'climb-run.fit'))
    const climbStats = analyze(climb)

    const metric = formatStats('climb', climbStats, 'metric')
    expect(metric).toContain(`Elevation ↑:   ${climbStats.elevationGainM}m`)
    expect(metric).toContain(`Elevation ↓:   ${climbStats.elevationLossM}m`)

    const imperial = formatStats('climb', climbStats, 'imperial')
    expect(imperial).toContain(`Elevation ↑:   ${Math.round(climbStats.elevationGainM * 3.28084)}ft`)
    expect(imperial).toContain(`Elevation ↓:   ${Math.round(climbStats.elevationLossM * 3.28084)}ft`)
    expect(imperial).toContain(`↑${Math.round(climbStats.splits[0].elevationGainM * 3.28084)}ft`)
    expect(imperial).not.toMatch(/\d+m\b/)
  })

  test('an under-1km activity renders its single split as an explicit partial', () => {
    const climb = parse(join(here, 'fixtures', 'climb-run.fit'))
    const climbStats = analyze(climb) // 720m total → one partial split
    const output = formatStats('climb', climbStats, 'metric')
    expect(output).toContain('(0.72 km)')
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
