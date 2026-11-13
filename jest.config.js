module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js',
    '!server/models/index.js',
    '!server/config/**',
    '!server/**/*.test.js',
    '!server/**/*.spec.js',
  ],
  roots: ['<rootDir>/server'],
  testMatch: [
    '**/__tests__/**/*.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/client/'],
  // The codebase predates the test suite, so the global floor is a ratchet:
  // raise it as coverage grows, never lower it. Security-critical modules
  // added for MVP1 must stay well covered.
  coverageThreshold: {
    global: {
      branches: 5,
      functions: 11,
      lines: 14,
      statements: 13,
    },
    './server/utils/processRunner.js': { lines: 85, branches: 75 },
    './server/utils/secrets.js': { lines: 90, branches: 75 },
    './server/services/aiAdapters/githubCopilot.js': { lines: 85, branches: 60 },
    './server/services/aiAdapters/openaiAdapter.js': { lines: 85, branches: 70 },
  },
  setupFilesAfterEnv: ['<rootDir>/server/__tests__/setup.js'],
  testTimeout: 10000,
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};

