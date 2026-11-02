// Read-only release checks. This script never builds, commits, tags or publishes.
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

try {
  const args = process.argv.slice(2)
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--tag' || !args[1])) {
    throw new Error('Usage: node scripts/release-preflight.mjs [--tag vX.Y.Z]')
  }
  const repository = git('rev-parse', '--show-toplevel')
  if (realpathSync(repository) !== realpathSync(process.cwd())) throw new Error('Run release checks from the repository root.')
  if (git('status', '--porcelain', '--untracked-files=normal')) {
    throw new Error('Release requires committed source. Commit or set aside tracked and untracked changes first.')
  }
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const numeric = '(?:0|[1-9]\\d*)'
  const identifier = `(?:${numeric}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`
  const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`)
  if (typeof version !== 'string' || !semver.test(version)) {
    throw new Error('package.json must contain a valid release version.')
  }
  const expected = `v${version}`
  const requested = args[1] ?? (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined)
  if (requested != null && requested !== expected) {
    throw new Error(`Release tag ${requested} does not match package.json version ${version}; expected ${expected}.`)
  }
  const head = git('rev-parse', '--verify', 'HEAD^{commit}')
  let tagCommit
  try { tagCommit = git('rev-parse', '--verify', `refs/tags/${expected}^{commit}`) }
  catch { throw new Error(`Release requires the ${expected} tag on the current committed source.`) }
  if (tagCommit !== head) throw new Error(`Release tag ${expected} points to a different commit.`)
  console.log(`Release preflight passed: ${expected} matches the current committed source.`)
} catch (error) {
  console.error(`Release preflight failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
