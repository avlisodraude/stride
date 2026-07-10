// Browser entry point. Mirrors index.ts minus `parseFile`, which is fs-bound
// (uses fs/promises) and has no browser equivalent.
export { parse } from './parser.js'
export type { ParseOptions } from './parser.js'
export { analyze, formatPace, formatDistance, formatDuration } from './analyzer.js'
export type { AnalyzeOptions, HrZoneModel } from './analyzer.js'
export type {
  Activity,
  TrackPoint,
  ActivityStats,
  Split,
  HeartRateZones,
  ChartOptions,
  ChartType,
} from './types.js'
