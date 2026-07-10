export function readInputFile(_path: string): Buffer {
  throw new Error(
    'Stride: file paths are not supported in the browser — ' +
      'pass GPX file contents (string) or FIT bytes (Uint8Array) to parse() instead.',
  )
}
