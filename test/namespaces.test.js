import { parse, parseFile } from '../dist/index.js'
import { fileURLToPath } from 'node:url'

const GPX = 'http://www.topografix.com/GPX/1/1'
const TPX = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1'
const TCX = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'
const AX = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'

describe('namespace-aware XML input', () => {
  test('accepts arbitrary GPX and extension prefixes', () => {
    const input = `<r:gpx xmlns:r="${GPX}" xmlns:watch="${TPX}" version="1.1" creator="test">`
      + '<r:metadata><r:name>Namespaced run</r:name></r:metadata><r:trk><r:trkseg>'
      + '<r:trkpt lat="52" lon="4"><r:ele>12</r:ele><r:extensions>'
      + '<watch:TrackPointExtension><watch:hr>145</watch:hr><watch:cad>80</watch:cad></watch:TrackPointExtension>'
      + '</r:extensions></r:trkpt></r:trkseg></r:trk></r:gpx>'
    const result = parse(input)
    expect(result.name).toBe('Namespaced run')
    expect(result.points).toEqual([{ lat: 52, lon: 4, elevation: 12, heartRate: 145, cadence: 160 }])
    expect(parse(input, { format: 'gpx' })).toEqual(result)
  })

  test('resolves default namespaces on nested extensions', () => {
    const result = parse(`<gpx xmlns="${GPX}"><trk><trkseg><trkpt lat="52" lon="4"><extensions>`
      + `<TrackPointExtension xmlns="${TPX}"><hr>150</hr><cad>85</cad></TrackPointExtension>`
      + '</extensions></trkpt></trkseg></trk></gpx>')
    expect(result.points[0].heartRate).toBe(150)
    expect(result.points[0].cadence).toBe(170)
  })

  test('prefix rebindings are scoped and foreign elements cannot masquerade as readings', () => {
    const result = parse(`<g:gpx xmlns:g="${GPX}" xmlns:gpxtpx="urn:foreign" xmlns:s="${TPX}">`
      + '<g:trk><g:trkseg><g:trkpt lat="0" lon="0"><g:extensions>'
      + '<gpxtpx:TrackPointExtension><gpxtpx:hr>250</gpxtpx:hr></gpxtpx:TrackPointExtension>'
      + '<s:TrackPointExtension><s:hr xmlns:s="urn:other">240</s:hr><s:cad>80</s:cad></s:TrackPointExtension>'
      + '</g:extensions></g:trkpt><g:trkpt lat="0" lon="0.001"><g:extensions>'
      + '<s:TrackPointExtension><s:hr>140</s:hr></s:TrackPointExtension>'
      + '</g:extensions></g:trkpt></g:trkseg></g:trk></g:gpx>')
    expect(result.points[0].heartRate).toBeUndefined()
    expect(result.points[0].cadence).toBe(160)
    expect(result.points[1].heartRate).toBe(140)
  })

  test('supports prefixed TCX with arbitrarily aliased activity extensions', () => {
    const input = `<t:TrainingCenterDatabase xmlns:t="${TCX}" xmlns:run="${AX}">`
      + '<t:Activities><t:Activity Sport="Running"><t:Lap><t:DistanceMeters>123</t:DistanceMeters><t:Track>'
      + '<t:Trackpoint><t:Position><t:LatitudeDegrees>52</t:LatitudeDegrees><t:LongitudeDegrees>4</t:LongitudeDegrees></t:Position>'
      + '<t:HeartRateBpm><t:Value>140</t:Value></t:HeartRateBpm><t:Extensions><run:TPX><run:RunCadence>85</run:RunCadence></run:TPX></t:Extensions>'
      + '</t:Trackpoint></t:Track></t:Lap></t:Activity></t:Activities></t:TrainingCenterDatabase>'
    const result = parse(input)
    expect(result.format).toBe('tcx')
    expect(result.deviceDistanceM).toBe(123)
    expect(result.points).toEqual([{ lat: 52, lon: 4, heartRate: 140, cadence: 170 }])
    expect(parse(input, { format: 'tcx' })).toEqual(result)
  })

  test('a foreign root or a name appearing only in comments is not a supported format', () => {
    expect(() => parse('<g:gpx xmlns:g="urn:foreign"/>')).toThrow(/Unsupported file format/)
    expect(() => parse('<!-- <gpx> --><unrelated/>')).toThrow(/Unsupported file format/)
  })

  test('file parsing uses the same namespace handling as raw XML', async () => {
    const result = await parseFile(fileURLToPath(new URL('fixtures/prefixed-run.gpx', import.meta.url)))
    expect(result.name).toBe('Prefixed fixture')
    expect(result.points[0].heartRate).toBe(140)
  })
})
