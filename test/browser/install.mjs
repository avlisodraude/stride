import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('./', import.meta.url))
const environment = { ...process.env }
for (const key of Object.keys(environment)) {
  if (key.toLowerCase() === 'npm_config_allow_scripts') delete environment[key]
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
execFileSync(npm, ['ci', '--ignore-scripts'], { cwd: directory, env: environment, stdio: 'inherit' })
// An explicitly selected installed Chrome channel needs no browser download.
if (!process.env.STRIDE_BROWSER_CHANNEL) {
  execFileSync(process.execPath, [fileURLToPath(new URL('./node_modules/playwright/cli.js', import.meta.url)), 'install', 'chromium', ...process.argv.slice(2)], {
    cwd: directory, env: environment, stdio: 'inherit',
  })
}
