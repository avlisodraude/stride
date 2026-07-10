# @alosha/stride examples

Small, runnable scripts — one per feature. Each ends with a comment showing
the real output it produced when run against the built package.

## Running them

From the repo root:

```bash
npm install && npm run build   # build the package the examples link against
cd examples
npm install                    # links @alosha/stride from the repo root
node 01-parsing.mjs            # …or any other example
```

(As a published-package consumer you'd skip all that: `npm install
@alosha/stride` and change the fixture paths to your own activity files.)

## Index

| Example | Shows |
|---|---|
| [`01-parsing.mjs`](./01-parsing.mjs) | `parseFile()` (async, Node) vs `parse()` (sync), when to reach for each, and `{ format }` to skip sniffing |
| [`02-zone-models.mjs`](./02-zone-models.mjs) | `zoneModel: { type: 'hrmax' }` vs `{ type: 'reserve', restingHR }` on the same activity — the distribution visibly moves — plus boundary validation, and `maxHR` |
| [`03-pause-threshold.mjs`](./03-pause-threshold.mjs) | `pauseThresholdMps` — a traffic-light stop with GPS drift that visibly changes `movingTimeSec` and `avgPaceSecPerKm` |
| [`04-elevation-threshold.mjs`](./04-elevation-threshold.mjs) | `elevationThresholdM: 2` (barometric) vs the 8 m GPS default on the same file |
| [`05-sources.mjs`](./05-sources.mjs) | Branching on `distanceSource` / `elevationSource`, and `deviceDistanceM` — unrounded, so the subtraction shows float dust; use `.toFixed(1)` |
| [`06-charts.mjs`](./06-charts.mjs) | The `@alosha/stride/charts` entry point — configs build without `chart.js` installed; you need it (`npm install chart.js`) only to render |
| [`07-negative-split.mjs`](./07-negative-split.mjs) | Recipe: detect a negative split from `stats.splits`, handling the trailing partial split |

Between them, every `AnalyzeOptions` field (`maxHR`, `zoneModel`,
`elevationThresholdM`, `pauseThresholdMps`) and both parse entry points are
exercised.
