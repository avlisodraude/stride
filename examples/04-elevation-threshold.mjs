// elevationThresholdM: barometric (2 m) vs the GPS default (8 m), same file.
//
// The hysteresis filter only credits a climb once the cumulative rise from
// the last confirmed point clears the threshold. The default is 8 m because
// the altitude stream it filters is essentially always GPS-derived, and GPS
// vertical noise is ±3–5 m per fix. If you *know* your data came from a
// barometric altimeter (much less noisy), a 2 m threshold is more faithful
// — the default would throw away real, small climbs.
//
// gpx-climb.gpx is a hand-traced hill: noise, a confirmed climb, a confirmed
// descent, more noise. Watch the same file through both thresholds.
import { parseFile, analyze } from '@alosha/stride'

const activity = await parseFile(new URL('../test/fixtures/gpx-climb.gpx', import.meta.url).pathname)

const gps = analyze(activity) // default: elevationThresholdM 8
const baro = analyze(activity, { elevationThresholdM: 2 })

console.log(`default (8 m, GPS-grade):     gain ${gps.elevationGainM} m, loss ${gps.elevationLossM} m`)
console.log(`elevationThresholdM: 2 (baro): gain ${baro.elevationGainM} m, loss ${baro.elevationLossM} m`)

// The extra metres at 2 m are the sub-threshold wiggles the 8 m default
// rejects as noise. Which figure is "right" depends entirely on the
// instrument that recorded the altitude — that's why it's an option.
//
// Note the threshold only governs the 'computed' path: when a FIT file
// carries a device total (elevationSource === 'device'), the activity total
// comes from the device and this option only affects splits[].elevationGainM.

// Output (node examples/04-elevation-threshold.mjs, after npm run build at the repo root):
//
// default (8 m, GPS-grade):     gain 28 m, loss 23 m
// elevationThresholdM: 2 (baro): gain 45 m, loss 44 m
