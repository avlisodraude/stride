/**
 * Tests run as native ESM (Node's --experimental-vm-modules) against the built
 * output in dist/, so no Babel/ts-jest transform is required. Run `npm run
 * build` before `npm test` (the pretest script does this automatically).
 */
export default {
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  moduleFileExtensions: ['js', 'mjs', 'json'],
}
