/**
 * Tests run as native ESM (Node's --experimental-vm-modules) against the built
 * output in dist/, so no Babel/ts-jest transform is required. Run `npm run
 * build` before `npm test` (the pretest script does this automatically).
 */
export default {
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  // `*.manual.test.js` suites depend on files that are not in the repository —
  // real watch exports carry home coordinates and are gitignored (see
  // test/fixtures/real/README.md). Left in the default run they would report
  // as "skipped" on every machine but the maintainer's, inflating the test
  // count with a suite that never executes. Run them with `npm run test:real`.
  testPathIgnorePatterns: ['/node_modules/', '\\.manual\\.test\\.js$'],
  moduleFileExtensions: ['js', 'mjs', 'json'],
}
