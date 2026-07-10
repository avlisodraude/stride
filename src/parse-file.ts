import { readFile } from 'fs/promises'
import { parseFit, parseGpx, parseTcx, parseText, isFit, toUint8 } from './parser.js'
import type { Activity } from './types.js'

export interface ParseFileOptions {
  /** Skip format sniffing and parse the file as this format directly. */
  format?: 'gpx' | 'tcx' | 'fit'
}

/**
 * Read and parse a GPX, TCX or FIT file from disk (Node only).
 *
 * Unlike {@link parse}, this always reads via `fs/promises` — no path
 * vs. raw-content sniffing is needed since `path` is unambiguously a file path.
 */
export async function parseFile(path: string, options?: ParseFileOptions): Promise<Activity> {
  const buf = await readFile(path)

  if (options?.format === 'gpx') return parseGpx(buf.toString('utf-8'))
  if (options?.format === 'tcx') return parseTcx(buf.toString('utf-8'))
  if (options?.format === 'fit') return parseFit(toUint8(buf))

  const bytes = toUint8(buf)
  if (isFit(bytes)) return parseFit(bytes)
  return parseText(buf.toString('utf-8'))
}
