# @alosha/stride

Parse GPX files, compute running metrics, and render Chart.js dashboards — zero config.

[![npm version](https://img.shields.io/npm/v/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![npm downloads](https://img.shields.io/npm/dm/@alosha/stride)](https://www.npmjs.com/package/@alosha/stride)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **GPX in, insights out** — parses a file path or raw XML, including Garmin heart-rate and cadence extensions.
- **Every running metric you want** — pace, splits, HR zones (Z1–Z5), elevation, cadence, moving vs. elapsed time.
- **Charts with zero boilerplate** — 5 ready-made Chart.js configs (pace, elevation, heart rate, HR zones, splits).
- **CLI and library** — `npx stride analyze run.gpx`, metric or imperial, no config required.

## Install

```bash
npm install @alosha/stride
```

## Quick start

```ts
import { parse, analyze, paceChartConfig, splitsChartConfig } from '@alosha/stride'
import { Chart } from 'chart.js/auto'

// Parse a GPX file
const activity = parse('./my-run.gpx')

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
npx stride analyze my-run.gpx --imperial
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

## API

### `parse(input: string): Activity`

Parse a GPX file path or raw XML string into an `Activity` object.

```ts
const activity = parse('./run.gpx')        // from file
const activity = parse(gpxXmlString)       // from string
```

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
| `distanceM` | `number` | Total distance in metres |
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

---

Want hosted activity history, training plans, and team dashboards? → [stride.alosha.dev](https://stride.alosha.dev)

Built by [Alosha](https://alosha.dev)
