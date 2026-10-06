module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { [/^.+\.ts$/.source]: ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.js'],
};
