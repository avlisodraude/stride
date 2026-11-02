# Real-export validation

## Reproduce

```sh
npm run build
npm run fixtures:exports
npm run test:real
npm run test:real:all  # also requires a locally supplied genuine FIT export
```

The downloader uses `test/public-exports.json`, pinned to upstream commit
`fafe078e5e9c9183784e1f27ff53e288bd0cc7e9`, and verifies SHA-256 for both
exports and their MIT license. Existing differing files are never overwritten.
Files are stored in the ignored real-fixture directory, outside npm packs.
CI downloads and validates the public GPX/TCX samples on Node 22; private FIT
files are never uploaded or required in CI.

## Provenance

Source: [aaron-schroeder/activereader](https://github.com/aaron-schroeder/activereader/tree/fafe078e5e9c9183784e1f27ff53e288bd0cc7e9).
Its README identifies Garmin Connect as the export source and uses
`tests/testdata.tcx` in its example. The GPX identifies Garmin Connect as creator;
the TCX identifies Garmin Forerunner 220 and Connect Api. These are upstream
Garmin-export samples, downloaded unchanged, not XML generated from our FIT
fixture. Preserve the downloaded MIT copyright/license notice. Their exact
extent and any upstream trimming are not independently attested; this is
coverage of these published samples, not certification of all Garmin devices
or vendor-reported metric equivalence.

## Verified locally on 2026-11-02

| Format | Sample origin | Retained points | Continuous spans | Distance source | Result |
|---|---|---:|---:|---|---|
| GPX | Pinned public Garmin-export sample | 46 | 1 | Computed | Pass |
| TCX | Pinned public Garmin-export sample | 49 | 4 | Device | Pass |
| FIT | Existing private genuine export | Private | Private | Checked by invariants | Pass |

The all-format suite passes three samples. Public samples retain recorded
sensor/timing streams without dropped records. Checks cover byte identity,
point/span counts, coordinate/sensor validity, finite/nonnegative metrics,
source labels, movement versus elapsed time and exact split-distance sums.
The suite does not assert undocumented Garmin/Strava numerical agreement.
Additional user exports, vendors and activity types remain useful coverage.
