// Synthetic two-session fixture; no real device or location data.
// Usage: node scripts/make-multisession-fit.mjs [output.fit]
import { Encoder, Profile } from '@garmin/fitsdk'
import { writeFileSync } from 'node:fs'

const encoder = new Encoder()
const mesg = Profile.MesgNum
const start = Date.parse('2026-06-01T07:00:00Z')
encoder.writeMesg({ mesgNum: mesg.FILE_ID, type: 'activity', manufacturer: 'development', timeCreated: new Date(start) })
encoder.writeMesg({ mesgNum: mesg.SPORT, sport: 'running', name: 'Two Sessions' })
for (const [seconds, distance] of [[0, 0], [300, 1000], [600, 1500]]) {
  encoder.writeMesg({
    mesgNum: mesg.RECORD, timestamp: new Date(start + seconds * 1000),
    positionLat: 0, positionLong: Math.round(distance / 111195 * 2 ** 31 / 180),
    distance, altitude: 100, heartRate: 140,
  })
}
for (const [seconds, sport, distance, gain, loss] of [[0, 'running', 1000, 12, 4], [300, 'cycling', 500, 8, 6]]) {
  encoder.writeMesg({
    mesgNum: mesg.SESSION, startTime: new Date(start + seconds * 1000), sport,
    totalDistance: distance, totalAscent: gain, totalDescent: loss,
  })
}
const output = process.argv[2] ?? 'test/fixtures/multi-session.fit'
writeFileSync(output, encoder.close())
console.log(`Wrote ${output}`)
