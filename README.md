# @alosha/stride

Parse GPX, TCX and FIT files, compute running metrics, and render Chart.js dashboards — zero config.

[![npm version](https://img.shields.io/npm/v/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![npm downloads](https://img.shields.io/npm/dm/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![Types included](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **GPX, TCX & FIT in, insights out** — parses GPX and TCX XML (file path or raw string) plus binary FIT files from Garmin, Strava, Coros, Wahoo and more. Format is auto-detected; the same `analyze()` and charts work for all three.
- **Every running metric you want** — pace, splits, HR zones (Z1–Z5), elevation, cadence, moving vs. elapsed time.
- **Charts with zero boilerplate** — 5 ready-made Chart.js configs (pace, elevation, heart rate, HR zones, splits).
- **CLI and library** — `npx stride analyze run.gpx`, metric or imperial, no config required.

## Supported formats

Most running libraries handle GPX only. Stride reads the three formats your
devices and platforms actually export, and normalises them into one shape — so
`analyze()` and every chart config work identically regardless of source.

| Format | Extension | Input types | Typical sources |
|---|---|---|---|
| **GPX** | `.gpx` | file path, raw XML string | Strava, Apple Health/Watch routes, Komoot, most apps |
| **TCX** | `.tcx` | file path, raw XML string | Garmin Connect, Strava, Wahoo, Zwift |
| **FIT** | `.fit` | file path, `Uint8Array`, `ArrayBuffer` | Garmin, Coros, Wahoo, Suunto, Polar (native device files) |

The format is **auto-detected** — you call `parse()` and never branch on file
type. All three surface the same fields where the source provides them: GPS
track, elevation, heart rate, cadence and timestamps.

## Install

```bash
npm install @alosha/stride
```

## Quick start

```ts
import { parse, analyze, paceChartConfig, splitsChartConfig } from '@alosha/stride'
import { Chart } from 'chart.js/auto'

// Parse a GPX, TCX or FIT file — the format is detected automatically
const activity = parse('./my-run.gpx')   // or './my-run.tcx', './my-run.fit'

// Compute all running metrics
const stats = analyze(activity)
console.log(stats.distanceM, stats.avgPaceSecPerKm, stats.hrZones)

// Render a pace chart (Chart.js)
new Chart(document.getElementById('pace'), paceChartConfig(activity, stats))
new Chart(document.getElementById('splits'), splitsChartConfig(stats))
```

## CLI

```bash
npx stride analyze my-run.gpx
npx stride analyze my-run.tcx            # TCX and FIT work too — auto-detected
npx stride analyze my-run.fit
npx stride analyze my-run.fit --imperial
```

Output:
```
🏃 @alosha/stride — Morning Run

  Distance:      10.24 km
  Moving time:   51:32
  Elapsed time:  52:14
  Avg pace:      5:02/km
  Best km pace:  4:44/km
  Elevation ↑:   142m
  Elevation ↓:   138m
  Avg HR:        158 bpm
  Max HR:        178 bpm

  Splits:
    km  1  4:55/km  ↑12m  HR 152bpm
    km  2  5:03/km  ↑8m   HR 156bpm
    ...
```

## Production recipes

Real things you'd build with run data — copy, paste, ship.

### Turn a Garmin .FIT upload into a pace chart in the browser

**The problem:** users export runs from Garmin, Strava, Coros and Wahoo in different formats — and FIT is binary, not text.

```ts
import { parse, analyze, paceChartConfig } from '@alosha/stride'
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

**Why it works:** `parse()` auto-detects the format and returns one normalised `Activity`, so the same `analyze()` and chart configs work no matter which watch produced the file — no per-vendor branching in your upload handler.

### Build a heart-rate zone breakdown without writing the maths

**The problem:** time-in-zone is a core training metric, but computing Z1–Z5 from a raw HR stream by hand is fiddly and error-prone.

```ts
import { parse, analyze, hrZonesChartConfig } from '@alosha/stride'
import { Chart } from 'chart.js/auto'

const activity = parse('./tempo-run.tcx')
const stats = analyze(activity, 188)   // pass the athlete's max HR

// Seconds spent in each zone, ready for a doughnut chart.
console.log(stats.hrZones)             // { z1, z2, z3, z4, z5 } | null
new Chart(canvas, hrZonesChartConfig(stats))
```

**Why it works:** `analyze()` computes Z1–Z5 time-in-zone from the HR stream against the max HR you pass and returns a ready Chart.js config — you get a training-quality breakdown without ever touching the zone formula.

## API

### `parse(input: string | Uint8Array | ArrayBuffer): Activity`

Parse an activity file into a normalised `Activity` object. The format is
auto-detected, so the returned shape is identical for GPX, TCX and FIT.

```ts
// GPX / TCX — file path or raw XML string
const activity = parse('./run.gpx')
const activity = parse('./run.tcx')
const activity = parse(xmlString)

// FIT — file path (Node) or raw bytes (browser / streamed)
const activity = parse('./run.fit')
const activity = parse(new Uint8Array(arrayBuffer))
```

| Input | Detected as |
|---|---|
| String/contents containing `<gpx` | GPX |
| String/contents containing `<TrainingCenterDatabase` | TCX |
| File path to a `.FIT` file, or `Uint8Array` / `ArrayBuffer` bytes | FIT |

In the browser, file paths aren't available — read the file with a
`FileReader` and pass the result to `parse()` (a string for GPX/TCX via
`readAsText`, or a `Uint8Array` for FIT via `readAsArrayBuffer`).

#### Per-format details

Every format produces the same `Activity` object, but each has a few quirks
worth knowing:

**GPX** (`.gpx`) — reads `<trkpt>` lat/lon, `<ele>`, `<time>`, and the Garmin
`TrackPointExtension` for heart rate and cadence (`gpxtpx:`/`ns3:` namespaces).
Cadence is doubled from per-foot RPM to steps/min.

**TCX** (`.tcx`) — Garmin Training Center XML. All `Activity → Lap → Track →
Trackpoint` elements are flattened into one continuous point stream, so
multi-lap files just work. Reads `Position` (LatitudeDegrees/LongitudeDegrees),
`AltitudeMeters`, `HeartRateBpm`, and the activity-extension `RunCadence`
(namespaced or bare), doubled to steps/min. The `Sport` attribute becomes
`activity.type`. Trackpoints without a `Position` (indoor/paused) are skipped.

**FIT** (`.fit`) — binary device files, decoded with
[`@garmin/fitsdk`](https://www.npmjs.com/package/@garmin/fitsdk). Positions are
converted from semicircles to degrees (`× 180 / 2³¹`), the higher-resolution
`enhancedAltitude` is preferred over `altitude` when present, and cadence
(plus `fractionalCadence`) is normalised to steps/min. Sport and start time come
from the session/sport messages. Records without GPS are skipped. Pass FIT as a
file path (Node) or as `Uint8Array`/`ArrayBuffer` bytes (browser).

### `analyze(activity: Activity, maxHR?: number): ActivityStats`

Compute all metrics from an activity. `maxHR` defaults to 190 and is used for heart rate zone calculation.

```ts
const stats = analyze(activity)
// stats.distanceM, stats.avgPaceSecPerKm, stats.splits, stats.hrZones, ...
```

### Chart configs

All chart functions return a plain [Chart.js configuration object](https://www.chartjs.org/docs/latest/configuration/) — you instantiate `Chart` yourself.

| Function | Chart type | Data needed |
|---|---|---|
| `paceChartConfig(activity, stats, opts?)` | Line | Always |
| `elevationChartConfig(activity, stats, opts?)` | Line | Elevation in GPX |
| `heartRateChartConfig(activity, stats)` | Line | HR in GPX |
| `hrZonesChartConfig(stats)` | Doughnut | HR in GPX |
| `splitsChartConfig(stats, opts?)` | Bar | Always |

```ts
import { Chart } from 'chart.js/auto'
import { paceChartConfig, elevationChartConfig, hrZonesChartConfig } from '@alosha/stride'

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
| `distanceSource` | `'device' \| 'computed'` | Whether `distanceM` came from the file's own device distance stream, or was summed from GPS points |
| `deviceDistanceM` | `number \| undefined` | The device's own total distance for the activity (TCX `<Lap><DistanceMeters>`, FIT `session.totalDistance`). Undefined for GPX. May be larger than `distanceM` — the difference is distance the device accumulated before its first usable position fix, or during segments with no position data; the two numbers answer different questions and aren't required to agree |
| `elapsedTimeSec` | `number` | Total elapsed time in seconds |
| `movingTimeSec` | `number` | Moving time (pauses excluded) |
| `avgPaceSecPerKm` | `number` | Average pace in sec/km |
| `bestKmPaceSecPerKm` | `number \| null` | Fastest 1km split |
| `elevationGainM` | `number` | Total elevation gain in metres |
| `elevationLossM` | `number` | Total elevation loss in metres |
| `avgHeartRate` | `number \| null` | Average HR in bpm |
| `maxHeartRate` | `number \| null` | Max HR in bpm |
| `hrZones` | `HeartRateZones \| null` | Time in each HR zone (seconds) |
| `avgCadence` | `number \| null` | Average cadence in steps/min |
| `splits` | `Split[]` | Per-km splits |

## Support & custom work

`@alosha/stride` is free and MIT-licensed, and always will be. When you need more than the open-source library, there's a paid path backed by the maintainer — not a ticket queue:

- **Priority support** — a direct line to the person who wrote it, with prioritised fixes.
- **Custom work** — bespoke chart types or running metrics, and help integrating Stride into your app or platform.

Get in touch at [alosha.dev/support](https://alosha.dev/support).

---

Docs & live demo: [stride.alosha.dev](https://stride.alosha.dev) · Built by [Alosha](https://alosha.dev)
