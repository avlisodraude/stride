/**
 * Generate a small, realistic sample TCX activity used by the test suite and
 * the demo. Mirrors the FIT/GPX samples: ~2 km, ~10 min, GPS + elevation + HR +
 * cadence.
 *
 *   node scripts/make-sample-tcx.mjs <output.tcx>
 */
import fs from 'fs'

const out = process.argv[2] ?? 'sample-run.tcx'

const start = new Date('2026-06-01T07:00:00Z')
const durationSec = 600 // 10 minutes
const speed = 3.3 // m/s ≈ 5:03 / km

let lat = 52.3500
let lon = 4.9000
let distance = 0
const trackpoints = []

for (let i = 0; i <= durationSec; i++) {
  distance += speed
  lon += 0.0000486
  lat += 0.0000015
  const elevation = 8 + 6 * Math.sin(i / 90)
  const hr = Math.round(120 + 45 * (i / durationSec) + 4 * Math.sin(i / 25))
  const cadence = 86 + (i % 3) // RPM (one foot)
  const t = new Date(start.getTime() + i * 1000).toISOString()

  trackpoints.push(
    `        <Trackpoint>
          <Time>${t}</Time>
          <Position>
            <LatitudeDegrees>${lat.toFixed(7)}</LatitudeDegrees>
            <LongitudeDegrees>${lon.toFixed(7)}</LongitudeDegrees>
          </Position>
          <AltitudeMeters>${elevation.toFixed(1)}</AltitudeMeters>
          <DistanceMeters>${distance.toFixed(1)}</DistanceMeters>
          <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>
          <Extensions>
            <ns3:TPX>
              <ns3:Speed>${speed.toFixed(1)}</ns3:Speed>
              <ns3:RunCadence>${cadence}</ns3:RunCadence>
            </ns3:TPX>
          </Extensions>
        </Trackpoint>`,
  )
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>${start.toISOString()}</Id>
      <Lap StartTime="${start.toISOString()}">
        <TotalTimeSeconds>${durationSec}</TotalTimeSeconds>
        <DistanceMeters>${distance.toFixed(1)}</DistanceMeters>
        <Track>
${trackpoints.join('\n')}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`

fs.writeFileSync(out, xml)
console.log(`Wrote ${out} (${xml.length} bytes, ${durationSec + 1} trackpoints)`)
