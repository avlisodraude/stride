import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, parseFile, analyze } from '../dist/index.js'
import { formatStats } from '../dist/cli-lib.js'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const gpx = '<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg></trk></gpx>'

describe('XML integrity', () => {
  test.each([
    '<gpx><trk><trkseg><trkpt lat="0" lon="0"/></trkseg></trk>',
    '<gpx><trk></gpx>', '<gpx/><gpx/>', '<gpx/><unrelated/>',
    '<gpx a="unclosed/>', '<gpx>&bad;</gpx>', '<gpx><trk a="1" a="2"/></gpx>',
    '<!-- broken -- comment --><gpx/>', '<gpx>bad]]>text</gpx>', '<gpx a="<bad"/>',
    '<gpx>\u0000</gpx>', '<gpx>&#0;</gpx>', '<gpx>&#xD800;</gpx>',
    '<gpx>&#x110000;</gpx>', '<gpx>&#;</gpx>',
  ])('rejects malformed XML (%s)', xml => {
    expect(() => parse(xml)).toThrow(/Invalid XML/)
  })

  test.each([['gpx', '<unrelated/>'], ['tcx', gpx], ['gpx', '<TrainingCenterDatabase/>']])('explicit %s parsing requires its root element', (format, xml) => {
    expect(() => parse(xml, { format })).toThrow(/Expected .* root element/)
  })

  test('accepts a declaration, BOM, comments, CDATA and predefined entities', () => {
    const input = '\ufeff<?xml version="1.0"?><!-- test --><gpx><metadata><name><![CDATA[Hill & valley]]></name></metadata><trk><name>A &amp; B</name></trk></gpx>'
    expect(parse(input).name).toBe('Hill & valley')
  })

  test('CDATA terminators are allowed in quoted attributes, comments and escaped text', () => {
    expect(parse('<gpx note="]]>"/><!-- ]]> -->').format).toBe('gpx')
    expect(parse('<gpx><metadata><name>]]&gt;</name></metadata></gpx>').name).toBe(']]>')
    expect(parse('<gpx><metadata><name><![CDATA[brackets ]] followed by >]]></name></metadata></gpx>').name)
      .toBe('brackets ]] followed by >')
  })
})

describe('consistent explicit formats', () => {
  test.each([
    ['gpx', 'gpx-climb.gpx'], ['tcx', 'sample-run.tcx'], ['fit', 'sample-run.fit'],
  ])('%s file paths agree with parseFile and automatic detection', async (format, name) => {
    const path = join(fixtures, name)
    expect(parse(path, { format })).toEqual(parse(path))
    expect(await parseFile(path, { format })).toEqual(parse(path))
  })

  test.each([['gpx', 'prefixed-run.gpx'], ['tcx', 'sample-run.tcx']])('%s hints support XML strings and UTF-8 bytes', (format, name) => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, name)))
    const expected = parse(new TextDecoder().decode(bytes))
    expect(parse(bytes, { format })).toEqual(expected)
    expect(parse(bytes.buffer, { format })).toEqual(expected)
    expect(parse(new TextDecoder().decode(bytes), { format })).toEqual(expected)
  })

  test('the hint overrides a misleading filename extension', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'stride-input-'))
    try {
      const path = join(directory, 'run.fit')
      writeFileSync(path, gpx)
      expect(parse(path, { format: 'gpx' }).points).toHaveLength(2)
      expect((await parseFile(path, { format: 'gpx' })).points).toHaveLength(2)
      await expect(parseFile(path, { format: 'tcx' })).rejects.toThrow(/Expected TCX/)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('a missing hinted path cannot silently produce an empty activity', () => {
    expect(() => parse(join(fixtures, 'missing.gpx'), { format: 'gpx' })).toThrow(/neither a readable path/)
  })

  test('rejects unknown hints and XML presented as FIT', () => {
    expect(() => parse(gpx, { format: 'unknown' })).toThrow(/Unsupported format hint/)
    expect(() => parse(gpx, { format: 'fit' })).toThrow(/Expected FIT/)
  })
})

describe('sensor value domains', () => {
  test.each([-20, 0])('drops non-positive XML heart rate (%i) and negative cadence', heartRate => {
    const xml = `<gpx><trk><trkseg><trkpt lat="0" lon="0"><extensions><TrackPointExtension><hr>${heartRate}</hr><cad>-10</cad></TrackPointExtension></extensions></trkpt></trkseg></trk></gpx>`
    expect(parse(xml).points).toEqual([{ lat: 0, lon: 0 }])
  })

  test('drops TCX negative sensors and retains a recorded zero cadence', () => {
    const tp = (hr, cad) => '<Trackpoint><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>0</LongitudeDegrees></Position>'
      + `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm><Extensions><TPX><RunCadence>${cad}</RunCadence></TPX></Extensions></Trackpoint>`
    const input = '<TrainingCenterDatabase><Activities><Activity><Lap><Track>' + tp(-20, -10) + tp(140, 0)
      + '</Track></Lap></Activity></Activities></TrainingCenterDatabase>'
    expect(parse(input).points).toEqual([{ lat: 0, lon: 0 }, { lat: 0, lon: 0, heartRate: 140, cadence: 0 }])
  })

  test.each([{ heartRate: -20 }, { heartRate: 0 }, { cadence: -20 }])('rejects invalid sensors in manually constructed activities (%j)', value => {
    expect(() => analyze({ format: 'gpx', points: [{ lat: 0, lon: 0, ...value }, { lat: 0, lon: 0.001 }] })).toThrow(/Invalid heartRate|Invalid cadence/)
  })

  test('zero cadence survives summaries and text output', () => {
    const stats = analyze({ format: 'gpx', points: [{ lat: 0, lon: 0, cadence: 0 }, { lat: 0, lon: 0.001, cadence: 0 }] })
    expect(stats.avgCadence).toBe(0)
    expect(formatStats('Stopped', stats)).toContain('Avg cadence:   0 spm')
  })
})
