/**
 * Generate a FIT activity whose session message carries a device-computed
 * total_ascent / total_descent, so the test suite can exercise the
 * "prefer the device's own elevation" path (docs/metrics-spec.md §5.3 step 1,
 * §5.6). sample-run.fit deliberately does NOT set these fields, so it stays on
 * the GPS-altitude hysteresis fallback; this fixture is its device-carrying
 * counterpart.
 *
 *   node scripts/make-climb-fit.mjs <output.fit>
 *
 * The record stream carries a *noisy GPS* altitude that climbs ~60 m net, the
 * kind of signal the hysteresis filter denoises. The session then reports a
 * larger barometric-style total_ascent (78 m) and a total_descent (18 m) — the
 * device saw rollers the GPS altitude flattened into noise. That divergence is
 * the point: analyze() should report the device's 78/18, not the hysteresis
 * figure, and the per-split gains (still hysteresis-derived) will not sum to it.
 *
 * Single session on purpose: the multisport (multi-session) summing path in
 * parseFit is NOT exercised by this fixture — it mirrors the already-covered
 * session.totalDistance sum.
 */
import { Encoder, Profile } from '@garmin/fitsdk'
import fs from 'fs'

const out = process.argv[2] ?? 'climb-run.fit'
const M = Profile.MesgNum
const SC = 2 ** 31 / 180 // degrees -> semicircles

const start = new Date('2026-06-02T07:00:00Z')
const durationSec = 240 // 4 minutes
const speed = 3.0 // m/s

// Device barometric totals for the whole session (metres). Chosen larger than
// the raw-GPS hysteresis gain so the fixture proves elevation can *increase*
// when we defer to the device — not only ever drop.
const deviceTotalAscent = 78
const deviceTotalDescent = 18

const enc = new Encoder()

enc.writeMesg({
  mesgNum: M.FILE_ID,
  type: 'activity',
  manufacturer: 'development',
  product: 2,
  serialNumber: 5678,
  timeCreated: start,
})

enc.writeMesg({ mesgNum: M.SPORT, sport: 'hiking', subSport: 'generic', name: 'Hill Repeats' })

let lat = 45.5000
let lon = 9.5000
let distance = 0

for (let i = 0; i <= durationSec; i++) {
  distance += speed
  lon += 0.0000486
  lat += 0.0000015
  // Noisy GPS altitude: ~60 m net climb (100 -> 160) with ±~1.5 m jitter,
  // exactly the signal the hysteresis filter is meant to denoise.
  const elevation = 100 + 0.25 * i + 1.5 * Math.sin(i / 3)
  const hr = Math.round(110 + 40 * (i / durationSec))
  const cadence = 70 + (i % 3)

  enc.writeMesg({
    mesgNum: M.RECORD,
    timestamp: new Date(start.getTime() + i * 1000),
    positionLat: Math.round(lat * SC),
    positionLong: Math.round(lon * SC),
    altitude: elevation,
    distance,
    speed,
    heartRate: hr,
    cadence,
  })
}

enc.writeMesg({
  mesgNum: M.SESSION,
  startTime: start,
  totalElapsedTime: durationSec,
  totalTimerTime: durationSec,
  totalDistance: distance,
  totalAscent: deviceTotalAscent,
  totalDescent: deviceTotalDescent,
  sport: 'hiking',
})

const bytes = enc.close()
fs.writeFileSync(out, Buffer.from(bytes))
console.log(
  `Wrote ${out} (${bytes.length} bytes, ${durationSec + 1} records, ` +
  `session totalAscent=${deviceTotalAscent} totalDescent=${deviceTotalDescent})`,
)
