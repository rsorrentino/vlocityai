// Test setup file
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
process.env.DATABASE_URL = 'sqlite::memory:';
process.env.DB_TYPE = 'sqlite';
process.env.DISABLE_REDIS = 'true';

// Mock logger to reduce noise in tests
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  logError: jest.fn(),
  logOperation: jest.fn(),
  logVlocityOperation: jest.fn(),
}));

// Global test timeout
jest.setTimeout(10000);

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});

