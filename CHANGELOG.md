# Changelog

All notable changes to `@alosha/stride` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

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
