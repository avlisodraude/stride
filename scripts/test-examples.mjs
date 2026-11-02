import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../examples/', import.meta.url))
const environment = { ...process.env }
// Do not pass npm's parent-project allow-scripts option into this project.
for (const key of Object.keys(environment)) {
  if (key.toLowerCase() === 'npm_config_allow_scripts') delete environment[key]
}
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts'], {
  cwd: directory, env: environment, stdio: 'inherit',
})
for (const file of readdirSync(directory).filter(name => /^\d.*\.mjs$/.test(name)).sort()) {
  execFileSync(process.execPath, [file], { cwd: directory, encoding: 'utf8', stdio: 'pipe' })
  console.log(`PASS ${file}`)
}
