import { readdirSync } from 'node:fs'
import { extname } from 'node:path'
import { spawnSync } from 'node:child_process'

const formats = ['fit', 'gpx', 'tcx']
const files = readdirSync(new URL('../test/fixtures/real/', import.meta.url))
const available = formats.filter(format => files.some(file => extname(file).toLowerCase() === `.${format}`))
console.log(`Private export coverage: ${available.map(f => f.toUpperCase()).join(', ') || 'none'}`)
if (process.argv.includes('--require-all-formats')) {
  const missing = formats.filter(format => !available.includes(format))
  if (missing.length) {
    console.error(`Missing genuine export fixtures for: ${missing.map(f => f.toUpperCase()).join(', ')}. Synthetic or converted files do not satisfy this release check.`)
    process.exit(1)
  }
}
const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'node_modules/.bin/jest', '--runInBand', '--testMatch', '**/*.manual.test.js', '--testPathIgnorePatterns', '/node_modules/'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
