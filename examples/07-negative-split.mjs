// Recipe: detect a negative split (or a late-race fade) from per-km splits.
//
// A "negative split" means the second half of the run was faster than the
// first — the hallmark of a well-paced race. analyze() emits splits at exact
// 1000 m marks (plus a trailing partial), so spotting one is a couple of
// reductions over stats.splits; you never re-derive pace from raw GPS.
//
// This builds a ~4 km run where the second half is run harder, then reports
// the swing. Any real GPX / TCX / FIT export works identically.
import { parse, analyze, formatPace } from '@alosha/stride'

// --- build a sample run: first 2 km at 6:00/km, last 2 km at 5:00/km ---
function sampleRun() {
  let lat = 52.0
  let t = new Date('2026-06-29T06:00:00Z').getTime()
  const pts = []
  for (let i = 0; i <= 40; i++) {
    pts.push(
      `<trkpt lat="${lat.toFixed(6)}" lon="4.9000"><ele>5</ele><time>${new Date(t).toISOString()}</time></trkpt>`,
    )
    const secondHalf = i >= 20 // after ~2 km, pick up the pace
    lat += 0.0009 // ~100 m north per point
    t += (secondHalf ? 30 : 36) * 1000 // 30 s/100 m = 5:00/km vs 36 s = 6:00/km
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="alosha-stride-example" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Negative Split Demo</name><trkseg>${pts.join('')}</trkseg></trk>
</gpx>`
}

// --- the recipe: classify the second half against the first ---
function splitAnalysis(activity) {
  const { splits } = analyze(activity, {}) // options object; all defaults
  if (splits.length < 2) return null

  // Weight by each split's actual distance so a trailing partial split
  // (distanceM !== 1000) doesn't skew the halves.
  const avgPace = (arr) => {
    const dist = arr.reduce((sum, s) => sum + s.distanceM, 0)
    const time = arr.reduce((sum, s) => sum + s.paceSecPerKm * (s.distanceM / 1000), 0)
    return time / (dist / 1000)
  }

  const mid = Math.floor(splits.length / 2)
  const firstHalf = avgPace(splits.slice(0, mid))
  const secondHalf = avgPace(splits.slice(mid))
  const deltaSec = Math.round(firstHalf - secondHalf) // > 0 => second half quicker

  return {
    negativeSplit: deltaSec > 0,
    firstHalfPace: formatPace(firstHalf),
    secondHalfPace: formatPace(secondHalf),
    swingSecPerKm: Math.abs(deltaSec),
  }
}

const result = splitAnalysis(parse(sampleRun()))

console.log(`first half:  ${result.firstHalfPace}`) // formatPace already adds "/km"
console.log(`second half: ${result.secondHalfPace}`)
console.log(
  result.negativeSplit
    ? `negative split — ${result.swingSecPerKm}s/km faster in the back half`
    : `positive split — faded ${result.swingSecPerKm}s/km`,
)

// Output (node examples/07-negative-split.mjs, after npm run build at the repo root):
//
// first half:  6:00/km
// second half: 5:00/km
// negative split — 60s/km faster in the back half
