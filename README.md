# @alosha/stride

Parse GPX, TCX and FIT files, compute running metrics, and build Chart.js dashboards — zero config.

[![npm version](https://img.shields.io/npm/v/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![npm downloads](https://img.shields.io/npm/dm/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![Types included](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **GPX, TCX & FIT in, insights out** — parses GPX and TCX XML plus binary FIT files from Garmin, Strava, Coros, Wahoo and more. Format is auto-detected; the same `analyze()` works for all three.
- **Every running metric you want** — pace, splits, HR zones (Z1–Z5), elevation, cadence, moving vs. elapsed time — each computed the way Garmin and Strava compute it, and labelled with where it came from (`distanceSource`, `elevationSource`).
- **Charts with zero boilerplate** — 5 ready-made Chart.js configs (pace, elevation, heart rate, HR zones, splits) behind a separate `@alosha/stride/charts` entry point, so parse/analyze consumers never pull in Chart.js.
- **CLI and library** — `npx stride analyze run.gpx`, metric or imperial, no config required.

Upgrading from 1.x? Read **[MIGRATING.md](./MIGRATING.md)** — two loud changes, three silent ones.

## Install

```bash
npm install @alosha/stride
```

Requires **Node >= 18** (any current LTS). Parsing and metrics have no peer
dependencies. `chart.js` is an *optional* peer dependency needed **only** if
you use the chart builders, which live behind a separate entry point:

```bash
npm install chart.js    # only if you import @alosha/stride/charts
```

Installing `@alosha/stride` alone pulls no charting code and emits no peer
warning. Note that `@alosha/stride/charts` returns plain Chart.js
configuration objects and never calls Chart.js itself — you need the package
to **render** a config and, if you use TypeScript, to resolve the
`ChartConfiguration` type in the builders' signatures.

## Quick start

```ts
import { parseFile, analyze } from '@alosha/stride'

// Parse a GPX, TCX or FIT file — the format is detected automatically
const activity = await parseFile('./my-run.fit')

// Compute all running metrics
const stats = analyze(activity, { maxHR: 185 })
console.log(stats.distanceM, stats.avgPaceSecPerKm, stats.hrZones)
console.log(stats.distanceSource, stats.elevationSource)  // 'device' | 'computed'
```

To render charts, add the optional `chart.js` peer and import from the
charts entry point:

```ts
import { analyze } from '@alosha/stride'
import { paceChartConfig, splitsChartConfig } from '@alosha/stride/charts'
import { Chart } from 'chart.js/auto'   // npm install chart.js

const stats = analyze(activity)
new Chart(document.querySelector<HTMLCanvasElement>('#pace')!, paceChartConfig(activity, stats))
new Chart(document.querySelector<HTMLCanvasElement>('#splits')!, splitsChartConfig(stats))
```

## Accuracy

Every metric is computed the way the systems you compare against — Garmin
Connect, Strava — compute it, with the derivation written down in
[`docs/metrics-spec.md`](./docs/metrics-spec.md). The four that most
libraries get wrong:

- **Device-reported distance over summed haversine.** Summing haversine
  distances between raw GPS fixes integrates ±3–5 m of per-fix jitter as
  extra path length, typically +1–3%. When a FIT or TCX file carries the
  device's own filtered distance stream, stride uses it — and tells you so
  via `distanceSource`. ([spec §2.3](./docs/metrics-spec.md))
- **Time-weighted HR zones over sample counts.** Smart-recording watches
  sample hard efforts more densely, so counting samples systematically
  inflates time in high zones. Stride attributes each segment's *duration*
  to a zone, matching what Garmin Connect and TrainingPeaks report.
  ([spec §1](./docs/metrics-spec.md))
- **Hysteresis-filtered elevation, with deference to the device.** Raw
  positive altitude deltas integrate GPS noise as climb; stride only credits
  a rise once it cumulatively clears a threshold (default 8 m, the
  GPS-altitude figure), and defers outright to the device's barometric total
  when a FIT file carries one. ([spec §5](./docs/metrics-spec.md))
- **A true rolling best-km.** The fastest kilometre almost never starts on a
  split boundary, so the fastest *bucketed split* systematically understates
  it. Stride slides a 1000 m window over the cumulative series with
  interpolated edges, like Strava's Best Efforts. ([spec §2](./docs/metrics-spec.md))

## Why do these numbers disagree?

Three pairs of numbers differ **by design**. Each alone can read as a bug;
together they are the same policy applied consistently: report the best
available instrument for each question, and never fudge one number to make
it agree with another.

**`distanceM: 1980` vs `deviceDistanceM: 1983.3`.** The device counts
distance accumulated before its first position fix (and during position-less
segments); `distanceM` measures between the first and last *recorded* point.
The gap is real distance that has no GPS points to attach to. Both are
reported; nothing is derived from `deviceDistanceM`.

**`elevationGainM: 78` vs `sum(splits[].elevationGainM): 58`** (when
`elevationSource === 'device'`). The device's total ascent is an
activity-level scalar from its barometric altimeter — it cannot be
attributed to a distance range. Splits therefore keep using the GPS-altitude
hysteresis pass, the only elevation signal that can be sliced by distance.
The parts answer a different question than the whole, with a different
instrument. We do not fudge the splits to make them add up.

**Elevation fell (threshold) *and* rose (device) in the same release.**
Two independent 2.0.0 changes: the hysteresis threshold went 3 m → 8 m
because GPS altitude noise is larger than barometric (lowers gain —
`sample-run.tcx`: 12 → 0), and FIT files carrying `session.totalAscent` now
defer to the device (can raise it — `climb-run.fit`: 78 where GPS computes
58). Check `elevationSource` to see which regime a file is in.

**A known limitation of the hysteresis filter:** a climb's trailing rise
that never cumulatively clears the threshold is never credited — crediting
an in-progress, still-ambiguous rise would re-admit exactly the noise the
threshold exists to reject. `gpx-climb.gpx` climbs 30 m from its starting
elevation and reports 28. ([spec §5.3](./docs/metrics-spec.md))

## What stride does not solve

- **Attributing a device elevation total to splits.** When
  `elevationSource === 'device'`, per-split gains stay GPS-derived and do
  not sum to `elevationGainM` (see above). No rescaling is offered.
- **The trailing unconfirmed climb.** Hysteresis never credits a rise that
  hasn't cleared the threshold when the track ends: `gpx-climb.gpx` climbs
  30 m, reports 28. Lowering `elevationThresholdM` narrows this at the cost
  of admitting noise.
- **Reconciling `deviceDistanceM` with `distanceM`.** The gap (distance
  before the first fix) is reported, not repaired — there are no points to
  attach it to.
- **GPX device data.** GPX has no standard device distance or elevation
  total, so GPX is always `distanceSource: 'computed'` and
  `elevationSource: 'computed'`; its accuracy is bounded by GPS quality.
- **DEM elevation correction.** Garmin Connect re-derives elevation from a
  terrain model for non-barometric watches; stride only works with what is
  in the file.
- **Device pause events.** `movingTimeSec` comes from a speed threshold
  (`pauseThresholdMps`), not from the watch's own timer-stop events, which
  most exports don't carry per-point.
- **Lactate-threshold (LTHR) zone model.** `zoneModel` supports the two
  anchors a runner can actually supply — `hrmax` and `reserve` (Karvonen).
  Anchoring zones to lactate-threshold HR is deliberately not implemented:
  LTHR must be *measured* by a 30-minute time-trial field test, and the
  established LTHR conventions use seven zones rather than the five in
  `HeartRateZones`. A future `zoneModel: { type: 'lthr' }` mapping onto the
  existing five zones would be a non-breaking addition.
- **Streaming parse.** `parse()` and `parseFile()` read the whole file into
  memory. Activity files are kilobytes to a few megabytes, so this is the
  right trade; it would be the wrong one for a multi-gigabyte archive.

## Supported formats

| Format | Extension | Input types | Typical sources |
|---|---|---|---|
| **GPX** | `.gpx` | file path, raw XML string | Strava, Apple Health/Watch routes, Komoot, most apps |
| **TCX** | `.tcx` | file path, raw XML string | Garmin Connect, Strava, Wahoo, Zwift |
| **FIT** | `.fit` | file path, `Uint8Array`, `ArrayBuffer` | Garmin, Coros, Wahoo, Suunto, Polar (native device files) |

The format is auto-detected — you call `parse()`/`parseFile()` and never
branch on file type (pass `{ format }` to skip sniffing when you already
know it). All three normalise into the same `Activity` shape: GPS track,
elevation, heart rate, cadence, timestamps, and — where the source provides
them — the device's own distance and elevation figures.

## CLI

```bash
npx stride analyze my-run.gpx
npx stride analyze my-run.tcx            # TCX and FIT work too — auto-detected
npx stride analyze my-run.fit
npx stride analyze my-run.fit --imperial
```

Flags: `--imperial` for miles/feet/min-per-mile; `--max-hr 185` and
`--elevation-threshold 2` expose the corresponding `analyze()` options; and
`--json` prints the raw `ActivityStats` object — the same documented schema
the library returns — for scripting:

```bash
npx stride analyze my-run.fit --json | jq '.avgPaceSecPerKm'
npx stride analyze my-run.fit --max-hr 185 --json | jq '.hrZones'
```

Output (real output for the repo's `test/fixtures/sample-run.tcx`):

```
🏃 @alosha/stride — test/fixtures/sample-run.tcx

  Distance:      1.98 km
  Moving time:   10:00
  Elapsed time:  10:00
  Avg pace:      5:03/km
  Best km pace:  5:03/km
  Elevation ↑:   0m
  Elevation ↓:   0m
  Avg HR:        143 bpm
  Max HR:        163 bpm
  Avg cadence:   174 spm

  Splits:
    km  1  5:03/km  HR 131bpm
    km  2  5:03/km  (0.98 km)  HR 154bpm
```

## API

### `parse(input, options?)`

```ts
parse(input: string | Uint8Array | ArrayBuffer, options?: { format?: 'gpx' | 'tcx' | 'fit' }): Activity
```

Synchronous. Accepts a file path (Node), raw GPX/TCX XML, or FIT bytes, and
auto-detects the format:

```ts
import { parse } from '@alosha/stride'

const a1 = parse('./run.gpx')                 // file path (GPX / TCX / FIT)
const a2 = parse(xmlString)                   // raw GPX or TCX XML
const a3 = parse(new Uint8Array(fitBytes))    // FIT bytes (browser / streamed)
const a4 = parse(xmlString, { format: 'gpx' }) // skip format sniffing
```

| Input | Detected as |
|---|---|
| String containing `<gpx` | GPX |
| String containing `<TrainingCenterDatabase` | TCX |
| File path to a `.FIT` file, or `Uint8Array` / `ArrayBuffer` bytes | FIT |

A short string that is neither a readable path nor recognisable GPX/TCX/FIT
throws a clear error (with a truncated preview of the input), not a bare
`ENOENT`.

### `parseFile(path, options?)` — Node only

```ts
parseFile(path: string, options?: { format?: 'gpx' | 'tcx' | 'fit' }): Promise<Activity>
```

Async, backed by `fs/promises` — reads without blocking the event loop, and
skips path-vs-content sniffing entirely since the argument is unambiguously
a path. Prefer it whenever you're in Node and reading from disk; use
`parse()` when you already hold the content (an upload, a string, a fetch
response) or need a synchronous call.

```ts
import { parseFile } from '@alosha/stride'

const activity = await parseFile('./my-run.fit')
const gpx = await parseFile('./export.xml', { format: 'gpx' })  // odd extension, known format
```

`parseFile` is absent from the browser build (see [Browser](#browser)).

### `analyze(activity, options?)`

```ts
analyze(activity: Activity, options?: AnalyzeOptions): ActivityStats
```

Computes every metric in one pass. The 1.x positional form
`analyze(activity, maxHR, elevationThresholdM)` still works but is
deprecated and will be removed in 3.0.0.

```ts
const stats = analyze(activity, {
  maxHR: 185,
  zoneModel: { type: 'reserve', restingHR: 52 },
  elevationThresholdM: 2,
  pauseThresholdMps: 0.5,
})
```

#### `AnalyzeOptions`

| Option | Type | Default | What it changes |
|---|---|---|---|
| `maxHR` | `number` | `190` | The athlete's max heart rate — the reference all zone percentages are computed against. Affects `hrZones` only. Must be finite and within **60–220 bpm**; outside that range throws instead of silently dividing by zero or inverting the pct formula into a single zone. |
| `zoneModel` | `HrZoneModel` | `{ type: 'hrmax' }` | Which formula turns a heart rate into a zone percentage. `{ type: 'hrmax' }` uses `hr / maxHR` (the historical behaviour). `{ type: 'reserve', restingHR }` uses the Karvonen formula, `(hr − restingHR) / (maxHR − restingHR)` — the same effort reads a *lower* percentage, so samples shift toward lower zones relative to `'hrmax'`. `restingHR` must be finite, **non-negative**, and **less than `maxHR`**; missing, negative, or out-of-order values throw. Both variants accept an optional `boundaries: [number, number, number, number]` (default `[0.6, 0.7, 0.8, 0.9]`, the 60/70/80/90% bands). Boundaries must be strictly increasing and each strictly between 0 and 1 — anything else throws instead of silently mis-bucketing. |
| `elevationThresholdM` | `number` | `8` | The hysteresis threshold: a cumulative rise (or fall) must clear this many metres before it is credited as gain (or loss). The default suits GPS-derived altitude; pass `2` for barometric data. Affects `elevationGainM`/`elevationLossM` when `elevationSource` is `'computed'`, and `splits[].elevationGainM` always. |
| `pauseThresholdMps` | `number` | `0.3` | Speed (m/s) at or below which a segment counts as paused rather than moving. Raising it treats slow shuffling and GPS drift at rest as pauses. Affects `movingTimeSec`, and through it `avgPaceSecPerKm` (= moving time ÷ distance). |

### Chart builders — `@alosha/stride/charts`

All builders return a plain [Chart.js configuration object](https://www.chartjs.org/docs/latest/configuration/)
— you instantiate `Chart` yourself, so the library never touches the DOM.
Requires the optional `chart.js` peer to render (and for the
`ChartConfiguration` type).

| Function | Chart type | Notes |
|---|---|---|
| `paceChartConfig(activity, stats, opts?)` | Line | Trailing partial split labelled distinctly (`km 2 (0.98 km)`) |
| `elevationChartConfig(activity, stats, opts?)` | Line | x-axis uses the same distance series as `stats.distanceM` |
| `heartRateChartConfig(activity, stats, opts?)` | Line | x-axis uses the same distance series as `stats.distanceM` |
| `hrZonesChartConfig(stats)` | Doughnut | Never throws — renders a labelled empty chart when there's no HR data |
| `splitsChartConfig(stats, opts?)` | Bar | Partial split's bar is faded as well as labelled |

```ts
import { Chart } from 'chart.js/auto'
import { paceChartConfig, elevationChartConfig, hrZonesChartConfig } from '@alosha/stride/charts'

new Chart(canvas1, paceChartConfig(activity, stats, { units: 'imperial' }))
new Chart(canvas2, elevationChartConfig(activity, stats))
new Chart(canvas3, hrZonesChartConfig(stats))
```

### Formatting helpers

```ts
import { formatPace, formatDistance, formatDuration } from '@alosha/stride'

formatPace(302, 'metric')    // "5:02/km"
formatPace(302, 'imperial')  // "8:06/mi"
formatDistance(10240)        // "10.24 km"
formatDuration(3092)         // "51:32"
```

## ActivityStats reference

| Field | Type | Description |
|---|---|---|
| `distanceM` | `number` | Total distance in metres, from the first to the last recorded point |
| `distanceSource` | `'device' \| 'computed'` | Whether `distanceM` (and the series behind `splits[]` / `bestKmPaceSecPerKm`) came from the file's own device distance stream, or was summed from GPS points |
| `deviceDistanceM` | `number \| undefined` | The device's own total distance (TCX `<Lap><DistanceMeters>`, FIT `session.totalDistance`), passed through **unrounded**. Undefined for GPX. May exceed `distanceM` — see [Why do these numbers disagree?](#why-do-these-numbers-disagree) |
| `elapsedTimeSec` | `number` | Total elapsed time in seconds |
| `movingTimeSec` | `number` | Moving time in seconds (segments at or below `pauseThresholdMps` excluded) |
| `avgPaceSecPerKm` | `number` | Average pace in sec/km (moving time ÷ distance) |
| `bestKmPaceSecPerKm` | `number \| null` | Fastest 1000 m anywhere in the activity, as a rolling window with interpolated edges — independent of `splits[]`. Null under 1 km total |
| `elevationGainM` | `number` | Total elevation gain in metres |
| `elevationLossM` | `number` | Total elevation loss in metres |
| `elevationSource` | `'device' \| 'computed'` | `'device'` when a FIT `session.totalAscent`/`totalDescent` was used; `'computed'` for the hysteresis filter (GPX and TCX always). When `'device'`, split gains don't sum to the total — see [Why do these numbers disagree?](#why-do-these-numbers-disagree) |
| `avgHeartRate` | `number \| null` | Average HR in bpm |
| `maxHeartRate` | `number \| null` | Max HR in bpm |
| `hrZones` | `HeartRateZones \| null` | Time in each HR zone, in seconds, time-weighted (not sample-counted) |
| `avgCadence` | `number \| null` | Average cadence in steps/min |
| `splits` | `Split[]` | Per-km splits at exact 1000 m marks, plus a trailing partial split (`distanceM !== 1000`). `sum(splits[].distanceM) === distanceM` |

## Browser

The package ships a dedicated browser build behind the `exports` map's
`browser` condition — bundlers (and TypeScript with
`customConditions: ["browser"]`) resolve `dist/index.browser.js` with its own
type declarations, and that build never references `fs`.

The browser build is `parse()`, `analyze()` and the formatting helpers.
**`parseFile()` is Node-only and absent from the browser build** — in the
browser there are no file paths; read the file yourself and hand the content
to `parse()`:

```ts
import { parse, analyze } from '@alosha/stride'
import { paceChartConfig } from '@alosha/stride/charts'
import { Chart } from 'chart.js/auto'

// A user drops a .fit / .gpx / .tcx export onto your page.
async function renderUpload(file: File, canvas: HTMLCanvasElement) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const activity = parse(bytes)     // format auto-detected: GPX / TCX / FIT
  const stats = analyze(activity)   // distance, pace, HR zones, splits

  new Chart(canvas, paceChartConfig(activity, stats))
  return stats
}
```

(For GPX/TCX you can equally pass the file's text: `parse(await file.text())`.)

## Examples

The [`examples/`](./examples) directory holds small, runnable scripts — one
per feature, each with its real output pasted at the bottom: `parseFile` vs
`parse`, explicit `format`, both zone models side by side, pause and
elevation thresholds, `distanceSource`/`elevationSource` branching, and the
charts entry point. See [`examples/README.md`](./examples/README.md).

## Support & custom work

`@alosha/stride` is free and MIT-licensed, and always will be. When you need more than the open-source library, there's a paid path backed by the maintainer — not a ticket queue:

- **Priority support** — a direct line to the person who wrote it, with prioritised fixes.
- **Custom work** — bespoke chart types or running metrics, and help integrating Stride into your app or platform.

Get in touch at [alosha.dev/support](https://alosha.dev/support).

---

Docs & live demo: [stride.alosha.dev](https://stride.alosha.dev) · Built by [Alosha](https://alosha.dev)
