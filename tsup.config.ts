import { defineConfig } from 'tsup'

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
