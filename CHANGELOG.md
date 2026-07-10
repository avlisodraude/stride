# Changelog

All notable changes to `@alosha/stride` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## 2.0.0

1.0.0 fixed the arithmetic; this release fixes the inputs. Where a device
already measured distance and climb with better instruments than raw GPS,
the analyzer was still re-deriving both from the GPS stream and integrating
its jitter — so the numbers it published disagreed with what the runner's
own watch, Garmin Connect and Strava all showed. 2.0.0 defers to the device
where the device is right, says which source produced every figure, and
stops shipping Chart.js to consumers who never draw a chart.

The BREAKING entries below are ordered by how likely each is to bite
*silently* — the ones your compiler and bundler will never warn you about
come first.

### BREAKING

- **`distanceM` now comes from the device when the file provides it — and it
  is shorter, silently.** FIT (`record.distance`/`enhancedDistance`) and TCX
  (`<DistanceMeters>`) files carry a device-filtered cumulative distance
  stream; `analyze()` now uses it whenever it is usable across the whole
  track (present on every point, non-decreasing, not all-zero). The old
  behaviour — summing haversine distances between raw GPS fixes — was
  integrating ±3–5 m of per-fix jitter as extra path length. On the sample
  fixtures the shift is small (1983 → **1980**, calibrated tracks); on real
  files with real jitter the gap is larger, typically **1–3%**. Because
  `distanceM` is the denominator of `avgPaceSecPerKm`, every `splits[]`
  entry and `bestKmPaceSecPerKm`, all of those move with it. **Your runs did
  not get shorter; the old numbers were wrong.** GPX has no standard
  distance element and is unchanged (always `'computed'`). Check
  `stats.distanceSource` to see which path ran.
- **Elevation changed twice, in opposite directions.** Read both together —
  a user watching their gain fall on one file and rise on another will
  otherwise conclude the library is guessing:
  - **The default hysteresis threshold went 3 m → 8 m, which lowers gain.**
    The 3 m default sat at the top of the *barometric* noise band, but every
    altitude stream this library filters is GPS-derived (GPX always; FIT and
    TCX whenever no device total is present), and GPS altitude noise is
    larger — authoritative sources recommend 6–10 m there (Strava ~10 m for
    non-barometric activities, GPS Visualizer 6–9 m). `sample-run.tcx`
    reports **12 → 0**: a realistically flat GPS track whose "climb" was
    noise all along. If you know your data is barometric, pass
    `elevationThresholdM: 2` to keep a barometric-grade threshold.
  - **FIT files carrying `session.totalAscent`/`totalDescent` now defer to
    the device, which can *raise* gain.** The device total is barometric or
    sensor-fused, filtered on-device, and is the figure Garmin Connect and
    Strava agree with. A barometric altimeter catches rollers that GPS
    altitude flattens into noise, so the device figure can exceed anything
    the hysteresis pass finds: `climb-run.fit` reports **78** where the GPS
    stream computes **58**. `stats.elevationSource` reads `'device'` when
    this path ran; in that case `sum(splits[].elevationGainM)` no longer
    equals `elevationGainM`, because the device reports one activity-level
    scalar that cannot be attributed to distance ranges — splits keep using
    the hysteresis pass. A zero-guard keeps a bogus `totalAscent: 0` from
    hiding a real climb (falls back to `'computed'`); a 0 on a genuinely
    flat track is honoured.
- **Chart builders moved to `@alosha/stride/charts`; `chart.js` is now an
  optional peer dependency.** This one is loud and immediate — your bundler
  catches it. The payoff: installing `@alosha/stride` alone drops from
  **11 MB to 3.8 MB**, because parse/analyze consumers no longer pull in
  Chart.js at all.

  ```ts
  // 1.x
  import { parse, analyze, paceChartConfig } from '@alosha/stride'
  // 2.0
  import { parse, analyze } from '@alosha/stride'
  import { paceChartConfig } from '@alosha/stride/charts'
  ```

  If you use the chart builders, `npm install chart.js` — they still return
  plain config objects and never call Chart.js, but you need it to render
  them and (in TypeScript) to resolve the `ChartConfiguration` type.
  `paceChartConfig`, `elevationChartConfig`, `heartRateChartConfig`,
  `hrZonesChartConfig` and `splitsChartConfig` are no longer exported from
  the package root.
- **`engines` now requires Node >= 18.** `@garmin/fitsdk` ships syntax that
  fails to load on Node 14, and Node < 18 is EOL and was never tested.
- **`analyze()` takes an options object:** `analyze(activity, { maxHR: 185,
  elevationThresholdM: 2 })`. The positional form
  `analyze(activity, maxHR, elevationThresholdM)` still works, is marked
  `@deprecated`, and will be removed in 3.0.0.
- **`ChartOptions` loses its `charts` and `maxHR` fields.** Neither was ever
  read by any chart builder — they were documented options with no behavior
  behind them, so passing `{ maxHR: 185 }` to a builder was a silent no-op
  (HR zones are configured on `analyze()`, whose output the builders
  consume). TypeScript consumers passing them get a compile error pointing
  at code that was already doing nothing; `units` is unchanged.

### Added

- **`parseFile(path, options?)`** — async, `fs/promises`-backed file reading
  (Node only). No path-vs-content sniffing: the argument is unambiguously a
  path.
- **`parse(input, { format: 'gpx' | 'tcx' | 'fit' })`** — skip format
  sniffing when you already know the format.
- **`ActivityStats.distanceSource` / `ActivityStats.elevationSource`**
  (`'device' | 'computed'`) — which path produced the distance and elevation
  figures. `elevationSource` is the signal to check before assuming
  per-split gains sum to `elevationGainM`.
- **`ActivityStats.deviceDistanceM` / `Activity.deviceDistanceM`** — the
  device's own total distance (TCX `<Lap><DistanceMeters>` summed across
  laps, FIT `session.totalDistance` summed across sessions), passed through
  unrounded and not consumed by any computed metric. It can legitimately
  exceed `distanceM`: the device counts distance accumulated before its
  first position fix; `distanceM` measures between the first and last
  recorded point. `distanceM: 1980` next to `deviceDistanceM: 1983.3` is
  expected, not a bug. Undefined for GPX, and whenever the reported total is
  0 or smaller than `distanceM`.
- **`AnalyzeOptions.zoneModel`** — configurable HR zone model:
  `{ type: 'hrmax' }` (default, the historical %HRmax bands) or
  `{ type: 'reserve', restingHR }` (Karvonen, % of heart-rate reserve), each
  with optional custom `boundaries`. Invalid boundaries (not strictly
  increasing, or outside (0, 1)) throw a clear error instead of silently
  mis-bucketing zones.
- **`AnalyzeOptions.pauseThresholdMps`** — the speed below which a segment
  counts as paused rather than moving (default 0.3, the previously hardcoded
  value).
- **Validation of `maxHR` and `restingHR`.** Previously `maxHR: 0`, a
  negative `maxHR`, `NaN`, or (for `zoneModel: { type: 'reserve' }`) an
  omitted, negative, or out-of-order `restingHR` all divided-by-zero or
  inverted the zone-percentage formula silently, dumping every sample into
  `z1` or `z5` — a confident, wrong answer, not a crash. Both are now
  validated the same way `zoneModel.boundaries` already was: `maxHR` must be
  finite and within a plausible physiological range (60–220 bpm); for the
  `'reserve'` model, `restingHR` must be finite, non-negative, and less than
  `maxHR`. Anything else throws a clear error naming the field and the
  offending value. Heart rate *samples* found in a file are never validated
  or clamped — a corrupt 300 bpm point is a data-quality issue, not a caller
  error, and is left as-is.
- **CLI flags: `--json`, `--max-hr`, `--elevation-threshold`.** `--json`
  prints the raw `ActivityStats` object (the same documented schema
  `analyze()` returns) for jq/scripting; the other two expose the
  corresponding `analyze()` options, which were previously reachable only
  from the library. Unknown `--flags` and non-numeric values now error
  clearly instead of being silently ignored.
- **CI test workflow** — lint + tests run on every push and pull request,
  across Node 18, 20 and 22, so the `engines` claim is verified rather than
  asserted.
- **Real-fixture invariant harness** — any real watch export dropped into
  `test/fixtures/real/` is automatically checked against the invariants that
  must hold for any valid activity (no NaN, split sums, source labels,
  `deviceDistanceM >= distanceM`). See `test/fixtures/real/README.md`.
- **Browser export condition** — bundlers resolve a browser-safe entry
  (`dist/index.browser.js`, with its own type declarations) that never
  references `fs`. `parseFile` is absent from the browser build.
- **`./package.json` export** — tooling can read the manifest through the
  sealed exports map.

### Fixed

- `hrZonesChartConfig` no longer throws when an activity has no heart rate
  data — it returns a clearly-labelled all-zero doughnut, so a dashboard
  renders a placeholder instead of crashing.
- The trailing partial split is labelled honestly in the pace and splits
  charts (`km 2 (0.98 km)`, with a faded bar) instead of being presented as
  a full kilometre.
- `elevationChartConfig` no longer computes its x-axis with a flat-earth
  approximation that overstated longitude by 63% at 52°N — its axis read
  3.2 km for a 1.98 km run. It now shares the exact distance series
  `analyze()` uses, so the chart can never disagree with `stats.distanceM`.
- `parse()` gives a real error (with a truncated input preview) when a short
  invalid string is mistaken for a file path, instead of a confusing
  `ENOENT`.
- The CLI labels the trailing partial split the same way the charts do
  (`km 2  5:03/km  (0.98 km)`) instead of presenting it as a full kilometre,
  and `--imperial` now converts elevation to feet — previously pace and
  distance converted but elevation stayed in metres.
- Malformed GPX/TCX values (a non-numeric `<ele>`/`<hr>`/`<cad>`/
  `<AltitudeMeters>`/`<RunCadence>`, an empty `<HeartRateBpm/>`, an
  unparseable timestamp) are dropped at the parser boundary instead of
  becoming `NaN` (or a fabricated 0 bpm) that passed every null-check and
  silently corrupted `avgHeartRate`, `maxHeartRate` and `hrZones`.
- `formatDuration` carries fractional seconds into minutes: `59.6` formats
  as `1:00`, not `0:60`.
- `heartRateChartConfig` plots heart rate against distance (the same series
  as `stats.distanceM`) instead of sample index. Smart-recording watches
  sample hard efforts densely and steady running sparsely, so the old index
  axis stretched hard sections and compressed easy ones — distorting exactly
  the feature the chart exists to show. It also accepts `opts.units` now,
  like the other builders.

### Which numbers move

Measured on the shipped fixtures; the direction is what to expect on real
files, the magnitude there is usually larger.

| Metric (fixture) | 1.x | 2.0 | Direction |
| --- | --- | --- | --- |
| `distanceM` (`sample-run.fit` / `.tcx`) | 1983 | **1980** | Down — device distance replaces jitter-inflated haversine; 1–3% on real files |
| `avgPaceSecPerKm` (`sample-run.fit` / `.tcx`) | 303 | 303 | Moves with `distanceM` (unchanged on these calibrated fixtures) |
| `bestKmPaceSecPerKm` (`sample-run.fit` / `.tcx`) | 303 | 303 | Moves with `distanceM` (unchanged on these calibrated fixtures) |
| `elevationGainM` (`sample-run.tcx`, GPS altitude) | 12 | **0** | Down — threshold 3 m → 8 m stops counting GPS noise as climb |
| `elevationGainM` (`climb-run.fit`, device total) | 58 (GPS stream) | **78** | Up — the device's barometric total supersedes the GPS-derived figure |
| `deviceDistanceM` (`sample-run.fit` / `.tcx`) | — | 1983.3 | New field, reported verbatim and unrounded |

## 1.0.0

Five metrics in `analyze()` returned numbers that were plausible on sight
and wrong on inspection. None of them threw, none was obviously broken in
a single-file smoke test, and every one had already shipped to users
(through `0.2.2`). This release corrects all five; see
`docs/metrics-spec.md` for the full derivation of each fix and its worked
examples.

### BREAKING

- **`hrZones.z1`–`z5` change meaning from a sample count to real seconds,
  silently.** The `HeartRateZones` shape doesn't change — five numbers —
  but those numbers stop meaning "how many points fell in this zone" and
  start meaning "how many seconds were spent in this zone." A consumer
  that summed zones, drew a pie chart, or thresholded "minutes in z5"
  keeps compiling and silently produces different numbers. TypeScript
  cannot catch this; this version bump is the only signal. Densely-sampled
  (hard-effort) zones shrink relative to their old share; sparsely-sampled
  (easy) zones grow — smart-recording watches sample harder efforts more
  often, which the old count-based method mistook for "more time." If your
  z5 time drops sharply after upgrading, that's the correction, not a
  regression.
- `Split` gains a required `distanceM` field. Anyone constructing `Split`
  objects directly (rather than only reading them from `analyze()`) needs
  to add it.

### Changed

- `bestKmPaceSecPerKm` is now a rolling 1000m window over the activity's
  cumulative distance/time series, not the fastest whole-kilometre bucket.
  Faster or equal, never slower — a runner's actual best kilometre almost
  never starts on a split boundary. Computed independently of `splits[]`.
- `splits[]` now includes a trailing partial split for any remainder under
  1000m, instead of silently dropping it — `sum(splits[i].distanceM) ===
  distanceM` always holds now. Split boundaries are also exact 1000m marks
  (previously the overshoot past each mark was discarded, so splits drifted
  and were computed over the wrong distance, e.g. 1043m instead of 1000m).
- `elevationGainM` / `elevationLossM` now use a hysteresis filter instead of
  summing raw altitude deltas, which integrated GPS/barometric noise as
  climb. Both drop, often by 10-40%, more on flat or GPS-only tracks where
  the raw signal is mostly noise. The threshold defaults to 3m and is
  exposed as a parameter (`analyze(activity, maxHR, elevationThresholdM)`).

### Notes

- The magnitude of the `hrZones` change depends on recording density: near
  zero for steady 1Hz recording, large for "smart recording" files where
  sample spacing varies with effort.
- The `elevationGainM`/`elevationLossM` and `bestKmPaceSecPerKm` fields keep
  their exact types — only the numbers they report change, generally
  smaller (elevation) or faster (best-km) than before.

## 0.2.0

### Added

- **TCX support** — parse Garmin Training Center XML (`.tcx`) files. Laps are
  flattened into a single point stream, with lat/lon, altitude, heart rate and
  `RunCadence` mapped onto the shared `Activity` model. No new dependency
  (reuses the existing XML parser).
- **FIT support** — parse binary `.fit` files from Garmin, Coros, Wahoo, Suunto
  and others via `@garmin/fitsdk`. Positions are converted from semicircles to
  degrees, `enhancedAltitude` is preferred when present, and cadence is
  normalised to steps/min.
- `parse()` now accepts `string | Uint8Array | ArrayBuffer` and auto-detects the
  format (GPX / TCX / FIT), so the same `analyze()` and chart configs work for
  every input.

### Changed

- `Activity.format` is now `'gpx' | 'fit' | 'tcx'` (previously `'gpx'`).

### Notes

- This release is backward compatible: existing GPX file-path and raw-XML usage
  is unchanged.
- TCX/FIT running cadence is doubled from per-foot RPM to steps/min to match the
  GPX behaviour.

## 0.1.4

- Fix imperial pace formatting (e.g. `8:00/mi` instead of `7:60/mi`).
