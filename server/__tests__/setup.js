// Test setup file
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only-0123456789';
process.env.DATABASE_URL = 'sqlite::memory:';
process.env.DB_TYPE = 'sqlite';
process.env.DISABLE_REDIS = 'true';
process.env.REDIS_AUTOSTART = 'false';

// Mock logger to reduce noise in tests. Every method (info, warn, logError,
// logJobVerbose, ...) is an auto-created jest.fn so new logging helpers never
// break unrelated tests.
jest.mock('../utils/logger', () => {
  const fns = {};
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then' || prop === '__esModule' || typeof prop === 'symbol') return undefined;
        if (!fns[prop]) fns[prop] = jest.fn();
        return fns[prop];
      },
    }
  );
});

// Global test timeout
jest.setTimeout(10000);

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});
