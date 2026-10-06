module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { [/^.+\.ts$/.source]: ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
  // Booting Nest + Prisma + Redis on a cold run can exceed Jest's 5s default.
  testTimeout: 30_000,
  setupFiles: ['<rootDir>/test/setup-env.js'],
};
