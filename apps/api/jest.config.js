/** Unit tests live next to the code as *.spec.ts */
module.exports = {
  rootDir: 'src',
  testRegex: /\.spec\.ts$/.source,
  transform: { [/^.+\.ts$/.source]: ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/setup-env.js'],
};
