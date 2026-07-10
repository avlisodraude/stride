import fs from 'fs'

export function readInputFile(path: string): Buffer {
  return fs.readFileSync(path)
}
