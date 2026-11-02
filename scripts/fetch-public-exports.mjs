// Download pinned upstream Garmin-export samples, never generated conversions.
// Activity data stays ignored and outside the published package.
import { readFile, mkdir, access, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const manifest = JSON.parse(await readFile(new URL('../test/public-exports.json', import.meta.url), 'utf8'))
const root = new URL('../test/fixtures/real/', import.meta.url)
const entries = [...manifest.fixtures, { file: 'public-exports.LICENSE.txt', url: manifest.licenseUrl, sha256: manifest.licenseSha256 }]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const downloads = []
for (const entry of entries) {
  const target = new URL(entry.file, root)
  let exists = false
  try { await access(target); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (exists) {
    if (hash(await readFile(target)) !== entry.sha256) throw new Error(`Existing ${entry.file} differs from its pinned checksum; preserve or move it before retrying.`)
    continue
  }
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Export download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (hash(bytes) !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.file}`)
  downloads.push({ target, bytes })
}
await mkdir(root, { recursive: true })
for (const { target, bytes } of downloads) await writeFile(target, bytes, { flag: 'wx' })
console.log(`Verified pinned GPX/TCX export samples and MIT license (${manifest.commit.slice(0, 12)}).`)
