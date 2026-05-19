const fs = require('fs-extra');
const path = require('path');
const logStorageService = require('../../services/logStorageService');

describe('LogStorageService', () => {
  const testJobId = 'test-job-123';
  const testLogsDir = path.join(__dirname, '../fixtures/logs/jobs');

  beforeAll(async () => {
    // Override logs directory for testing
    logStorageService.logsDir = testLogsDir;
    await fs.ensureDir(testLogsDir);
  });

  afterEach(async () => {
    // Clean up test files
    await fs.emptyDir(testLogsDir);
  });

  afterAll(async () => {
    // Remove test directory
    await fs.remove(path.join(__dirname, '../fixtures'));
  });

  describe('getLogFilePath', () => {
    it('should return correct log file path', () => {
      const logPath = logStorageService.getLogFilePath(testJobId);
      expect(logPath).toContain(testJobId);
      expect(logPath).toEndWith('.log');
    });
  });

  describe('initializeLog', () => {
    it('should create log file with header', async () => {
      await logStorageService.initializeLog(testJobId, 'export', 'test-user');

      const logPath = logStorageService.getLogFilePath(testJobId);
      const content = await fs.readFile(logPath, 'utf8');

      expect(content).toContain('Job ID: test-job-123');
      expect(content).toContain('Type: export');
      expect(content).toContain('User: test-user');
    });

    it('should handle missing optional parameters', async () => {
      await logStorageService.initializeLog(testJobId);

      const logPath = logStorageService.getLogFilePath(testJobId);
      const exists = await fs.pathExists(logPath);

      expect(exists).toBe(true);
    });
  });

  describe('stripAnsi', () => {
    it('should remove ANSI color codes', () => {
      const input = '\x1b[32mGreen text\x1b[0m';
      const output = logStorageService.stripAnsi(input);
      expect(output).toBe('Green text');
    });

    it('should remove unicode ANSI codes', () => {
      const input = '\u001b[31mRed text\u001b[0m';
      const output = logStorageService.stripAnsi(input);
      expect(output).toBe('Red text');
    });

    it('should handle null or undefined', () => {
      expect(logStorageService.stripAnsi(null)).toBe('');
      expect(logStorageService.stripAnsi(undefined)).toBe('');
    });

    it('should handle text without ANSI codes', () => {
      const input = 'Normal text';
      const output = logStorageService.stripAnsi(input);
      expect(output).toBe('Normal text');
    });
  });

  describe('appendLog', () => {
    beforeEach(async () => {
      await logStorageService.initializeLog(testJobId);
    });

    it('should append log entry with timestamp', async () => {
      await logStorageService.appendLog(testJobId, 'Test message');

      const logPath = logStorageService.getLogFilePath(testJobId);
      const content = await fs.readFile(logPath, 'utf8');

      expect(content).toContain('Test message');
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
    });

    it('should strip ANSI codes from message', async () => {
      await logStorageService.appendLog(testJobId, '\x1b[32mColored message\x1b[0m');

      const logPath = logStorageService.getLogFilePath(testJobId);
      const content = await fs.readFile(logPath, 'utf8');

      expect(content).toContain('Colored message');
      expect(content).not.toContain('\x1b[32m');
    });

    it('should handle empty messages', async () => {
      await expect(logStorageService.appendLog(testJobId, '')).resolves.not.toThrow();
    });
  });

  describe('appendLogs', () => {
    beforeEach(async () => {
      await logStorageService.initializeLog(testJobId);
    });

    it('should append multiple log entries', async () => {
      const logs = [
        { timestamp: new Date(), message: 'First log' },
        { timestamp: new Date(), message: 'Second log' },
        { timestamp: new Date(), message: 'Third log' },
      ];

      await logStorageService.appendLogs(testJobId, logs);

      const logPath = logStorageService.getLogFilePath(testJobId);
      const content = await fs.readFile(logPath, 'utf8');

      expect(content).toContain('First log');
      expect(content).toContain('Second log');
      expect(content).toContain('Third log');
    });

    it('should handle empty logs array', async () => {
      await expect(logStorageService.appendLogs(testJobId, [])).resolves.not.toThrow();
    });

    it('should strip ANSI codes from all logs', async () => {
      const logs = [
        { timestamp: new Date(), message: '\x1b[31mRed\x1b[0m' },
        { timestamp: new Date(), message: '\x1b[32mGreen\x1b[0m' },
      ];

      await logStorageService.appendLogs(testJobId, logs);

      const logPath = logStorageService.getLogFilePath(testJobId);
      const content = await fs.readFile(logPath, 'utf8');

      expect(content).toContain('Red');
      expect(content).toContain('Green');
      expect(content).not.toContain('\x1b[');
    });
  });

  describe('readLogs', () => {
    beforeEach(async () => {
      await logStorageService.initializeLog(testJobId);
      await logStorageService.appendLog(testJobId, 'Log line 1');
      await logStorageService.appendLog(testJobId, 'Log line 2');
      await logStorageService.appendLog(testJobId, 'Log line 3');
      await logStorageService.appendLog(testJobId, 'Log line 4');
      await logStorageService.appendLog(testJobId, 'Log line 5');
    });

    it('should read all logs', async () => {
      const logs = await logStorageService.readLogs(testJobId);

      expect(logs.logs.length).toBeGreaterThan(0);
      expect(logs.totalLines).toBeGreaterThan(0);
    });

    it('should read logs with tail option', async () => {
      const logs = await logStorageService.readLogs(testJobId, { tail: 2 });

      expect(logs.logs.length).toBeLessThanOrEqual(2);
    });

    it('should read logs with skip and limit', async () => {
      const logs = await logStorageService.readLogs(testJobId, { skip: 1, limit: 2 });

      expect(logs.logs.length).toBeLessThanOrEqual(2);
      expect(logs.hasMore).toBeDefined();
    });

    it('should return empty array for non-existent job', async () => {
      const logs = await logStorageService.readLogs('non-existent-job');

      expect(logs.logs).toEqual([]);
      expect(logs.totalLines).toBe(0);
    });
  });

  describe('getLogStats', () => {
    beforeEach(async () => {
      await logStorageService.initializeLog(testJobId);
      await logStorageService.appendLog(testJobId, 'Test log');
    });

    it('should return log file statistics', async () => {
      const stats = await logStorageService.getLogStats(testJobId);

      expect(stats.exists).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.lines).toBeGreaterThan(0);
      expect(stats.created).toBeDefined();
      expect(stats.modified).toBeDefined();
    });

    it('should return non-existent stats for missing file', async () => {
      const stats = await logStorageService.getLogStats('non-existent-job');

      expect(stats.exists).toBe(false);
      expect(stats.size).toBe(0);
      expect(stats.lines).toBe(0);
    });
  });

  describe('getLogStream', () => {
    beforeEach(async () => {
      await logStorageService.initializeLog(testJobId);
      await logStorageService.appendLog(testJobId, 'Streaming test');
    });

    it('should return readable stream for log file', async () => {
      const stream = await logStorageService.getLogStream(testJobId);

      expect(stream).toBeTruthy();
      expect(typeof stream.pipe).toBe('function');

      // Clean up stream
      stream.destroy();
    });

    it('should throw error for non-existent file', async () => {
      await expect(logStorageService.getLogStream('non-existent-job')).rejects.toThrow();
    });
  });

  describe('clearLog', () => {
    beforeEach(async () => {
      await logStorageService.initializeLog(testJobId);
      await logStorageService.appendLog(testJobId, 'To be cleared');
    });

    it('should clear log file', async () => {
      await logStorageService.clearLog(testJobId);

      const logPath = logStorageService.getLogFilePath(testJobId);
      const exists = await fs.pathExists(logPath);

      expect(exists).toBe(false);
    });

    it('should not throw error for non-existent file', async () => {
      await expect(logStorageService.clearLog('non-existent-job')).resolves.not.toThrow();
    });
  });

  describe('logExists', () => {
    it('should return true for existing log', async () => {
      await logStorageService.initializeLog(testJobId);
      const exists = await logStorageService.logExists(testJobId);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent log', async () => {
      const exists = await logStorageService.logExists('non-existent-job');
      expect(exists).toBe(false);
    });
  });
});

