import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, devNull } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/release-preflight.mjs', import.meta.url))
let directory
const environment = {
  ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
  GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '',
}

function git(...args) {
  return execFileSync('git', args, { cwd: directory, env: environment, encoding: 'utf8', stdio: 'pipe' })
}
function commit(message = 'fixture') { git('add', '.'); git('commit', '-qm', message) }
function check(args = [], env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: directory, env: { ...environment, ...env }, encoding: 'utf8',
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'stride-release-'))
  git('init', '-q')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'release-test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  mkdirSync(join(directory, 'empty-hooks'))
  git('config', 'core.hooksPath', join(directory, 'empty-hooks'))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'release-fixture', version: '2.3.4' }))
  writeFileSync(join(directory, '.gitignore'), 'test-results/\n')
  commit()
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

test('a clean checkout with the matching lightweight tag passes', () => {
  git('tag', 'v2.3.4')
  expect(check().status).toBe(0)
})

test('an annotated version tag passes', () => {
  git('tag', '-a', 'v2.3.4', '-m', 'release')
  expect(check().status).toBe(0)
})

test('an explicit tag must match package.json', () => {
  git('tag', 'v2.3.4')
  const result = check(['--tag', 'v9.9.9'])
  expect(result.status).toBe(1)
  expect(result.output).toMatch(/does not match package.json/)
})

test('the GitHub release tag must match package.json', () => {
  git('tag', 'v2.3.4')
  const result = check([], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v9.9.9' })
  expect(result.status).toBe(1)
  expect(result.output).toMatch(/does not match package.json/)
})

test('tracked edits block publishing', () => {
  git('tag', 'v2.3.4')
  writeFileSync(join(directory, 'package.json'), '{"version":"2.3.5"}')
  expect(check().output).toMatch(/requires committed source/)
  expect(check().status).toBe(1)
})

test('untracked source blocks publishing', () => {
  git('tag', 'v2.3.4')
  writeFileSync(join(directory, 'new-source.js'), 'export const unfinished = true')
  expect(check().status).toBe(1)
})

test('ignored test artifacts do not make a release dirty', () => {
  git('tag', 'v2.3.4')
  mkdirSync(join(directory, 'test-results'))
  writeFileSync(join(directory, 'test-results', 'image.png'), 'fixture')
  expect(check().status).toBe(0)
})

test('a missing version tag blocks publishing', () => {
  expect(check().status).toBe(1)
  expect(check().output).toMatch(/requires the v2.3.4 tag/)
})

test('a matching tag pointing at an older commit is rejected', () => {
  git('tag', 'v2.3.4')
  writeFileSync(join(directory, 'source.js'), 'export const updated = true')
  commit('newer source')
  expect(check().status).toBe(1)
  expect(check().output).toMatch(/different commit/)
})

test.each(['1.2', '01.2.3', '1.2.3-01', '1.2.3-rc..1'])('invalid release version %s is rejected', version => {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }))
  commit()
  expect(check().status).toBe(1)
  expect(check().output).toMatch(/valid release version/)
})

test('valid prerelease versions can be checked without publishing', () => {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '2.3.4-rc.1' }))
  commit()
  git('tag', 'v2.3.4-rc.1')
  expect(check().status).toBe(0)
})
