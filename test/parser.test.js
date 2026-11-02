import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse, parseFile } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

describe('parse() input classification', () => {
  test('short invalid XML that does not start with "<" gets a clear error, not ENOENT', () => {
    const input = 'not-xml-and-not-a-path'
    expect(() => parse(input)).toThrow(
      /neither a readable path nor recognisable GPX\/TCX\/FIT/,
    )
    expect(() => parse(input)).not.toThrow(/ENOENT/)
  })

  test('error message includes a truncated preview of the bad input', () => {
    const input = 'x'.repeat(200)
    try {
      parse(input)
      throw new Error('expected parse() to throw')
    } catch (err) {
      expect(err.message).toContain('x'.repeat(40))
      expect(err.message).not.toContain('x'.repeat(41))
    }
  })

  test('a format hint does not accept garbage before the XML root', () => {
    const gpx =
      'garbage-prefix<gpx><trk><name>X</name><trkseg>' +
      '<trkpt lat="52.1" lon="4.9"></trkpt></trkseg></trk></gpx>'
    expect(() => parse(gpx, { format: 'gpx' })).toThrow()
  })
})

describe('parseFile()', () => {
  test('resolves for a GPX file', async () => {
    const activity = await parseFile(join(fixtures, 'gpx-single-trk-single-seg.gpx'))
    expect(activity.format).toBe('gpx')
  })

  test('resolves for a TCX file', async () => {
    const activity = await parseFile(join(fixtures, 'sample-run.tcx'))
    expect(activity.format).toBe('tcx')
  })

  test('resolves for a FIT file', async () => {
    const activity = await parseFile(join(fixtures, 'sample-run.fit'))
    expect(activity.format).toBe('fit')
  })

  test('rejects for a missing file', async () => {
    await expect(parseFile(join(fixtures, 'does-not-exist.gpx'))).rejects.toThrow()
  })
})
