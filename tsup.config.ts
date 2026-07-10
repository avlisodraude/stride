import { defineConfig } from 'tsup'
import path from 'path'
import type { Plugin as EsbuildPlugin } from 'esbuild'

// Browser builds must never pull in Node's `fs`. Redirect the file-path
// reading module to its browser stub instead of shimming `fs` itself, so the
// real file-path branch is simply absent from the bundle.
const browserFileInput: EsbuildPlugin = {
  name: 'browser-file-input',
  setup(build) {
    build.onResolve({ filter: /^\.\/file-input\.js$/ }, (args) => ({
      path: path.resolve(path.dirname(args.importer), 'file-input.browser.ts'),
    }))
  },
}

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node18',
    external: ['chart.js'],
  },
  {
    entry: { 'index.browser': 'src/index.browser.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    target: 'es2020',
    platform: 'browser',
    external: ['chart.js'],
    esbuildPlugins: [browserFileInput],
  },
  {
    entry: ['src/charts.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'node18',
    external: ['chart.js'],
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    sourcemap: true,
    target: 'node18',
  },
  {
    entry: ['src/cli-lib.ts'],
    format: ['esm'],
    sourcemap: true,
    target: 'node18',
  },
])
