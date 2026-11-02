import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, parseFile, analyze } from '../dist/index.js'

const point = lon => `<Trackpoint><Position><LatitudeDegrees>0</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position></Trackpoint>`
const lap = start => `<Lap><Track>${point(start)}${point(start + 0.001)}</Track></Lap>`
const activity = (sport, start) => `<Activity Sport="${sport}">${lap(start)}</Activity>`
const document = activities => `<TrainingCenterDatabase><Activities>${activities}</Activities></TrainingCenterDatabase>`

test('rejects multiple TCX activities instead of creating a 111 km artificial jump', () => {
  const xml = document(activity('Running', 0) + activity('Biking', 1))
  expect(() => parse(xml)).toThrow(/TCX contains multiple activities/)
  expect(() => parse(xml, { format: 'tcx' })).toThrow(/one activity per file/)
  expect(() => parse(new TextEncoder().encode(xml), { format: 'tcx' })).toThrow(/multiple activities/)
})

test('file input enforces the same single-activity contract', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stride-tcx-'))
  try {
    const path = join(directory, 'activities.tcx')
    writeFileSync(path, document(activity('Running', 0) + activity('Running', 1)))
    expect(() => parse(path)).toThrow(/multiple activities/)
    await expect(parseFile(path)).rejects.toThrow(/multiple activities/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('one activity with multiple laps remains supported', () => {
  const parsed = parse(document(`<Activity Sport="Running">${lap(0)}${lap(0.001)}</Activity>`))
  expect(parsed.type).toBe('running')
  expect(parsed.points).toHaveLength(4)
  expect(analyze(parsed).distanceM).toBe(222)
})
