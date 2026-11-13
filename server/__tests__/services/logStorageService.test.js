const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const logStorageService = require('../../services/logStorageService');

describe('LogStorageService', () => {
  let tmpDir;
  let originalDir;
  const jobId = 'test-job-123';

  beforeEach(async () => {
    originalDir = logStorageService.logsDir;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logstore-'));
    logStorageService.logsDir = tmpDir;
  });

  afterEach(async () => {
    logStorageService.logsDir = originalDir;
    await fs.remove(tmpDir);
  });

  describe('getLogFilePath', () => {
    it('returns <logsDir>/<jobId>.log', () => {
      expect(logStorageService.getLogFilePath(jobId)).toBe(path.join(tmpDir, `${jobId}.log`));
    });

    it.each(['../etc/passwd', '..\\windows\\win.ini', 'a/b', 'x\0y', ''])(
      'rejects path traversal in job id %p',
      (bad) => {
        expect(() => logStorageService.getLogFilePath(bad)).toThrow(/Invalid job id/);
      }
    );
  });

  describe('stripAnsi', () => {
    it('removes ANSI color codes', () => {
      expect(logStorageService.stripAnsi('\x1b[31mRed\x1b[0m text')).toBe('Red text');
    });

    it('handles null or undefined', () => {
      expect(logStorageService.stripAnsi(null)).toBe('');
      expect(logStorageService.stripAnsi(undefined)).toBe('');
    });
  });

  describe('isDeprecationWarning', () => {
    it.each([
      '(node:1234) [DEP0005] DeprecationWarning: Buffer() is deprecated',
      'Error >> 18',
      'Error: 42',
      '[INFO] Error >> 7',
    ])('filters %p', (msg) => {
      expect(logStorageService.isDeprecationWarning(msg)).toBe(true);
    });

    it('keeps real errors', () => {
      expect(logStorageService.isDeprecationWarning('Error: Product2 deploy failed')).toBe(false);
      expect(logStorageService.isDeprecationWarning('')).toBe(false);
    });
  });

  describe('appendLog / readLogs', () => {
    it('writes and reads back a structured entry', async () => {
      await logStorageService.appendLog(jobId, {
        timestamp: '2026-01-01T00:00:00.000Z',
        level: 'warn',
        message: '\x1b[33mCareful\x1b[0m',
      });
      const logs = await logStorageService.readLogs(jobId);
      expect(logs).toEqual([{ timestamp: '2026-01-01T00:00:00.000Z', level: 'warn', message: 'Careful' }]);
    });

    it('skips deprecation warnings', async () => {
      await logStorageService.appendLog(jobId, { message: '(node:1) [DEP0005] DeprecationWarning: x' });
      expect(await fs.pathExists(logStorageService.getLogFilePath(jobId))).toBe(false);
    });

    it('returns [] for a job without logs', async () => {
      expect(await logStorageService.readLogs('missing-job')).toEqual([]);
    });
  });

  describe('appendLogs', () => {
    it('appends several entries in one write', async () => {
      await logStorageService.appendLogs(jobId, [
        { message: 'one' },
        { message: 'Error >> 18' },
        { message: 'two', level: 'error' },
      ]);
      const logs = await logStorageService.readLogs(jobId);
      expect(logs.map((l) => l.message)).toEqual(['one', 'two']);
      expect(logs[1].level).toBe('error');
    });

    it('ignores an empty batch', async () => {
      await logStorageService.appendLogs(jobId, []);
      expect(await fs.pathExists(logStorageService.getLogFilePath(jobId))).toBe(false);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      await logStorageService.appendLogs(
        jobId,
        Array.from({ length: 10 }, (_, i) => ({ message: `line ${i}` }))
      );
    });

    it('readLogsPaginated returns a page and hasMore', async () => {
      const page = await logStorageService.readLogsPaginated(jobId, 2, 3);
      expect(page.logs.map((l) => l.message)).toEqual(['line 2', 'line 3', 'line 4']);
      expect(page).toMatchObject({ total: 10, offset: 2, limit: 3, hasMore: true });
    });

    it('readLastLogs returns the tail', async () => {
      const tail = await logStorageService.readLastLogs(jobId, 2);
      expect(tail.map((l) => l.message)).toEqual(['line 8', 'line 9']);
    });
  });

  describe('getLogStats / deleteLogs', () => {
    it('reports stats for an existing file', async () => {
      await logStorageService.appendLog(jobId, { message: 'hello' });
      const stats = await logStorageService.getLogStats(jobId);
      expect(stats.exists).toBe(true);
      expect(stats.lines).toBe(1);
      expect(stats.size).toBeGreaterThan(0);
    });

    it('reports a missing file', async () => {
      expect(await logStorageService.getLogStats('nope')).toEqual({ exists: false, size: 0, lines: 0 });
    });

    it('deletes the log file', async () => {
      await logStorageService.appendLog(jobId, { message: 'hello' });
      await logStorageService.deleteLogs(jobId);
      expect(await fs.pathExists(logStorageService.getLogFilePath(jobId))).toBe(false);
    });
  });

  describe('formatBytes', () => {
    it('formats sizes', () => {
      expect(logStorageService.formatBytes(0)).toBe('0 Bytes');
      expect(logStorageService.formatBytes(1024)).toBe('1 KB');
    });
  });
});
