import { XMLParser } from 'fast-xml-parser'
import fs from 'fs'
import type { Activity, TrackPoint } from './types.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
})

function parseGpx(xml: string): Activity {
  const doc = xmlParser.parse(xml)
  const gpx = doc.gpx

  const name: string | undefined =
    gpx?.metadata?.name ?? gpx?.trk?.name ?? undefined

  const type: string | undefined =
    gpx?.trk?.type?.toString().toLowerCase() ?? undefined

  // Collect all trkpt elements
  const trkseg = gpx?.trk?.trkseg
  const segments = Array.isArray(trkseg) ? trkseg : [trkseg]

  const points: TrackPoint[] = []

  for (const seg of segments) {
    if (!seg?.trkpt) continue
    const trkpts = Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt]

    for (const pt of trkpts) {
      const lat = parseFloat(pt['@_lat'])
      const lon = parseFloat(pt['@_lon'])
      if (isNaN(lat) || isNaN(lon)) continue

      const point: TrackPoint = { lat, lon }

      if (pt.ele != null) point.elevation = parseFloat(pt.ele)
      if (pt.time) point.timestamp = new Date(pt.time)

      // Garmin extensions (heart rate + cadence)
      const ext = pt.extensions
      if (ext) {
        const tpx =
          ext['gpxtpx:TrackPointExtension'] ??
          ext['ns3:TrackPointExtension'] ??
          ext.TrackPointExtension

        if (tpx) {
          const hr =
            tpx['gpxtpx:hr'] ?? tpx['ns3:hr'] ?? tpx.hr
          const cad =
            tpx['gpxtpx:cad'] ?? tpx['ns3:cad'] ?? tpx.cad

          if (hr != null) point.heartRate = parseInt(hr)
          if (cad != null) point.cadence = parseInt(cad) * 2 // Garmin stores per-foot cadence
        }
      }

      points.push(point)
    }
  }

  return {
    name,
    type,
    startTime: points[0]?.timestamp,
    points,
    format: 'gpx',
  }
}

/**
 * Parse a GPX file from a file path or raw XML string.
 */
export function parse(input: string): Activity {
  // If input looks like a file path, read it
  const isPath = !input.trimStart().startsWith('<') && input.length < 1000
  const xml = isPath ? fs.readFileSync(input, 'utf-8') : input

  if (xml.includes('<gpx')) return parseGpx(xml)

  throw new Error('Unsupported file format. Only GPX is currently supported.')
}
