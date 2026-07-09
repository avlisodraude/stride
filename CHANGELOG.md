# Changelog

All notable changes to `@alosha/stride` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## Unreleased

### BREAKING

- **`distanceM` now prefers the device's own distance stream over summed
  haversine.** When a FIT (`record.distance`/`enhancedDistance`) or TCX
  (`<DistanceMeters>`) file carries a usable cumulative-distance stream —
  present on every point, non-decreasing, not all-zero — `analyze()` reports
  that instead of integrating haversine distances between raw GPS points.
  Summing per-fix segments accumulated ±3–5 m of GPS jitter as extra path
  length (typically +1–3%); this is the same class of defect as the 1.0.0
  elevation-gain fix. Because `distanceM` is the denominator of
  `avgPaceSecPerKm`, every `splits[]` entry and `bestKmPaceSecPerKm`, those
  numbers can all shift slightly. GPX has no standard distance element and is
  unchanged (always `'computed'`).

### Added

- **`ActivityStats.distanceSource: 'device' | 'computed'`** — reports which
  path produced the distance, splits and best-km series so a consumer can
  tell device-reported distance from the haversine fallback. Additive.
- **`TrackPoint.distanceM?: number`** — device-reported *cumulative* distance
  from the activity start (metres), populated by the FIT and TCX parsers.

### Notes

- The device stream is used only when trustworthy for the *whole* track. A
  field that is missing on any point, goes backwards, or is uniformly zero is
  treated as absent and the whole activity falls back to haversine — the two
  are never mixed per segment, which would put a discontinuity in the
  cumulative series.
- The elevation chart's x-axis follows `distanceSource`, so its final
  distance label continues to match `stats.distanceM`.
- Sample-fixture movement, device vs. the previous haversine sum:

  | fixture          | distanceM     | avgPaceSecPerKm | bestKmPaceSecPerKm | splits |
  | ---------------- | ------------- | --------------- | ------------------ | ------ |
  | `sample-run.fit` | 1983 → **1980** | 303 (unchanged) | 303 (unchanged)    | 2 (unchanged) |
  | `sample-run.tcx` | 1983 → **1980** | 303 (unchanged) | 303 (unchanged)    | 2 (unchanged) |

  Both sample fixtures were deliberately calibrated so the GPS path length
  nearly matches the device total, so the shift is small (−3 m, the leading
  distance before the first GPS fix); files with real GPS jitter move more.

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
