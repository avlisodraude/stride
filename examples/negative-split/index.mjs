// Recipe: Detect a negative split (or a late-race fade) from per-km splits
//
// A "negative split" means the second half of the run was faster than the
// first — the hallmark of a well-paced race. analyze() already emits clean
// per-km splits, so spotting one is a couple of reductions over stats.splits;
// you never re-derive pace from raw GPS points.
//
// This example builds a ~4 km run where the second half is run harder, then
// reports the swing. Any real GPX / TCX / FIT export works identically.
import { parse, analyze, formatPace } from "@alosha/stride";

// --- build a sample run: first 2 km at 6:00/km, last 2 km at 5:00/km ---
function sampleRun() {
  let lat = 52.0;
  let t = new Date("2026-06-29T06:00:00Z").getTime();
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    pts.push(
      `<trkpt lat="${lat.toFixed(6)}" lon="4.9000"><ele>5</ele><time>${new Date(t).toISOString()}</time></trkpt>`,
    );
    const secondHalf = i >= 20; // after ~2 km, pick up the pace
    lat += 0.0009; // ~100 m north per point
    t += (secondHalf ? 30 : 36) * 1000; // 30 s/100 m = 5:00/km vs 36 s = 6:00/km
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="alosha-stride-example" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Negative Split Demo</name><trkseg>${pts.join("")}</trkseg></trk>
</gpx>`;
}

// --- the recipe: classify the second half against the first ---
function splitAnalysis(activity) {
  const { splits } = analyze(activity);
  if (splits.length < 2) return null;

  const mid = Math.floor(splits.length / 2);
  const avgPace = (arr) =>
    arr.reduce((sum, s) => sum + s.paceSecPerKm, 0) / arr.length;

  const firstHalf = avgPace(splits.slice(0, mid));
  const secondHalf = avgPace(splits.slice(mid));
  const deltaSec = Math.round(firstHalf - secondHalf); // > 0 => second half quicker

  return {
    negativeSplit: deltaSec > 0,
    firstHalfPace: formatPace(firstHalf),
    secondHalfPace: formatPace(secondHalf),
    swingSecPerKm: Math.abs(deltaSec),
  };
}

const result = splitAnalysis(parse(sampleRun()));

console.log(`first half:  ${result.firstHalfPace}`); // formatPace already adds "/km"
console.log(`second half: ${result.secondHalfPace}`);
console.log(
  result.negativeSplit
    ? `negative split — ${result.swingSecPerKm}s/km faster in the back half`
    : `positive split — faded ${result.swingSecPerKm}s/km`,
);
