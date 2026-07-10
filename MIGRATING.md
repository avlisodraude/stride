# Migrating from 1.x to 2.x

Five things changed. Two are loud (your bundler or Node will tell you); three
are silent (your code keeps running and returns different numbers). This guide
covers each: the code before, the code after, and — for the silent ones — how
to tell whether you were affected.

If you want the reasoning behind each change, see the
[2.0.0 CHANGELOG entry](./CHANGELOG.md) and `docs/metrics-spec.md`.

## 1. `distanceM` is now device-reported when the file provides it (silent)

FIT and TCX files carry a device-filtered cumulative distance stream. 2.x
uses it; 1.x summed haversine distances between raw GPS fixes, which
integrated ±3–5 m of per-fix jitter as extra path length.

**Nothing to change in code.** The numbers change on their own:

- `distanceM` shrinks — on the sample fixtures 1983 → 1980; on real files
  with real jitter, typically **1–3% shorter**.
- `avgPaceSecPerKm`, every `splits[]` entry, and `bestKmPaceSecPerKm` all
  divide by that distance, so they move with it.

Your runs did not get shorter; the old numbers were wrong.

**How to tell whether you were affected:**

```ts
const stats = analyze(activity)
if (stats.distanceSource === 'device') {
  // This file's distance changed relative to 1.x.
}
// 'computed' means the 1.x haversine path still ran (GPX always, and any
// FIT/TCX file without a usable distance stream) — unchanged from 1.x.
```

If you stored 1.x numbers (a database of past analyses, cached stats,
snapshot tests), expect FIT/TCX entries to disagree with re-analysis by up
to a few percent. GPX entries are untouched.

## 2. Elevation changed twice, in opposite directions (silent)

Two independent changes; a single file sees at most one of them.

**Threshold 3 m → 8 m (gain goes *down*).** The hysteresis filter that
denoises GPS altitude now defaults to an 8 m threshold, matching what
authoritative sources recommend for GPS-derived altitude (the old 3 m was a
barometric-grade figure). Flat and gently-rolling GPS tracks lose most or
all of their phantom climb — `sample-run.tcx` goes **12 → 0**.

**Device totals preferred (gain can go *up*).** FIT files carrying
`session.totalAscent`/`totalDescent` now report those directly — barometric
or sensor-fused, filtered on-device, the figure Garmin Connect and Strava
agree with. A barometric altimeter catches rollers GPS flattens into noise,
so this can *raise* gain: `climb-run.fit` reports **78** where the GPS
stream computes **58**.

**How to tell which applied to you:**

```ts
const stats = analyze(activity)
if (stats.elevationSource === 'device') {
  // Device total (FIT with session.totalAscent). Gain may be higher than 1.x.
  // Note: sum(splits[].elevationGainM) will NOT equal elevationGainM here —
  // the device total is an activity-level scalar and cannot be attributed to
  // distance ranges, so splits keep using the hysteresis pass. Deliberate.
} else {
  // Hysteresis filter (GPX and TCX always; FIT without a device total).
  // Gain is lower than or equal to 1.x because of the 3 m → 8 m threshold.
}
```

**If your data is barometric** (e.g. GPX exported from a barometric watch,
where no device total survives the export), restore a barometric-grade
threshold:

```ts
const stats = analyze(activity, { elevationThresholdM: 2 })
```

## 3. Chart builders moved to `@alosha/stride/charts` (loud)

`paceChartConfig`, `elevationChartConfig`, `heartRateChartConfig`,
`hrZonesChartConfig` and `splitsChartConfig` are no longer exported from the
package root, and `chart.js` moved from a dependency to an *optional* peer
dependency. Installing `@alosha/stride` alone drops from 11 MB to 3.8 MB.

```ts
// 1.x
import { parse, analyze, paceChartConfig } from '@alosha/stride'

// 2.x
import { parse, analyze } from '@alosha/stride'
import { paceChartConfig } from '@alosha/stride/charts'
```

If you use the chart builders, install the peer yourself:

```bash
npm install chart.js
```

The builders still return plain config objects and never call Chart.js — you
need it to render a config and, in TypeScript, to resolve the
`ChartConfiguration` type in their signatures.

## 4. Node >= 18 required (loud)

`package.json` now declares `"engines": { "node": ">=18.0.0" }`. Node 14/16
are EOL; `@garmin/fitsdk` ships syntax Node 14 cannot parse, so 1.x never
actually worked there either — 2.x just says so.

## 5. `analyze()` takes an options object (deprecated, not yet removed)

```ts
// 1.x (still works in 2.x, @deprecated, removed in 3.0.0)
const stats = analyze(activity, 185, 2)

// 2.x
const stats = analyze(activity, { maxHR: 185, elevationThresholdM: 2 })
```

The options object also unlocks the new knobs — `zoneModel` (`'hrmax'` or
Karvonen `'reserve'`) and `pauseThresholdMps` — which have no positional
equivalent. See the README's `AnalyzeOptions` reference.

## Nothing to do if…

- **…you consume GPX only and never drew a chart.** One change reaches you:
  elevation. Gain and loss drop with the 3 m → 8 m threshold (GPX never has
  device totals, so nothing rises). Distance, pace, splits and best-km are
  byte-for-byte what 1.x reported. Pass `elevationThresholdM: 2` if your GPX
  came from a barometric device and you want the old-style sensitivity.
- **…you only format or display fields without storing them.** Nothing
  breaks; the displayed numbers just get more honest. Update imports only if
  you used chart builders.
- **…you already call `analyze(activity)` with no extra arguments and use no
  charts.** No code changes at all — only the numeric shifts above.
