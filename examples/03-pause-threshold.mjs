// pauseThresholdMps: what counts as "stopped"?
//
// movingTimeSec excludes segments whose speed is at or below
// pauseThresholdMps (default 0.3 m/s). But a runner standing at a traffic
// light isn't reported at 0 m/s — GPS jitter drifts the position, so the
// "pause" often reads as ~0.5 m/s of phantom crawl. At the default
// threshold that drift counts as moving; raise the threshold and the pause
// is excluded, which also changes avgPaceSecPerKm (moving time ÷ distance).
//
// This builds a run with a 60 s traffic-light stop drifting at ~0.5 m/s.
import { parse, analyze, formatDuration, formatPace } from '@alosha/stride'

function runWithTrafficLight() {
  const pts = []
  let lat = 52.0
  let t = new Date('2026-06-29T06:00:00Z').getTime()
  const push = () => pts.push(
    `<trkpt lat="${lat.toFixed(6)}" lon="4.9000"><ele>5</ele><time>${new Date(t).toISOString()}</time></trkpt>`,
  )
  // 5 min running at ~3.3 m/s (10 m per 3 s)
  for (let i = 0; i < 100; i++) { push(); lat += 0.00009; t += 3000 }
  // 60 s "stopped" at a light — GPS drift crawls ~0.5 m/s (1.5 m per 3 s)
  for (let i = 0; i < 20; i++) { push(); lat += 0.0000135; t += 3000 }
  // 5 more minutes running
  for (let i = 0; i <= 100; i++) { push(); lat += 0.00009; t += 3000 }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="alosha-stride-example" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Traffic Light Run</name><trkseg>${pts.join('')}</trkseg></trk>
</gpx>`
}

const activity = parse(runWithTrafficLight())

for (const pauseThresholdMps of [0.3, 1.0]) {
  const s = analyze(activity, { pauseThresholdMps })
  console.log(
    `pauseThresholdMps=${pauseThresholdMps}: moving ${formatDuration(s.movingTimeSec)} ` +
    `of ${formatDuration(s.elapsedTimeSec)} elapsed, avg pace ${formatPace(s.avgPaceSecPerKm)}`,
  )
}
// At 0.3 the drift "counts": the light is moving time and drags avg pace
// down. At 1.0 the stop is excluded, matching what the runner would say
// happened.

// Output (node examples/03-pause-threshold.mjs, after npm run build at the repo root):
//
// pauseThresholdMps=0.3: moving 11:00 of 11:00 elapsed, avg pace 5:25/km
// pauseThresholdMps=1: moving 10:00 of 11:00 elapsed, avg pace 4:55/km
