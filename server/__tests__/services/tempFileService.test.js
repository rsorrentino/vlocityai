const tempFileService = require('../services/tempFileService');
const fs = require('fs-extra');
const path = require('path');

jest.mock('fs-extra');

describe('TempFileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tempFileService.disableKeepTmpMode();
    tempFileService.trackedFiles.clear();
  });

  describe('KEEP_TMP Mode', () => {
    it('should enable KEEP_TMP mode', () => {
      tempFileService.enableKeepTmpMode();
      expect(tempFileService.getKeepTmpMode()).toBe(true);
    });

    it('should disable KEEP_TMP mode', () => {
      tempFileService.enableKeepTmpMode();
      tempFileService.disableKeepTmpMode();
      expect(tempFileService.getKeepTmpMode()).toBe(false);
    });

    it('should set KEEP_TMP mode', () => {
      tempFileService.setKeepTmpMode(true);
      expect(tempFileService.getKeepTmpMode()).toBe(true);
    });
  });

  describe('Temp File Creation', () => {
    it('should create a temporary file', async () => {
      const jobId = 'test-job-123';
      const filename = 'test.txt';
      const content = 'Test content';
      
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      
      const filePath = await tempFileService.createTempFile(jobId, filename, content);
      
      expect(filePath).toBeDefined();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(tempFileService.getTrackedFiles(jobId).has(filePath)).toBe(true);
    });

    it('should track created files', async () => {
      const jobId = 'test-job-track';
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      
      await tempFileService.createTempFile(jobId, 'test.txt', 'content');
      
      const trackedFiles = tempFileService.getTrackedFiles(jobId);
      expect(trackedFiles.size).toBeGreaterThan(0);
    });
  });

  describe('Temp File Cleanup', () => {
    it('should skip cleanup when KEEP_TMP mode is enabled', async () => {
      const jobId = 'test-job-keep';
      tempFileService.enableKeepTmpMode();
      tempFileService.trackFile(jobId, '/path/to/file');
      
      fs.pathExists.mockResolvedValue(true);
      
      const result = await tempFileService.cleanupJobTempFiles(jobId);
      
      expect(result.cleaned).toBe(0);
      expect(result.retained).toBe(0);
    });

    it('should cleanup files when KEEP_TMP mode is disabled', async () => {
      const jobId = 'test-job-cleanup';
      tempFileService.disableKeepTmpMode();
      const filePath = '/path/to/file';
      tempFileService.trackFile(jobId, filePath);
      
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ isDirectory: jest.fn().mockReturnValue(false), size: 100 });
      fs.remove.mockResolvedValue();
      
      const result = await tempFileService.cleanupJobTempFiles(jobId);
      
      expect(result.cleaned).toBeGreaterThan(0);
      expect(tempFileService.getTrackedFiles(jobId).size).toBe(0);
    });

    it('should force cleanup even when KEEP_TMP mode is enabled', async () => {
      const jobId = 'test-job-force';
      tempFileService.enableKeepTmpMode();
      tempFileService.trackFile(jobId, '/path/to/file');
      
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ isDirectory: jest.fn().mockReturnValue(false), size: 100 });
      fs.remove.mockResolvedValue();
      
      const result = await tempFileService.cleanupJobTempFiles(jobId, true);
      
      expect(result.cleaned).toBeGreaterThan(0);
    });
  });

  describe('Temp File Statistics', () => {
    it('should get temp file statistics', async () => {
      const jobId = 'test-job-stats';
      tempFileService.trackFile(jobId, '/path/to/file1');
      tempFileService.trackFile(jobId, '/path/to/file2');
      
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 100 });
      
      const stats = await tempFileService.getTempFileStats();
      
      expect(stats.totalJobs).toBeGreaterThanOrEqual(0);
      expect(stats.totalFiles).toBeGreaterThanOrEqual(0);
    });
  });

  describe('File Tracking', () => {
    it('should track files for a job', () => {
      const jobId = 'test-job-track';
      const filePath = '/path/to/file';
      
      tempFileService.trackFile(jobId, filePath);
      
      const trackedFiles = tempFileService.getTrackedFiles(jobId);
      expect(trackedFiles.has(filePath)).toBe(true);
    });

    it('should untrack files', () => {
      const jobId = 'test-job-untrack';
      const filePath = '/path/to/file';
      
      tempFileService.trackFile(jobId, filePath);
      tempFileService.untrackFile(jobId, filePath);
      
      const trackedFiles = tempFileService.getTrackedFiles(jobId);
      expect(trackedFiles.has(filePath)).toBe(false);
    });
  });
});
