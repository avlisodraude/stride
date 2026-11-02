# @alosha/stride

Parse GPX, TCX and FIT files, compute running metrics, and build Chart.js dashboards — zero config.

[![npm version](https://img.shields.io/npm/v/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![npm downloads](https://img.shields.io/npm/dm/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![Types included](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **GPX, TCX & FIT in, insights out** — parses GPX and TCX XML plus binary FIT files from Garmin, Strava, Coros, Wahoo and more. Format is auto-detected; the same `analyze()` works for all three.
- **Every running metric you want** — pace, splits, HR zones (Z1–Z5), elevation, cadence, moving vs. elapsed time — with documented timing and sensor policies, and labelled with where it came from (`distanceSource`, `elevationSource`).
- **Charts with zero boilerplate** — 5 ready-made Chart.js configs (pace, elevation, heart rate, HR zones, splits) behind a separate `@alosha/stride/charts` entry point, so parse/analyze consumers never pull in Chart.js.
- **CLI and library** — `npx stride analyze run.gpx`, metric or imperial, no config required.

Version **3.0.0** adds indoor recordings, quality reports, FIT timer handling and custom splits. Upgrading from 2.x or 1.x? Read **[MIGRATING.md](./MIGRATING.md)** for public type and metric changes.

## Install

```bash
npm install @alosha/stride
```

Requires **Node >= 18** (runtime compatibility baseline; use Node 22 for development). Parsing and metrics have no peer
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

Metrics follow the explicit policies and worked examples in
[`docs/metrics-spec.md`](./docs/metrics-spec.md). The main accuracy policies:

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
distance outside the recorded point stream; `distanceM` measures progress
within recorded spans, including indoor points carrying device distance.
The gap can include offsets before recording or excluded span boundaries. Both are
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
- **Timer versus physical movement.** Coherent FIT timer events are preferred
  in auto mode. A running timer can include standing still. Inspect
  `movingTimeSource` or use `pauseDetection: 'speed'` for threshold timing.
- **Lactate-threshold (LTHR) zone model.** `zoneModel` supports the two
  anchors a runner can actually supply — `hrmax` and `reserve` (Karvonen).
  Anchoring zones to lactate-threshold HR is deliberately not implemented:
  LTHR must be *measured* by a 30-minute time-trial field test, and the
  established LTHR conventions use seven zones rather than the five in
  `HeartRateZones`. A future `zoneModel: { type: 'lthr' }` mapping onto the
  existing five zones would be a non-breaking addition.
- **Per-sport analysis in multisport FIT files.** Stride aggregates records
  and session distance/elevation totals into one activity. A synthetic
  two-session fixture verifies those sums; separate statistics for each
  sport and transition handling are not provided.
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
know it). All three normalise into the same `Activity` shape: activity readings (with optional GPS),
elevation, heart rate, cadence, timestamps, and — where the source provides
them — the device's own distance and elevation figures.

FIT decoder errors (including checksum failures and truncated files) reject
the file rather than silently returning partial data.

TCX input must contain at most one activity. Files with multiple `<Activity>`
elements are rejected rather than merging unrelated sessions, sports and
coordinates. Multiple laps within a single activity remain supported.

XML input must be well-formed and have the expected GPX or TCX root.
Missing closing tags, duplicate attributes, multiple roots and undeclared
entity references are rejected. Validation does not apply an XSD schema or
load external DTDs; use ordinary XML text, CDATA and predefined/numeric entities.
XML timestamps use `YYYY-MM-DDTHH:mm:ss` with a four-digit positive year,
optional fractional seconds and optional `Z` / `±HH:mm` offset. Invalid calendar
and clock values are dropped and counted as discarded readings; February 30
cannot silently become a March timestamp. Leap days and offsets crossing
midnight are validated against the written date. Valid `24:00:00` denotes the
following midnight. Timestamps without a zone keep the existing local-time
interpretation; explicit offsets make exports independent of the host timezone.
These calendar/offset checks follow the relevant [XML dateTime rules](https://www.w3.org/TR/xmlschema-2/#dateTime)
within that supported year range; they do not perform whole-document XSD validation.
Negative sensor readings are dropped, and zero HR is treated as missing.
Zero cadence is retained as a valid stopped/coasting reading. Manually
constructed activities reject invalid sensor values in `analyze()`.

GPX track/segment boundaries and each TCX `Track` element (including those
in later laps) are preserved as `segmentStart: true` on the first usable point
of each later span. Discarded GPX fixes and empty/unusable TCX records also
start a new span at the next retained point. Distance, moving time, sensor weighting
and elevation changes never bridge these breaks. Wall-clock elapsed time
still includes recorded gaps; splits use recorded-span time, and best-km
efforts must fit inside one continuous span. Callers building an `Activity`
manually can set the same marker.

GPX/TCX elements and Garmin extensions are recognized by their namespace
URIs, allowing arbitrary prefixes and scoped namespace declarations. Foreign
elements with matching local names are ignored. Legacy unqualified exports
and the previously supported undeclared Garmin prefixes remain accepted.

## Indoor activities and data quality

FIT and TCX records without GPS retain their timestamps, HR, cadence, elevation
and device distance. `TrackPoint.lat` and `lon` are optional as a pair; check
both before mapping a point. Invalid supplied positions are counted, while
other valid readings survive. GPX trackpoints still require valid coordinates.

`stats.quality` reports `timingSource` (`recorded`, `interpolated`, `assumed`,
`unavailable`), missing data counts, `unknownDistanceIntervals`, parser discard
counts, and reasons for device-distance, elevation and timer fallbacks. CLI
text shows timing/movement sources and warning codes; JSON includes all counts.
A sensor-only workout has `distanceSource: 'unavailable'`, zero distance/pace
and no splits; HR and cadence still work. Do not interpret zero pace as a
measured pace when distance is unavailable. CLI text labels missing distance,
time and pace as `Unavailable`; numeric JSON fields keep their existing shape.
Measured stationary distance and moving time remain formatted zeroes. Pace is
unavailable without positive distance and a positive pace estimate. Its profile
charts use elapsed minutes, or sample indices when no timestamps exist.

A single valid HR reading still supplies `maxHeartRate`, shown independently
in CLI text. Duration-weighted average HR/cadence and zones remain unavailable
when no covered interval exists.

A missing GPS edge is never bridged. With partial GPS coverage, reported
distance only covers known edges and quality warns `incomplete-distance`;
best-km is suppressed. HR/cadence averages retain the recorded sensor timing.

```ts
const stats = analyze(activity, { splitDistanceM: 1609.344, pauseDetection: 'auto' })
console.log(stats.quality, stats.timerTimeSec, stats.movingTimeSource)
for (const split of stats.splits) {
  console.log(split.index, split.distanceM, split.isPartial)
}
```

Full mile splits can alternate between 1609 and 1610 integer metres because
cumulative boundaries are rounded. Their sum still equals `distanceM` exactly.
A sub-metre tail that rounds away stays in the last split, including its time.

## CLI

```bash
npx stride analyze my-run.gpx
npx stride analyze my-run.tcx            # TCX and FIT work too — auto-detected
npx stride analyze my-run.fit
npx stride analyze my-run.fit --imperial
```

Use `--split-distance 500` for 500 m splits or `--split-distance 1609.344`
for mile splits. `--speed-pauses` selects threshold-based pause detection.

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

  Timing source: recorded
  Moving source: speed
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
const a5 = parse('./run.gpx', { format: 'gpx' }) // hint applies to file contents
```

| Input | Detected as |
|---|---|
| XML document with a `gpx` root (including namespace prefixes) | GPX |
| XML document with a `TrainingCenterDatabase` root | TCX |
| File path to a `.FIT` file, or `Uint8Array` / `ArrayBuffer` bytes | FIT |

A short string that is neither a readable path nor recognisable GPX/TCX/FIT
throws a clear error (with a truncated preview of the input), not a bare
`ENOENT`.

A format hint selects how the content is decoded; it does not turn a file
path into XML. A string beginning with XML markup is treated as content;
other strings are file paths. For XML bytes, pass `{ format: 'gpx' }` or
`{ format: 'tcx' }`; unhinted byte input remains FIT-only. FIT input is a
file path or bytes, not a binary-encoded string. `parseFile()` is the
unambiguous option for reading paths, including paths beginning with `<`.

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

Computes metrics from shared cumulative distance and time series. The 1.x positional form
`analyze(activity, maxHR, elevationThresholdM)` still works but is
deprecated; use the options object for new integrations.

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
| `splitDistanceM` | `number` | `1000` | Split length in metres, at least 1. Use `500` or `1609.344` for half-kilometre or mile splits. At most 100,000 splits are allocated. Display units do not change boundaries. |
| `pauseDetection` | `'auto' \| 'speed'` | `'auto'` | Prefer coherent FIT timer intervals, or explicitly retain speed-threshold timing. Timer duration remains separately available with either choice. |
| `pauseThresholdMps` | `number` | `0.3` | Speed (m/s) at or below which a segment counts as paused rather than moving. Used when speed detection is selected or timer events are unusable. Raising it treats slow shuffling and GPS drift at rest as pauses. Affects `movingTimeSec`, and through it `avgPaceSecPerKm` (= moving time ÷ distance). |

Both thresholds must be finite and nonnegative. Zone boundaries must contain
exactly four finite, strictly increasing numbers between 0 and 1.

When timestamps are present, the first and last points of each continuous
span must have valid times.
Missing interior times are interpolated by distance between recorded times
(by sample position for an entirely stationary gap). Backward timestamps and
distance covered in zero time throw an error. Interpolated times feed pace,
splits and elapsed time; HR zones still omit segments whose original endpoint
times are missing. Average HR and cadence use those same ending-sample
durations, dividing only by time covered by that sensor; no covered time
returns `null`. Split HR apportions intervals that cross a kilometre boundary
between the affected splits. With no timestamps anywhere, the fallback is
one assumed second per recorded interval; pace and duration figures are estimates.

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

Elevation and heart-rate profiles use numeric `{ x, y }` points with a linear
distance axis and at most 200 readings across all datasets. Sampling keeps
the first/last reading and the minimum/maximum within consecutive buckets, so
brief peaks and valleys survive. Intermediate readings and very short spans
can still be omitted under the limit. Missing sensor readings split datasets
before sampling, as do route boundaries; retained points never reconnect
across either kind of gap. Isolated readings use visible markers. X positions
always come from the full route. Consumers customizing profiles should iterate over the datasets
and read `point.x` / `point.y` rather than `data.labels` and y-only arrays.

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
| `distanceSource` | `'device' \| 'computed' \| 'unavailable'` | Whether `distanceM` (and the series behind `splits[]` / `bestKmPaceSecPerKm`) came from the file's own device distance stream, or was summed from available GPS edges. `unavailable` means no distance-bearing edge. Check `quality` for incomplete coverage. |
| `deviceDistanceM` | `number \| undefined` | The device's own total distance (TCX `<Lap><DistanceMeters>`, FIT `session.totalDistance`), passed through **unrounded**. Undefined for GPX. May exceed `distanceM` — see [Why do these numbers disagree?](#why-do-these-numbers-disagree) |
| `elapsedTimeSec` | `number` | Total elapsed time in seconds |
| `movingTimeSec` | `number` | Active timer duration in auto mode when usable, otherwise threshold-based moving time. Zero with unavailable distance/timer; inspect the source. |
| `movingTimeSource` | `'timer' \| 'speed' \| 'unavailable'` | How moving time was established. Timer time can include standing. |
| `timerTimeSec` | `number \| null` | Coherent FIT timer duration intersected with continuous recorded spans. Null if absent or unusable. |
| `quality` | `DataQuality` | Timing assumptions, missing-position/time counts, unknown distance intervals, parser discard counts, fallback reasons and stable warning codes. |
| `splitDistanceM` | `number` | Configured split length, independent of display units. |
| `avgPaceSecPerKm` | `number` | Average pace in sec/km (moving time ÷ distance) |
| `bestKmPaceSecPerKm` | `number \| null` | Fastest 1000 m anywhere in the activity, as a rolling window with interpolated edges — independent of `splits[]`. Null without a continuous 1 km span or with unknown-distance intervals |
| `elevationGainM` | `number` | Total elevation gain in metres |
| `elevationLossM` | `number` | Total elevation loss in metres |
| `elevationSource` | `'device' \| 'computed' \| 'mixed'` | Combined provenance for gain and loss. `mixed` means they used different sources; inspect the per-total fields below. |
| `elevationGainSource` | `'device' \| 'computed'` | Source of gain. A missing, invalid or contradictory-zero device ascent falls back to hysteresis independently of descent. Device-sourced gain need not equal the sum of split gains. |
| `elevationLossSource` | `'device' \| 'computed'` | Source of loss. A missing, invalid or contradictory-zero device descent falls back independently; missing descent is never fabricated as zero merely because ascent came from the device. |
| `avgHeartRate` | `number \| null` | Duration-weighted ending-sample HR in bpm; null without HR-covered time |
| `maxHeartRate` | `number \| null` | Maximum recorded HR in bpm, including a single sample; null only with no HR readings |
| `hrZones` | `HeartRateZones \| null` | Time in each HR zone, in seconds, time-weighted (not sample-counted) |
| `avgCadence` | `number \| null` | Duration-weighted cadence in steps/min; null without cadence-covered time |
| `splits` | `Split[]` | Splits at configured boundaries (default 1000 m). Use `isPartial`, `index` and `targetDistanceM`; `km` is a legacy ordinal alias. `sum(splits[].distanceM) === distanceM` |

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
  const isFit = bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54
  const activity = parse(isFit ? bytes : new TextDecoder().decode(bytes))
  const stats = analyze(activity)   // distance, pace, HR zones, splits

  new Chart(canvas, paceChartConfig(activity, stats))
  return stats
}
```

(For GPX/TCX you can equally pass the file's text: `parse(await file.text())`.)

## Examples

For the full development and release checks, see
[`docs/development.md`](./docs/development.md).

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
