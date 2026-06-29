// Recipe: Turn a Garmin .FIT upload into a pace chart in the browser
//
// `parse()` auto-detects GPX, TCX, or FIT input — a string of raw XML, or
// raw bytes for FIT. This example embeds a small GPX string so it runs
// anywhere with no file upload; a real .fit file from a device export
// works identically, just pass its Uint8Array bytes instead.
import { parse, analyze, paceChartConfig } from "@alosha/stride";

const sampleGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="alosha-stride-example" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Morning Run</name><trkseg>
    <trkpt lat="52.3702" lon="4.8952"><ele>5</ele><time>2026-06-29T06:00:00Z</time></trkpt>
    <trkpt lat="52.3712" lon="4.8960"><ele>6</ele><time>2026-06-29T06:01:00Z</time></trkpt>
    <trkpt lat="52.3722" lon="4.8970"><ele>8</ele><time>2026-06-29T06:02:00Z</time></trkpt>
    <trkpt lat="52.3732" lon="4.8980"><ele>7</ele><time>2026-06-29T06:03:00Z</time></trkpt>
    <trkpt lat="52.3742" lon="4.8990"><ele>9</ele><time>2026-06-29T06:04:00Z</time></trkpt>
    <trkpt lat="52.3752" lon="4.9000"><ele>10</ele><time>2026-06-29T06:05:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

const activity = parse(sampleGpx);
const stats = analyze(activity);
const config = paceChartConfig(activity, stats);

console.log(`distance: ${stats.distanceM}m, avg pace: ${stats.avgPaceSecPerKm}s/km`);
console.log(`chart config ready: type=${config.type}, datasets=${config.data.datasets.length}`);
console.log("In the browser: new Chart(canvas, config) renders this directly.");
