import { Decoder, Stream } from '@garmin/fitsdk'
import { readInputFile } from './file-input.js'
import { parseXml } from './xml.js'
import type { Activity, TrackPoint, ParseDiagnostics, TimerEvent } from './types.js'

function diagnostics(): ParseDiagnostics {
  return { totalRecords: 0, droppedRecords: 0, invalidPositions: 0, droppedReadings: 0, droppedTimerEvents: 0 }
}

function countReadings(d: ParseDiagnostics, point: TrackPoint, raw: Partial<Record<keyof TrackPoint, unknown>>): void {
  for (const field of ['elevation', 'timestamp', 'heartRate', 'cadence', 'distanceM'] as const) {
    if (raw[field] != null && point[field] == null) d.droppedReadings++
  }
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

// Coerce a parsed-XML value to a finite number, or undefined. Malformed
// markup (a non-numeric string, an unexpected element shape that coerces to
// NaN) must be dropped at the boundary: NaN passes every `!= null` guard
// downstream and silently corrupts avgHeartRate / maxHeartRate / hrZones.
function finiteNumber(v: unknown): number | undefined {
  // Empty elements (<HeartRateBpm/>) parse to '' and would coerce to 0 —
  // a fabricated reading, not a recorded one — so they are dropped too.
  if (typeof v !== 'number' && typeof v !== 'string') return undefined
  if (typeof v === 'string' && v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function sensorNumber(v: unknown, field: 'heartRate' | 'cadence'): number | undefined {
  const value = finiteNumber(v)
  return value != null && (field === 'heartRate' ? value > 0 : value >= 0) ? value : undefined
}

// Validate XML calendar fields before constructing a Date: JavaScript can
// silently turn February 30 into March 2. Check the written local date, not
// its UTC conversion, so valid offsets crossing midnight remain valid.
function validDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? new Date(v.getTime()) : undefined
  if (typeof v !== 'string') return undefined
  const value = v.trim()
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-](\d{2}):(\d{2}))?$/.exec(value)
  if (!parts) return undefined
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const hour = Number(parts[4])
  const minute = Number(parts[5])
  const second = Number(parts[6])
  const offsetHour = Number(parts[8] ?? 0)
  const offsetMinute = Number(parts[9] ?? 0)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return undefined
  if (hour > 24 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59) return undefined
  if (offsetHour === 14 && offsetMinute !== 0) return undefined
  // XML dateTime permits 24:00:00 as the following midnight, but no later
  // time or nonzero fractional second may use hour 24.
  if (hour === 24 && (minute !== 0 || second !== 0 || /[1-9]/.test(parts[7] ?? ''))) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

function validPosition(lat: number | undefined, lon: number | undefined): boolean {
  return lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

export function parseGpx(xml: string): Activity {
  return parseGpxDocument(parseXml(xml))
}

function parseGpxDocument(doc: ReturnType<typeof parseXml>): Activity {
  if (!Object.hasOwn(doc, 'gpx')) throw new Error('Expected GPX root element <gpx>.')
  const gpx = doc.gpx

  const tracks = asArray(gpx?.trk)
  const firstTrack = tracks[0]

  const name: string | undefined =
    gpx?.metadata?.name ?? firstTrack?.name ?? undefined

  const type: string | undefined =
    firstTrack?.type?.toString().toLowerCase() ?? undefined

  const points: TrackPoint[] = []
  const parseDiagnostics = diagnostics()

  for (const trk of tracks) {
    for (const seg of asArray(trk?.trkseg)) {
      let firstInSegment = true
      for (const pt of asArray(seg?.trkpt)) {
        parseDiagnostics.totalRecords++
        const lat = finiteNumber(pt['@_lat'])
        const lon = finiteNumber(pt['@_lon'])
        if (!validPosition(lat, lon)) {
          parseDiagnostics.droppedRecords++
          parseDiagnostics.invalidPositions++
          // The next retained fix starts a new span: dropping a corrupt fix
          // must not create a new edge between its former neighbours.
          firstInSegment = true
          continue
        }

        const point: TrackPoint = { lat: lat!, lon: lon! }
        if (firstInSegment && points.length > 0) point.segmentStart = true
        firstInSegment = false

        const ele = finiteNumber(pt.ele)
        if (pt.ele != null && ele != null) point.elevation = ele
        if (pt.time) point.timestamp = validDate(pt.time)

        // Garmin extensions (heart rate + cadence)
        const ext = pt.extensions
        let rawHr: unknown
        let rawCad: unknown
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
            rawHr = hr
            rawCad = cad

            const hrNum = sensorNumber(hr, 'heartRate')
            if (hrNum != null && Math.round(hrNum) > 0) point.heartRate = Math.round(hrNum)
            const cadNum = sensorNumber(cad, 'cadence')
            if (cadNum != null) point.cadence = Math.round(cadNum) * 2 // Garmin stores per-foot cadence
          }
        }

        countReadings(parseDiagnostics, point, { elevation: pt.ele, timestamp: pt.time, heartRate: rawHr, cadence: rawCad })
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
    parseDiagnostics,
  }
}

// ---------------------------------------------------------------------------
// TCX (Garmin Training Center XML) — Garmin / Strava / Wahoo exports
// ---------------------------------------------------------------------------

export function parseTcx(xml: string): Activity {
  return parseTcxDocument(parseXml(xml))
}

function parseTcxDocument(doc: ReturnType<typeof parseXml>): Activity {
  if (!Object.hasOwn(doc, 'TrainingCenterDatabase')) throw new Error('Expected TCX root element <TrainingCenterDatabase>.')
  const activities = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity)
  if (activities.length > 1) {
    throw new Error('TCX contains multiple activities. Export or provide one activity per file.')
  }
  const first = activities[0]

  const type: string | undefined =
    first?.['@_Sport']?.toString().toLowerCase() ?? undefined

  const points: TrackPoint[] = []
  const parseDiagnostics = diagnostics()
  // Lap-level <DistanceMeters> is the device's own total for that lap —
  // distinct from the per-trackpoint <DistanceMeters> read below. A
  // multi-lap file carries one per lap; the activity's device total is
  // their sum.
  let deviceDistanceM: number | undefined

  for (const activity of activities) {
    for (const lap of asArray(activity?.Lap)) {
      const lapDist = finiteNumber(lap?.DistanceMeters)
      if (lapDist != null && lapDist >= 0) deviceDistanceM = (deviceDistanceM ?? 0) + lapDist

      for (const track of asArray(lap?.Track)) {
        let firstInTrack = true
        for (const tp of asArray(track?.Trackpoint)) {
          parseDiagnostics.totalRecords++
          const pos = tp?.Position
          const lat = finiteNumber(pos?.LatitudeDegrees)
          const lon = finiteNumber(pos?.LongitudeDegrees)
          const point: TrackPoint = {}
          if (validPosition(lat, lon)) { point.lat = lat; point.lon = lon }
          else if (pos != null) parseDiagnostics.invalidPositions++

          const tcxEle = finiteNumber(tp.AltitudeMeters)
          if (tp.AltitudeMeters != null && tcxEle != null) point.elevation = tcxEle
          if (tp.Time) point.timestamp = validDate(tp.Time)

          // <DistanceMeters> is cumulative distance from the activity start.
          if (tp.DistanceMeters != null) {
            const d = finiteNumber(tp.DistanceMeters)
            if (d != null && d >= 0) point.distanceM = d
          }

          // <HeartRateBpm><Value>142</Value></HeartRateBpm>
          const hr = sensorNumber(tp.HeartRateBpm?.Value ?? tp.HeartRateBpm, 'heartRate')
          if (hr != null) point.heartRate = hr

          // Garmin activity extension (namespaced ns3: or bare):
          // <Extensions><TPX><RunCadence>85</RunCadence></TPX></Extensions>
          const ext = tp.Extensions
          let rawCad: unknown
          if (ext) {
            const tpx = ext['ns3:TPX'] ?? ext.TPX
            rawCad = tpx?.['ns3:RunCadence'] ?? tpx?.RunCadence
            const cad = sensorNumber(rawCad, 'cadence')
            // TCX RunCadence is per-foot RPM; double to steps/min (matches GPX/FIT).
            if (cad != null) point.cadence = Math.round(cad * 2)
          }

          countReadings(parseDiagnostics, point, {
            elevation: tp.AltitudeMeters, timestamp: tp.Time, distanceM: tp.DistanceMeters,
            heartRate: tp.HeartRateBpm?.Value ?? tp.HeartRateBpm, cadence: rawCad,
          })
          if (Object.values(point).every(v => v == null)) {
            parseDiagnostics.droppedRecords++
            firstInTrack = true
            continue
          }
          if (firstInTrack && points.length > 0) point.segmentStart = true
          firstInTrack = false
          points.push(point)
        }
      }
    }
  }

  const startTime = (first?.Id ? validDate(first.Id) : undefined) ?? points[0]?.timestamp

  return { type, startTime, points, format: 'tcx', deviceDistanceM, parseDiagnostics }
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
  const { messages, errors } = decoder.read()
  if (errors.length > 0) {
    throw new Error(`Invalid FIT file: ${errors.map(error => error.message).join('; ')}`)
  }

  const records = messages.recordMesgs ?? []
  const points: TrackPoint[] = []
  const parseDiagnostics = diagnostics()

  for (const r of records) {
    parseDiagnostics.totalRecords++
    const rawLat = r.positionLat as number | undefined
    const rawLon = r.positionLong as number | undefined
    const lat = rawLat == null ? undefined : rawLat * SEMICIRCLE_TO_DEG
    const lon = rawLon == null ? undefined : rawLon * SEMICIRCLE_TO_DEG
    const point: TrackPoint = {}
    if (validPosition(lat, lon)) { point.lat = lat; point.lon = lon }
    else if (rawLat != null || rawLon != null) parseDiagnostics.invalidPositions++

    // enhancedAltitude is higher-resolution when present
    const ele = finiteNumber(r.enhancedAltitude ?? r.altitude)
    if (ele != null) point.elevation = ele

    // FIT record.distance is cumulative distance from the activity start.
    const dist = finiteNumber(r.distance)
    if (dist != null && dist >= 0) point.distanceM = dist

    if (r.timestamp != null) point.timestamp = validDate(r.timestamp)

    const hr = sensorNumber(r.heartRate, 'heartRate')
    if (hr != null) point.heartRate = hr

    // FIT stores running cadence as RPM (one foot); double to steps/min,
    // matching the GPX path. fractionalCadence adds sub-step precision.
    const cad = sensorNumber(r.cadence, 'cadence')
    if (cad != null) {
      const frac = sensorNumber(r.fractionalCadence, 'cadence') ?? 0
      point.cadence = Math.round((cad + frac) * 2)
    }

    countReadings(parseDiagnostics, point, {
      elevation: r.enhancedAltitude ?? r.altitude, timestamp: r.timestamp,
      distanceM: r.distance, heartRate: r.heartRate, cadence: r.cadence,
    })
    if (Object.values(point).every(v => v == null)) { parseDiagnostics.droppedRecords++; continue }
    points.push(point)
  }

  const timerEvents: TimerEvent[] = []
  for (const event of messages.eventMesgs ?? []) {
    if (event.event !== 'timer') continue
    const timestamp = event.timestamp == null ? undefined : validDate(event.timestamp)
    if (!timestamp) { parseDiagnostics.droppedTimerEvents++; continue }
    const eventType = event.eventType as string | undefined
    const type = eventType === 'start' ? 'start'
      : ['stop', 'stopAll', 'stopDisable', 'stopDisableAll'].includes(eventType ?? '') ? 'stop' : 'unsupported'
    timerEvents.push({ timestamp, type, group: event.eventGroup as number | undefined })
  }

  const sport = messages.sportMesgs?.[0]
  const sessions = messages.sessionMesgs ?? []
  const session = sessions[0]

  const name = sport?.name
  const type = (sport?.sport ?? session?.sport)?.toString().toLowerCase()
  const startTime = session?.startTime
    ? validDate(session.startTime)
    : points[0]?.timestamp

  // session.totalDistance is the device's own total for that session
  // (camelCase in the SDK's decoded output, not total_distance). A
  // multisport file carries one session per sport; sum them for the
  // activity's device total.
  const sessionDistances = sessions
    .map(s => finiteNumber(s.totalDistance))
    .filter((d): d is number => d != null && d >= 0)
  const deviceDistanceM = sessionDistances.length > 0
    ? sessionDistances.reduce((a, b) => a + b, 0)
    : undefined

  // session.totalAscent / totalDescent are the device's own barometric/fused
  // elevation totals for that session (camelCase in the SDK's output, uint16
  // metres). Sum across sessions the same way as totalDistance for multisport
  // files. Left undefined when no session reports the field — many watches
  // never write it, in which case the analyzer falls back to the GPS-altitude
  // hysteresis filter.
  const sumSessionField = (field: 'totalAscent' | 'totalDescent'): number | undefined => {
    const values = sessions
      .map(s => finiteNumber(s[field]))
      .filter((v): v is number => v != null && v >= 0)
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : undefined
  }
  const deviceElevationGainM = sumSessionField('totalAscent')
  const deviceElevationLossM = sumSessionField('totalDescent')

  return {
    name, type, startTime, points, format: 'fit',
    deviceDistanceM, deviceElevationGainM, deviceElevationLossM,
    parseDiagnostics, timerEvents,
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Dispatch a decoded XML/text document to the right parser. */
export function parseText(text: string): Activity {
  const doc = parseXml(text)
  if (Object.hasOwn(doc, 'TrainingCenterDatabase')) return parseTcxDocument(doc)
  if (Object.hasOwn(doc, 'gpx')) return parseGpxDocument(doc)
  throw new Error('Unsupported file format. Supported formats: GPX, TCX, FIT.')
}

export interface ParseOptions {
  /** Skip format detection for raw content, bytes or a file's contents. */
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
  const format = options?.format
  if (format != null && !['gpx', 'tcx', 'fit'].includes(format)) throw new Error(`Unsupported format hint: ${format}.`)
  // Unhinted bytes remain FIT-only; XML bytes need an explicit format.
  if (typeof input !== 'string') {
    return parseBytes(toUint8(input), format ?? 'fit')
  }

  if (input.trimStart().startsWith('<')) {
    if (format === 'gpx') return parseGpx(input)
    if (format === 'tcx') return parseTcx(input)
    if (format === 'fit') throw new Error('Expected FIT bytes or a FIT file path, received XML content.')
    return parseText(input)
  }

  // A format hint controls file decoding, not whether a string is a path.
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
  return parseBytes(toUint8(buf), format)
}

/** Shared decoder for files. Unhinted public byte input remains FIT-only. */
export function parseBytes(bytes: Uint8Array, format?: ParseOptions['format']): Activity {
  if (format === 'fit' || (format == null && isFit(bytes))) return parseFit(bytes)
  const text = new TextDecoder().decode(bytes)
  if (format === 'gpx') return parseGpx(text)
  if (format === 'tcx') return parseTcx(text)
  if (format != null) throw new Error(`Unsupported format hint: ${format}.`)
  return parseText(text)
}
