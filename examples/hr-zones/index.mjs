// Recipe: Build a heart-rate zone breakdown without writing the maths
//
// Embeds a small GPX with Garmin TrackPointExtension heart-rate data so the
// zone calculation has real numbers to work with. A real device export
// (GPX, TCX, or FIT) with HR data works identically.
import { parse, analyze, hrZonesChartConfig } from "@alosha/stride";

const sampleGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="alosha-stride-example" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>Morning Run</name><trkseg>
    <trkpt lat="52.3702" lon="4.8952"><ele>5</ele><time>2026-06-29T06:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>132</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="52.3712" lon="4.8960"><ele>6</ele><time>2026-06-29T06:01:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="52.3722" lon="4.8970"><ele>8</ele><time>2026-06-29T06:02:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>148</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="52.3732" lon="4.8980"><ele>7</ele><time>2026-06-29T06:03:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>155</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="52.3742" lon="4.8990"><ele>9</ele><time>2026-06-29T06:04:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>162</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="52.3752" lon="4.9000"><ele>10</ele><time>2026-06-29T06:05:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>158</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  </trkseg></trk>
</gpx>`;

const activity = parse(sampleGpx);
const stats = analyze(activity, 185); // 185 = max HR
const config = hrZonesChartConfig(stats);

console.log(`zones: ${config.data.labels.join(", ")}`);
console.log("In the browser: new Chart(canvas, config) renders this doughnut directly.");
