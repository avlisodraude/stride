import { parse } from './parser.js'
import { analyze } from './analyzer.js'
import { parseArgs, formatStats, HELP_TEXT, MISSING_FILE_ERROR } from './cli-lib.js'

const action = parseArgs(process.argv)

switch (action.kind) {
  case 'help':
    console.log(HELP_TEXT)
    break

  case 'missingFile':
    console.error(MISSING_FILE_ERROR)
    process.exit(1)
    break

  case 'analyze':
    try {
      const activity = parse(action.filePath)
      const stats = analyze(activity)
      console.log(formatStats(activity.name ?? action.filePath, stats, action.units))
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
    break
}
