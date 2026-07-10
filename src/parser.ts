import { XMLParser } from 'fast-xml-parser'
import { Decoder, Stream } from '@garmin/fitsdk'
import { readInputFile } from './file-input.js'
import type { Activity, TrackPoint } from './types.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
})

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

export function parseGpx(xml: string): Activity {
  const doc = xmlParser.parse(xml)
  const gpx = doc.gpx

  const tracks = asArray(gpx?.trk)
  const firstTrack = tracks[0]

  const name: string | undefined =
    gpx?.metadata?.name ?? firstTrack?.name ?? undefined

  const type: string | undefined =
    firstTrack?.type?.toString().toLowerCase() ?? undefined

  const points: TrackPoint[] = []

  for (const trk of tracks) {
    for (const seg of asArray(trk?.trkseg)) {
      for (const pt of asArray(seg?.trkpt)) {
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
  }

  return {
    name,
    type,
    startTime: points[0]?.timestamp,
    points,
    format: 'gpx',
  }
}

// ---------------------------------------------------------------------------
// TCX (Garmin Training Center XML) — Garmin / Strava / Wahoo exports
// ---------------------------------------------------------------------------

export function parseTcx(xml: string): Activity {
  const doc = xmlParser.parse(xml)
  const activities = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity)
  const first = activities[0]

  const type: string | undefined =
    first?.['@_Sport']?.toString().toLowerCase() ?? undefined

  const points: TrackPoint[] = []
  // Lap-level <DistanceMeters> is the device's own total for that lap —
  // distinct from the per-trackpoint <DistanceMeters> read below. A
  // multi-lap file carries one per lap; the activity's device total is
  // their sum.
  let deviceDistanceM: number | undefined

  for (const activity of activities) {
    for (const lap of asArray(activity?.Lap)) {
      const lapDist = Number(lap?.DistanceMeters)
      if (!isNaN(lapDist)) deviceDistanceM = (deviceDistanceM ?? 0) + lapDist

      for (const track of asArray(lap?.Track)) {
        for (const tp of asArray(track?.Trackpoint)) {
          const pos = tp?.Position
          if (!pos) continue // GPS-less sample (indoor / paused)

          const lat = Number(pos.LatitudeDegrees)
          const lon = Number(pos.LongitudeDegrees)
          if (isNaN(lat) || isNaN(lon)) continue

          const point: TrackPoint = { lat, lon }

          if (tp.AltitudeMeters != null) point.elevation = Number(tp.AltitudeMeters)
          if (tp.Time) point.timestamp = new Date(tp.Time)

          // <DistanceMeters> is cumulative distance from the activity start.
          if (tp.DistanceMeters != null) {
            const d = Number(tp.DistanceMeters)
            if (!isNaN(d)) point.distanceM = d
          }

          // <HeartRateBpm><Value>142</Value></HeartRateBpm>
          const hr = tp.HeartRateBpm?.Value ?? tp.HeartRateBpm
          if (hr != null) point.heartRate = Number(hr)

          // Garmin activity extension (namespaced ns3: or bare):
          // <Extensions><TPX><RunCadence>85</RunCadence></TPX></Extensions>
          const ext = tp.Extensions
          if (ext) {
            const tpx = ext['ns3:TPX'] ?? ext.TPX
            const cad = tpx?.['ns3:RunCadence'] ?? tpx?.RunCadence
            // TCX RunCadence is per-foot RPM; double to steps/min (matches GPX/FIT).
            if (cad != null) point.cadence = Math.round(Number(cad) * 2)
          }

          points.push(point)
        }
      }
    }
  }

  const startTime = first?.Id ? new Date(first.Id) : points[0]?.timestamp

  return { type, startTime, points, format: 'tcx', deviceDistanceM }
}

// ---------------------------------------------------------------------------
// FIT (binary) — Garmin / Wahoo / Coros / Suunto device files
// ---------------------------------------------------------------------------

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31

export function toUint8(bytes: Uint8Array | ArrayBuffer | ArrayLike<number>): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  return Uint8Array.from(bytes as ArrayLike<number>)
}

/** Quick check for the ".FIT" signature in a binary buffer. */
export function isFit(bytes: Uint8Array): boolean {
  try {
    return Decoder.isFIT(Stream.fromByteArray(bytes))
  } catch {
    return false
  }
}

export function parseFit(bytes: Uint8Array): Activity {
  const stream = Stream.fromByteArray(bytes)
  if (!Decoder.isFIT(stream)) {
    throw new Error('Unsupported file format. Supported formats: GPX, TCX, FIT.')
  }

  const decoder = new Decoder(stream)
  // Defaults already convert timestamps to Date and enum types to strings.
  const { messages } = decoder.read()

  const records: Record<string, unknown>[] = messages.recordMesgs ?? []
  const points: TrackPoint[] = []

  for (const r of records) {
    const rawLat = r.positionLat as number | undefined
    const rawLon = r.positionLong as number | undefined
    if (rawLat == null || rawLon == null) continue // GPS-less sample (indoor / paused)

    const lat = rawLat * SEMICIRCLE_TO_DEG
    const lon = rawLon * SEMICIRCLE_TO_DEG
    if (isNaN(lat) || isNaN(lon)) continue

    const point: TrackPoint = { lat, lon }

    // enhancedAltitude is higher-resolution when present
    const ele = (r.enhancedAltitude ?? r.altitude) as number | undefined
    if (ele != null) point.elevation = ele

    // enhancedDistance is higher-resolution when present; both are cumulative
    // distance from the activity start, in metres (same read as altitude).
    const dist = (r.enhancedDistance ?? r.distance) as number | undefined
    if (dist != null) point.distanceM = dist

    if (r.timestamp != null) point.timestamp = new Date(r.timestamp as string | number | Date)

    const hr = r.heartRate as number | undefined
    if (hr != null) point.heartRate = hr

    // FIT stores running cadence as RPM (one foot); double to steps/min,
    // matching the GPX path. fractionalCadence adds sub-step precision.
    const cad = r.cadence as number | undefined
    if (cad != null) {
      const frac = (r.fractionalCadence as number | undefined) ?? 0
      point.cadence = Math.round((cad + frac) * 2)
    }

    points.push(point)
  }

  const sport = (messages.sportMesgs?.[0] ?? {}) as Record<string, unknown>
  const sessions = (messages.sessionMesgs ?? []) as Record<string, unknown>[]
  const session = (sessions[0] ?? {}) as Record<string, unknown>

  const name = (sport.name as string | undefined) ?? undefined
  const type = ((sport.sport ?? session.sport) as string | undefined)?.toString().toLowerCase()
  const startTime = session.startTime
    ? new Date(session.startTime as string | number | Date)
    : points[0]?.timestamp

  // session.totalDistance is the device's own total for that session
  // (camelCase in the SDK's decoded output, not total_distance). A
  // multisport file carries one session per sport; sum them for the
  // activity's device total.
  const sessionDistances = sessions
    .map(s => s.totalDistance as number | undefined)
    .filter((d): d is number => d != null && !isNaN(d))
  const deviceDistanceM = sessionDistances.length > 0
    ? sessionDistances.reduce((a, b) => a + b, 0)
    : undefined

  return { name, type, startTime, points, format: 'fit', deviceDistanceM }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Dispatch a decoded XML/text document to the right parser. */
export function parseText(text: string): Activity {
  if (text.includes('<TrainingCenterDatabase')) return parseTcx(text)
  if (text.includes('<gpx')) return parseGpx(text)
  throw new Error('Unsupported file format. Supported formats: GPX, TCX, FIT.')
}

export interface ParseOptions {
  /** Skip format sniffing and parse `input` as this format directly. */
  format?: 'gpx' | 'tcx' | 'fit'
}

function truncate(s: string, max = 40): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function isEnoent(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Parse an activity file into a normalised {@link Activity}.
 *
 * Accepts:
 *  - a GPX or TCX file path (Node), or raw GPX/TCX XML string
 *  - a FIT file path (Node), or FIT bytes as `Uint8Array` / `ArrayBuffer`
 *
 * The format is auto-detected, so the same `analyze()` and chart configs work
 * for GPX, TCX and FIT input. Pass `{ format }` to skip auto-detection when
 * the format is already known.
 */
export function parse(input: string | Uint8Array | ArrayBuffer, options?: ParseOptions): Activity {
  // Binary input is always FIT (GPX/TCX are text/XML).
  if (typeof input !== 'string') {
    return parseFit(toUint8(input))
  }

  // Explicit format: skip path/content sniffing entirely.
  if (options?.format === 'gpx') return parseGpx(input)
  if (options?.format === 'tcx') return parseTcx(input)
  if (options?.format === 'fit') return parseFit(toUint8(Buffer.from(input, 'binary')))

  // String that looks like a file path → read it and sniff the contents.
  const isPath = !input.trimStart().startsWith('<') && input.length < 1000
  if (isPath) {
    let buf: Buffer
    try {
      buf = readInputFile(input)
    } catch (err) {
      if (isEnoent(err)) {
        throw new Error(
          `Stride: "${truncate(input)}" is neither a readable path nor recognisable GPX/TCX/FIT input.`,
        )
      }
      throw err
    }
    const bytes = toUint8(buf)
    if (isFit(bytes)) return parseFit(bytes)
    return parseText(buf.toString('utf-8'))
  }

  // Raw string content.
  return parseText(input)
}
