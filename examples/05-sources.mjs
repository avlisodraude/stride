// distanceSource / elevationSource: which path produced each number —
// and deviceDistanceM, the device's own total alongside it.
//
// analyze() prefers device-reported figures where the file carries them and
// falls back to computing from the GPS stream where it doesn't. The two
// *Source fields tell you which happened, per metric — branch on them
// instead of guessing from the file extension.
import { parseFile, analyze } from '@alosha/stride'

const fixture = (name) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname

for (const name of ['sample-run.tcx', 'climb-run.fit', 'gpx-climb.gpx']) {
  const stats = analyze(await parseFile(fixture(name)))
  console.log(`\n${name}`)

  if (stats.distanceSource === 'device') {
    console.log(`  distance ${stats.distanceM} m — from the device's own distance stream`)
  } else {
    console.log(`  distance ${stats.distanceM} m — summed haversine over GPS points`)
  }

  if (stats.elevationSource === 'device') {
    // Device total: activity-level scalar. Splits keep the GPS-derived pass,
    // so they will NOT sum to this — deliberate; see the README.
    const splitSum = stats.splits.reduce((a, s) => a + s.elevationGainM, 0)
    console.log(`  gain ${stats.elevationGainM} m — device total (splits sum to ${splitSum} m, by design)`)
  } else {
    console.log(`  gain ${stats.elevationGainM} m — GPS-altitude hysteresis filter`)
  }

  // deviceDistanceM is the device's own total, reported verbatim and
  // UNROUNDED — while distanceM is an integer. Subtracting the two puts
  // float dust on your screen; .toFixed(1) is the honest display.
  if (stats.deviceDistanceM != null) {
    const gap = stats.deviceDistanceM - stats.distanceM
    console.log(`  deviceDistanceM ${stats.deviceDistanceM} m (raw gap: ${gap})`)
    console.log(`  device counted ${gap.toFixed(1)} m before the first GPS fix`)
  } else {
    console.log('  deviceDistanceM: undefined (GPX has no device total)')
  }
}

// Output (node examples/05-sources.mjs, after npm run build at the repo root):
//
// sample-run.tcx
//   distance 1980 m — from the device's own distance stream
//   gain 0 m — GPS-altitude hysteresis filter
//   deviceDistanceM 1983.3 m (raw gap: 3.2999999999999545)
//   device counted 3.3 m before the first GPS fix
//
// climb-run.fit
//   distance 720 m — from the device's own distance stream
//   gain 78 m — device total (splits sum to 58 m, by design)
//   deviceDistanceM 723 m (raw gap: 3)
//   device counted 3.0 m before the first GPS fix
//
// gpx-climb.gpx
//   distance 189 m — summed haversine over GPS points
//   gain 28 m — GPS-altitude hysteresis filter
//   deviceDistanceM: undefined (GPX has no device total)
