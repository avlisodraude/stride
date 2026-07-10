/**
 * Build the standalone browser bundle used by stride.alosha.dev/demo.
 *
 *   node scripts/build-browser.mjs [outfile]
 *
 * Produces a minified IIFE that exposes `window.Stride` with the full public
 * API (parse, analyze, formatters, chart configs). `chart.js` is left external
 * (the demo loads it from a CDN). The Node-only file-path branch of parse()
 * (backed by `fs`) is swapped out for its browser stub at bundle time, so
 * `fs` itself is never resolved into the bundle — no shim required.
 */
import esbuild from 'esbuild'
import path from 'path'

const outfile = process.argv[2] ?? 'dist/stride.browser.js'

const browserFileInput = {
  name: 'browser-file-input',
  setup(build) {
    build.onResolve({ filter: /^\.\/file-input\.js$/ }, (args) => ({
      path: path.resolve(path.dirname(args.importer), 'file-input.browser.ts'),
    }))
  },
}

await esbuild.build({
  entryPoints: ['src/index.browser.ts'],
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
  plugins: [browserFileInput],
  outfile,
})

console.log(`Built browser bundle → ${outfile}`)
