/**
 * Jest needs --experimental-vm-modules to load native ES modules, which the
 * `test` script in package.json sets via NODE_OPTIONS. Without it every import
 * in these tests fails with "Cannot use import statement outside a module".
 */
export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Babel-based transforms are unnecessary: the source is already ESM and Node
  // runs it directly.
  transform: {},
  collectCoverageFrom: [
    'models/**/*.js',
    'middleware/**/*.js',
    'utils/**/*.js',
    'services/**/*.js',
  ],
  testTimeout: 15000,
};
