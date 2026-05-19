const fs = require('fs-extra');
const path = require('path');
const errorLogParser = require('../../services/errorLogParser');

describe('ErrorLogParser Service', () => {
  const testLogPath = path.join(__dirname, '../fixtures/VlocityBuildErrors.log');
  const testOriginalJobPath = path.join(__dirname, '../fixtures/test-job.yaml');

  beforeAll(async () => {
    // Create fixtures directory
    await fs.ensureDir(path.join(__dirname, '../fixtures'));
  });

  afterAll(async () => {
    // Cleanup
    await fs.remove(path.join(__dirname, '../fixtures'));
  });

  describe('extractMissingIds', () => {
    it('should extract Salesforce IDs from error content', () => {
      const content = `
        SObject/Id: 01t8s00000A8ZPRAA3
        orgUrl: /a4A8s000000pLGxEAM
        Id '00D8s000000pLGyEAM' not found
        Missing record: 00P8s000000pLGzEAM
      `;

      const ids = errorLogParser.extractMissingIds(content);

      expect(ids).toContain('01t8s00000A8ZPRAA3');
      expect(ids).toContain('a4A8s000000pLGxEAM');
      expect(ids).toContain('00D8s000000pLGyEAM');
      expect(ids).toContain('00P8s000000pLGzEAM');
      expect(ids).toHaveLength(4);
    });

    it('should return empty array for content with no IDs', () => {
      const content = 'Some random error message without IDs';
      const ids = errorLogParser.extractMissingIds(content);
      expect(ids).toEqual([]);
    });

    it('should handle empty content', () => {
      const ids = errorLogParser.extractMissingIds('');
      expect(ids).toEqual([]);
    });
  });

  describe('extractFailedTypes', () => {
    it('should extract failed DataPack types', () => {
      const content = `
        Product2/My-Product-Name
        VlocityUITemplate/MyTemplate
        IntegrationProcedure/IP_GetAccountInfo
      `;

      const types = errorLogParser.extractFailedTypes(content);

      expect(types).toContain('Product2');
      expect(types).toContain('VlocityUITemplate');
      expect(types).toContain('IntegrationProcedure');
      expect(types).toHaveLength(3);
    });

    it('should return empty array for no failed types', () => {
      const content = 'No datapack types here';
      const types = errorLogParser.extractFailedTypes(content);
      expect(types).toEqual([]);
    });
  });

  describe('detectSettingsMismatch', () => {
    it('should detect settings mismatch', () => {
      const content = 'Error: Vlocity DataPack setting mismatch detected';
      expect(errorLogParser.detectSettingsMismatch(content)).toBe(true);
    });

    it('should detect settings mismatch case-insensitive', () => {
      const content = 'Settings do not match between orgs';
      expect(errorLogParser.detectSettingsMismatch(content)).toBe(true);
    });

    it('should return false for no settings mismatch', () => {
      const content = 'Some other error';
      expect(errorLogParser.detectSettingsMismatch(content)).toBe(false);
    });
  });

  describe('detectAuthErrors', () => {
    it('should detect InvalidAuthToken', () => {
      const content = 'Error: InvalidAuthToken';
      expect(errorLogParser.detectAuthErrors(content)).toBe(true);
    });

    it('should detect session expired', () => {
      const content = 'Session expired or invalid';
      expect(errorLogParser.detectAuthErrors(content)).toBe(true);
    });

    it('should return false for no auth errors', () => {
      const content = 'Some other error';
      expect(errorLogParser.detectAuthErrors(content)).toBe(false);
    });
  });

  describe('categorizeError', () => {
    it('should categorize missing dependency errors', () => {
      expect(errorLogParser.categorizeError('Record not found')).toBe('missing_dependency');
      expect(errorLogParser.categorizeError('Could not find ID')).toBe('missing_dependency');
    });

    it('should categorize settings mismatch', () => {
      expect(errorLogParser.categorizeError('Settings mismatch')).toBe('settings_mismatch');
    });

    it('should categorize authentication errors', () => {
      expect(errorLogParser.categorizeError('Authentication failed')).toBe('authentication');
    });

    it('should categorize timeout errors', () => {
      expect(errorLogParser.categorizeError('Request timed out')).toBe('timeout');
    });

    it('should categorize permission errors', () => {
      expect(errorLogParser.categorizeError('Access denied')).toBe('permission');
    });

    it('should categorize validation errors', () => {
      expect(errorLogParser.categorizeError('Invalid field value')).toBe('validation');
    });

    it('should categorize unknown errors', () => {
      expect(errorLogParser.categorizeError('Random error')).toBe('unknown');
    });
  });

  describe('parseVlocityErrors', () => {
    it('should return empty results for non-existent file', async () => {
      const result = await errorLogParser.parseVlocityErrors('/non/existent/file.log');
      
      expect(result.missingIds).toEqual([]);
      expect(result.failedTypes).toEqual([]);
      expect(result.settingsMismatch).toBe(false);
      expect(result.authErrors).toBe(false);
      expect(result.hasErrors).toBe(false);
    });

    it('should parse error log file', async () => {
      const errorContent = `
        SObject/Id: 01t8s00000A8ZPRAA3
        Product2/Test-Product
        Error: Vlocity settings mismatch
      `;

      await fs.writeFile(testLogPath, errorContent);

      const result = await errorLogParser.parseVlocityErrors(testLogPath);

      expect(result.missingIds.length).toBeGreaterThan(0);
      expect(result.failedTypes).toContain('Product2');
      expect(result.settingsMismatch).toBe(true);
      expect(result.hasErrors).toBe(true);

      await fs.remove(testLogPath);
    });
  });

  describe('buildRetryJob', () => {
    it('should build retry job from original job', async () => {
      const originalJob = `
projectPath: ./deploy
queries:
  - Product2
  - PricingElement__c
  - VlocityUITemplate
      `;

      const errorLog = `
Product2/Failed-Product
VlocityUITemplate/Failed-Template
      `;

      await fs.writeFile(testOriginalJobPath, originalJob);
      await fs.writeFile(testLogPath, errorLog);

      const retryJobPath = await errorLogParser.buildRetryJob(testOriginalJobPath, testLogPath);

      expect(retryJobPath).toBeTruthy();
      expect(retryJobPath).toContain('-retry.yaml');

      const retryJob = await fs.readFile(retryJobPath, 'utf8');
      expect(retryJob).toContain('Product2');
      expect(retryJob).toContain('VlocityUITemplate');

      await fs.remove(testOriginalJobPath);
      await fs.remove(testLogPath);
      await fs.remove(retryJobPath);
    });

    it('should return null when no failed types', async () => {
      const originalJob = 'projectPath: ./deploy\nqueries: []';
      const errorLog = 'No failed types here';

      await fs.writeFile(testOriginalJobPath, originalJob);
      await fs.writeFile(testLogPath, errorLog);

      const retryJobPath = await errorLogParser.buildRetryJob(testOriginalJobPath, testLogPath);

      expect(retryJobPath).toBeNull();

      await fs.remove(testOriginalJobPath);
      await fs.remove(testLogPath);
    });
  });

  describe('hasErrors', () => {
    it('should return false for non-existent error log', async () => {
      const hasErrors = await errorLogParser.hasErrors('/non/existent/error.log');
      expect(hasErrors).toBe(false);
    });

    it('should return false for empty error log', async () => {
      await fs.writeFile(testLogPath, '');
      const hasErrors = await errorLogParser.hasErrors(testLogPath);
      expect(hasErrors).toBe(false);
      await fs.remove(testLogPath);
    });

    it('should return true for error log with content', async () => {
      await fs.writeFile(testLogPath, 'Error content');
      const hasErrors = await errorLogParser.hasErrors(testLogPath);
      expect(hasErrors).toBe(true);
      await fs.remove(testLogPath);
    });
  });

  describe('clearErrorLog', () => {
    it('should clear error log file', async () => {
      await fs.writeFile(testLogPath, 'Error content');
      await errorLogParser.clearErrorLog(testLogPath);
      
      const exists = await fs.pathExists(testLogPath);
      expect(exists).toBe(false);
    });

    it('should not throw error for non-existent file', async () => {
      await expect(errorLogParser.clearErrorLog('/non/existent/file.log')).resolves.not.toThrow();
    });
  });
});

