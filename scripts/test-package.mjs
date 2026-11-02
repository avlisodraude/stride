// Exercise the packed artifact from an isolated consumer, not repository imports.
// Run after the build, or use `npm run check` for the complete verification.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = mkdtempSync(join(tmpdir(), 'stride-package-'))
const consumer = join(temporary, 'consumer')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const fixtures = join(root, 'test/fixtures')
const installEnvironment = { ...process.env }
// npm run can export this project-level option as an environment flag.
// npm 11 rejects that flag in a different project. All installs here already
// use --ignore-scripts, so no dependency lifecycle scripts are executed.
for (const key of Object.keys(installEnvironment)) {
  if (key.toLowerCase() === 'npm_config_allow_scripts') delete installEnvironment[key]
}

function run(command, args, cwd = consumer) {
  try {
    return execFileSync(command, args, { cwd, env: installEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed\n${error.stdout ?? ''}${error.stderr ?? ''}`, { cause: error })
  }
}

try {
  const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root))
  assert(packed.files.some(file => file.path === 'dist/index.cjs'), 'Build the package before running test:package.')
  assert(packed.files.some(file => file.path === 'dist/garmin-fitsdk.LICENSE.txt'), 'Bundled SDK notice must ship with the package.')
  mkdirSync(consumer)
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'stride-consumer-check', private: true, type: 'module' }))
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(temporary, packed.filename)])

  const esm = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { parseFile, analyze } from '@alosha/stride';
    import { paceChartConfig } from '@alosha/stride/charts';
    const activity = await parseFile(${JSON.stringify(join(fixtures, 'sample-run.fit'))});
    const stats = analyze(activity);
    assert.equal(stats.distanceM, 1980);
    const indoor = analyze({ format: 'fit', points: [{ distanceM: 0, heartRate: 140 }, { distanceM: 1000, heartRate: 150 }] }, { splitDistanceM: 500 });
    assert.equal(indoor.quality.timingSource, 'assumed');
    assert.equal(indoor.splits.length, 2);
    assert.equal(paceChartConfig(activity, stats).type, 'line');
    const segmented = await parseFile(${JSON.stringify(join(fixtures, 'gpx-single-trk-multi-seg.gpx'))});
    const segmentedStats = analyze(segmented);
    assert(segmentedStats.distanceM < 50);
    assert.equal(segmentedStats.movingTimeSec, 15);
    assert.equal(segmentedStats.elapsedTimeSec, 310);
    try { createRequire(import.meta.url).resolve('chart.js'); throw new Error('optional chart.js was installed'); }
    catch (error) { assert.equal(error.code, 'MODULE_NOT_FOUND'); }
  `
  run(process.execPath, ['--input-type=module', '-e', esm])
  console.log('PASS packed ESM consumer without chart.js')

  run(process.execPath, ['--input-type=commonjs', '-e', `
    const assert = require('node:assert/strict');
    const { parse, analyze } = require('@alosha/stride');
    const { splitsChartConfig } = require('@alosha/stride/charts');
    const stats = analyze(parse(${JSON.stringify(join(fixtures, 'sample-run.fit'))}));
    assert.equal(stats.distanceM, 1980);
    const indoor = analyze({ format: 'fit', points: [{ heartRate: 140 }, { heartRate: 150 }] });
    assert.equal(indoor.distanceSource, 'unavailable');
    assert.equal(indoor.avgHeartRate, 150);
    assert.equal(analyze({ format: 'fit', points: [{ heartRate: 150 }] }).maxHeartRate, 150);
    assert.equal(parse('<gpx><trk><trkseg><trkpt lat="0" lon="0"><time>2026-02-30T12:00:00Z</time></trkpt></trkseg></trk></gpx>').points[0].timestamp, undefined);
    assert.equal(splitsChartConfig(stats).type, 'bar');
    assert.equal(parse(${JSON.stringify(join(fixtures, 'prefixed-run.gpx'))}).points[0].heartRate, 140);
  `])
  console.log('PASS packed CommonJS consumer')

  run(process.execPath, ['--conditions=browser', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as stride from '@alosha/stride';
    assert.equal('parseFile' in stride, false);
    assert.equal(stride.parse('<gpx/>').format, 'gpx');
  `])
  console.log('PASS browser export condition')

  const bundled = await build({
    stdin: { contents: "import * as stride from '@alosha/stride'; globalThis.Stride = stride;", resolveDir: consumer },
    bundle: true, platform: 'browser', format: 'iife', write: false, target: 'es2020',
  })
  const context = vm.createContext({ console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer })
  vm.runInContext(bundled.outputFiles[0].text, context)
  assert.equal('parseFile' in context.Stride, false)
  for (const [file, format] of [['gpx-climb.gpx', 'gpx'], ['prefixed-run.gpx', 'gpx'], ['gpx-single-trk-multi-seg.gpx', 'gpx'], ['sample-run.tcx', 'tcx'], ['sample-run.fit', 'fit']]) {
    const bytes = new Uint8Array(readFileSync(join(fixtures, file)))
    // Same file-content detection as the README upload example.
    const isFit = bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54
    const activity = context.Stride.parse(isFit ? bytes : new TextDecoder().decode(bytes))
    assert.equal(activity.format, format)
    assert(context.Stride.analyze(activity).distanceM > 0)
  }
  console.log('PASS browser bundle parses GPX, TCX and FIT without Node globals')
  const invalidCalendar = context.Stride.parse('<gpx><trk><trkseg><trkpt lat="0" lon="0"><time>2026-02-30T12:00:00Z</time></trkpt></trkseg></trk></gpx>')
  assert.equal(invalidCalendar.points[0].timestamp, undefined)
  assert.equal(invalidCalendar.parseDiagnostics.droppedReadings, 1)

  const result = JSON.parse(run(process.execPath, [join(consumer, 'node_modules/@alosha/stride/dist/cli.js'), 'analyze', join(fixtures, 'sample-run.fit'), '--json']))
  assert.equal(result.distanceM, 1980)
  console.log('PASS packed CLI')

  const tsc = join(root, 'node_modules/typescript/bin/tsc')
  const flags = ['--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext']
  writeFileSync(join(consumer, 'core.mts'), `
    import { parse, analyze, type Activity, type DataQuality, type TimerEvent, type ParseDiagnostics } from '@alosha/stride';
    const activity: Activity = parse('<gpx/>'); analyze(activity);
    const segmented: Activity = { format: 'gpx', points: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1, segmentStart: true }] };
    analyze(segmented);
    const indoor: Activity = { format: 'fit', points: [{ distanceM: 0 }, { distanceM: 1000 }], timerEvents: [] as TimerEvent[] };
    const stats = analyze(indoor, { splitDistanceM: 500, pauseDetection: 'speed' });
    const quality: DataQuality = stats.quality;
    const counts: ParseDiagnostics | null = quality.parseDiagnostics;
    const index: number = stats.splits[0].index;
    void counts; void index;
  `)
  run(process.execPath, [tsc, ...flags, 'core.mts'])
  console.log('PASS core TypeScript consumer without chart.js')

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `chart.js@${pkg.devDependencies['chart.js']}`])
  const esmTypes = `
    import { parse, analyze, type Activity } from '@alosha/stride';
    import { paceChartConfig } from '@alosha/stride/charts';
    import type { ChartConfiguration } from 'chart.js';
    const activity: Activity = parse('<gpx/>');
    const chart: ChartConfiguration = paceChartConfig(activity, analyze(activity));
    void chart;
  `
  writeFileSync(join(consumer, 'consumer.mts'), esmTypes)
  writeFileSync(join(consumer, 'consumer.cts'), `import stride = require('@alosha/stride'); stride.analyze(stride.parse('<gpx/>'));`)
  writeFileSync(join(consumer, 'browser.mts'), `
    import { parse, analyze } from '@alosha/stride';
    // @ts-expect-error parseFile must not be available in browser declarations
    import { parseFile } from '@alosha/stride';
    analyze(parse('<gpx/>')); void parseFile;
  `)
  run(process.execPath, [tsc, ...flags, 'consumer.mts', 'consumer.cts'])
  run(process.execPath, [tsc, ...flags, '--customConditions', 'browser', 'browser.mts'])
  console.log('PASS ESM, CommonJS and browser TypeScript consumers')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
