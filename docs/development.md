# Development and verification

Use Node 22 for development. The library continues to target Node 18 and
newer; CI checks Node 18, 20, 22 and 24. Development tools can require a newer
patch release than the library runtime itself.

```sh
npm ci
npm run browser:install
npm run check
```

`check` runs lint, the build and unit/regression tests, isolated consumers of
the npm tarball, runnable examples, and actual browser chart rendering.
`test:package` expects a completed
build and installs the packed artifact into a temporary directory. It checks
ESM and CommonJS, an install without the optional Chart.js peer, the browser
export and browser bundle, the CLI, and TypeScript consumers. Its temporary
files are removed when it finishes. Dependency installation requires registry
access. That package check also runs JavaScript without Node globals.

`test:browser` uses Playwright with Chromium to render all five charts at
desktop and mobile viewport sizes in metric and imperial units. It verifies
canvas output, numeric distance spacing, separate profile spans, bucket extrema,
sensor dropouts, isolated markers, parser discontinuities and tooltip
callbacks, and saves synthetic-data screenshots under `test-results/browser/`.
CI runs it on Node 22, and the release gate includes it. This remains desktop
browser testing at different viewport sizes, not physical mobile-device testing.

The browser tools have their own manifest and lockfile under `test/browser/`
because current Playwright requires Node 20+, while library tests still run on
Node 18. Use `npm run browser:install -- --with-deps` on CI/Linux to install OS
dependencies too. To use installed Chrome instead of downloading Chromium,
set `STRIDE_BROWSER_CHANNEL=chrome` for both installation and test/check commands.

`npm run release` runs the same checks before publishing. Nothing publishes
as part of `check` or `test:package`.

Release preflight is read-only: `npm run release:preflight` checks that source
is committed, `package.json` contains a valid version, and `v<version>` points
at the current commit. It accepts lightweight or annotated tags. On tagged
GitHub runs, the triggering tag must also match. Ignored build/test outputs do
not block releases; tracked edits and untracked source do. The `release`
command checks before verification and again before publishing. `prepublishOnly`
also applies the guard to direct `npm publish` calls. No preflight command
creates a commit/tag, bumps a version, installs dependencies or publishes.

Synthetic FIT fixtures are reproducible with `sample:fit`, `sample:climb` and
`sample:multisession`. The last fixture exercises session-level aggregation
across two sports, not per-sport or transition analysis. Real watch exports
remain private and are tested separately with `test:real`.

## Further dependency upgrades

The dependency refresh retains existing major versions except Jest 30. Production
dependencies pass the audit; development dependencies still have low/moderate
findings. Audit results change, so check `npm audit` and `npm audit --omit=dev`
again when preparing a release.

1. Jest 30 is now installed; native ESM regression tests and packed-consumer
   checks remain the acceptance gates for future test-runner updates.
2. Decide the next major release's minimum runtime and development Node
   versions before upgrading ESLint, commitlint and tsup to their latest
   majors. Keep `engines`, build targets, CI and this document aligned.
3. Evaluate newer TypeScript majors alongside tsup's declaration generation
   and typescript-eslint support; retain the consumer compilation checks.
4. Prefer upstream dependency fixes. Avoid forcing incompatible major
   versions of transitive packages merely to obtain a clean audit report.

## XML validator maintenance decision (2026-11-02)

`saxes` is pinned to 6.0.0. Its [upstream is archived](https://github.com/lddubeau/saxes),
so this is an explicit compatibility decision, not a claim of active maintenance.
The validator must reject malformed structure, undeclared entities, invalid
XML characters/references and misplaced CDATA terminators, while supporting
Node 18, the browser bundle and legacy undeclared Garmin prefixes.

The evaluated maintained DOM implementation (`@xmldom/xmldom` 0.9.12) accepted
invalid XML character references and literal CDATA terminators unless extra
custom validation was added; strict error handling also rejected a valid BOM
in the existing regression fixture. Replacing a strict validator with that
combination would weaken the contract or move syntax maintenance into this
repository. The evaluated `@zklogic/saxes` 7.0.4 fork requires Node 20+, and
`@rubensworks/saxes` 6.0.1 has no published update since 2023.

Retain the pinned validator and run character/structure conformance tests in
the normal suite. Revisit this choice when the Node baseline changes, a
maintained compatible release becomes available, or a relevant advisory
requires a patch. A replacement must pass the same conformance, packed-package,
Node-version and real-browser checks before adoption.

## Generated inputs, performance and real exports

The normal suite includes 100 reproducible activity seeds with resets, pauses,
uneven sampling, sensor data and fractional split lengths, plus XML namespace
and rounding cases. Failures name their seed. `npm run test:performance` runs
10,000- and 100,000-point synthetic GPX parse/analyze checks in a separate
process, reports parse/analyze/profile-config timing and heap growth, and guards against gross regressions
(60 seconds / 1 GiB per dataset). These generous limits are regression alarms,
not published throughput guarantees. The command is included in `check` and
Node 22 CI.

`npm run test:real` exercises every available private FIT/GPX/TCX fixture and
reports format coverage without exposing filenames, times or coordinates.
`npm run test:real:all` requires all three formats before running the suite;
missing formats fail explicitly. Only genuine exports belong in that folder;
converted/synthetic files cannot establish real-export coverage. Current local
coverage is one genuine FIT export; genuine GPX and TCX validation is pending.
Do not describe the release candidate as fully verified across formats until
that separate gate passes. Private exports stay ignored and outside npm packs.

Version 3.0.0 is the major release for the optional coordinates, source variants,
quality fields and configurable splits. See `MIGRATING.md`. Release preflight
requires a clean committed checkout and matching v3.0.0 tag. GitHub CI verifies
the supported runtime matrix. Publication and website deployment are separate
steps; confirm the npm version and deployed demo asset after release.
