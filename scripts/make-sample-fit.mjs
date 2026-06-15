/**
 * Generate a small, realistic sample FIT activity used by the test suite and
 * the stride.alosha.dev/demo "Load a sample run" button.
 *
 *   node scripts/make-sample-fit.mjs <output.fit>
 *
 * Produces a ~2 km, ~10 min run with GPS, elevation, heart rate and cadence.
 */
import { Encoder, Profile } from '@garmin/fitsdk'
import fs from 'fs'

const out = process.argv[2] ?? 'sample-run.fit'
const M = Profile.MesgNum
const SC = 2 ** 31 / 180 // degrees -> semicircles

const start = new Date('2026-06-01T07:00:00Z')
const durationSec = 600 // 10 minutes
const speed = 3.3 // m/s ≈ 5:03 / km

const enc = new Encoder()

enc.writeMesg({
  mesgNum: M.FILE_ID,
  type: 'activity',
  manufacturer: 'development',
  product: 1,
  serialNumber: 1234,
  timeCreated: start,
})

enc.writeMesg({ mesgNum: M.SPORT, sport: 'running', subSport: 'road', name: 'Morning Run' })

// Start near the Amstel, Amsterdam, heading roughly east with rolling elevation.
let lat = 52.3500
let lon = 4.9000
let distance = 0

for (let i = 0; i <= durationSec; i++) {
  distance += speed
  // Advance ~3.3 m of easting per second (1° lon ≈ 68.5 km at this latitude),
  // so the GPS path length matches the ~3.3 m/s speed → ~2 km total.
  lon += 0.0000486
  lat += 0.0000015
  const elevation = 8 + 6 * Math.sin(i / 90) // gentle 8–14 m rollers
  const hr = Math.round(120 + 45 * (i / durationSec) + 4 * Math.sin(i / 25)) // 120 -> ~170
  const cadence = 86 + (i % 3) // RPM (one foot)

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
  sport: 'running',
})

const bytes = enc.close()
fs.writeFileSync(out, Buffer.from(bytes))
console.log(`Wrote ${out} (${bytes.length} bytes, ${durationSec + 1} records)`)
