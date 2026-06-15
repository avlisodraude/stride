/**
 * Build the standalone browser bundle used by stride.alosha.dev/demo.
 *
 *   node scripts/build-browser.mjs [outfile]
 *
 * Produces a minified IIFE that exposes `window.Stride` with the full public
 * API (parse, analyze, formatters, chart configs). `chart.js` is left external
 * (the demo loads it from a CDN). Node's `fs` is replaced with a browser stub,
 * since file-path input only applies in Node — the browser passes a GPX string
 * or FIT bytes directly.
 */
import esbuild from 'esbuild'

const outfile = process.argv[2] ?? 'dist/stride.browser.js'

const fsStub = {
  name: 'fs-stub',
  setup(build) {
    build.onResolve({ filter: /^(node:)?fs$/ }, () => ({ path: 'fs', namespace: 'fs-stub' }))
    build.onLoad({ filter: /.*/, namespace: 'fs-stub' }, () => ({
      contents: `
        function readFileSync() {
          throw new Error(
            'Stride: file paths are not supported in the browser — ' +
            'pass GPX file contents (string) or FIT bytes (Uint8Array) to parse() instead.'
          )
        }
        export default { readFileSync }
        export { readFileSync }
      `,
    }))
  },
}

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'Stride',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  external: ['chart.js'],
  banner: {
    js: '/* @alosha/stride browser bundle — built from src for stride.alosha.dev/demo. Do not edit. */',
  },
  plugins: [fsStub],
  outfile,
})

console.log(`Built browser bundle → ${outfile}`)
