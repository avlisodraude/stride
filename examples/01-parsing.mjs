// parseFile() vs parse(), and skipping format sniffing with { format }.
//
// parseFile(path) — async, fs/promises-backed, Node only. Reach for it
// whenever you're in Node reading from disk: it doesn't block the event
// loop, and there's no path-vs-content guessing since the argument is
// unambiguously a path.
//
// parse(input) — sync, and the only one of the two that exists in the
// browser build. Reach for it when you already hold the content (an upload,
// a fetch response, a string) or when you genuinely need a synchronous call.
import { readFile } from 'node:fs/promises'
import { parse, parseFile, analyze } from '@alosha/stride'

const fixture = (name) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname

// 1. parseFile — the default choice in Node. Format auto-detected.
const fromFile = await parseFile(fixture('sample-run.tcx'))
console.log('parseFile:', fromFile.format, `${fromFile.points.length} points`)

// 2. parse with content you already hold — here, raw XML read separately.
const xml = await readFile(fixture('gpx-climb.gpx'), 'utf-8')
const fromString = parse(xml)
console.log('parse(string):', fromString.format, `${fromString.points.length} points`)

// 3. { format } skips sniffing entirely — useful when the extension lies
//    (an .xml export you know is GPX) or when you parse thousands of files
//    of a known format and don't want the detection pass.
const explicit = parse(xml, { format: 'gpx' })
console.log('parse(string, { format: "gpx" }):', explicit.format, `${explicit.points.length} points`)

// parseFile takes the same option:
const fit = await parseFile(fixture('climb-run.fit'), { format: 'fit' })
console.log('parseFile(path, { format: "fit" }):', fit.format, `"${fit.name}"`)

// All four go through the same analyze():
const stats = analyze(fromFile)
console.log(`analyze: ${stats.distanceM} m in ${stats.movingTimeSec} s`)

// Output (node examples/01-parsing.mjs, after npm run build at the repo root):
//
// parseFile: tcx 601 points
// parse(string): gpx 17 points
// parse(string, { format: "gpx" }): gpx 17 points
// parseFile(path, { format: "fit" }): fit "Hill Repeats"
// analyze: 1980 m in 600 s
