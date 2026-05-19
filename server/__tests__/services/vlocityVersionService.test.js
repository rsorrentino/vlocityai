const vlocityVersionService = require('../services/vlocityVersionService');

describe('VlocityVersionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vlocityVersionService.versionCache.clear();
  });

  describe('Version Management', () => {
    it('should get default version', () => {
      const defaultVersion = vlocityVersionService.getDefaultVersion();
      expect(defaultVersion).toBeDefined();
      expect(typeof defaultVersion).toBe('string');
    });

    it('should get available versions', () => {
      const versions = vlocityVersionService.getAvailableVersions();
      expect(Array.isArray(versions)).toBe(true);
    });

    it('should add a version', () => {
      const version = '1.17.19';
      vlocityVersionService.addVersion(version);
      
      const versions = vlocityVersionService.getAvailableVersions();
      expect(versions).toContain(version);
    });

    it('should remove a version', () => {
      const version = '1.17.20';
      vlocityVersionService.addVersion(version);
      
      const removed = vlocityVersionService.removeVersion(version);
      expect(removed).toBe(true);
      
      const versions = vlocityVersionService.getAvailableVersions();
      expect(versions).not.toContain(version);
    });

    it('should get version command', () => {
      const defaultVersion = vlocityVersionService.getDefaultVersion();
      const command = vlocityVersionService.getVersionCommand(defaultVersion);
      expect(command).toBe('vlocity');
      
      const otherVersion = '1.17.19';
      const otherCommand = vlocityVersionService.getVersionCommand(otherVersion);
      expect(otherCommand).toBe(`vlocity@${otherVersion}`);
    });
  });

  describe('Version Validation', () => {
    it('should get job version info', () => {
      const versionInfo = vlocityVersionService.getJobVersionInfo();
      
      expect(versionInfo).toHaveProperty('version');
      expect(versionInfo).toHaveProperty('command');
      expect(versionInfo).toHaveProperty('isAvailable');
      expect(versionInfo).toHaveProperty('isDefault');
    });

    it('should get job version info with specific version', () => {
      const version = '1.17.18';
      const versionInfo = vlocityVersionService.getJobVersionInfo(version);
      
      expect(versionInfo.version).toBe(version);
    });

    it('should validate job version', async () => {
      const defaultVersion = vlocityVersionService.getDefaultVersion();
      const validation = await vlocityVersionService.validateJobVersion(defaultVersion);
      
      expect(validation.valid).toBe(true);
      expect(validation.version).toBeDefined();
      expect(validation.command).toBeDefined();
    });

    it('should validate job version with null (should use default)', async () => {
      const validation = await vlocityVersionService.validateJobVersion(null);
      
      expect(validation.valid).toBe(true);
      expect(validation.version).toBeDefined();
    });
  });

  describe('Version Statistics', () => {
    it('should get version statistics', () => {
      const stats = vlocityVersionService.getVersionStats();
      
      expect(stats).toHaveProperty('defaultVersion');
      expect(stats).toHaveProperty('availableVersions');
      expect(stats).toHaveProperty('totalVersions');
      expect(stats).toHaveProperty('cacheSize');
    });
  });

  describe('Cache Management', () => {
    it('should clear version cache', () => {
      vlocityVersionService.versionCache.set('test', true);
      expect(vlocityVersionService.versionCache.size).toBeGreaterThan(0);
      
      vlocityVersionService.clearCache();
      expect(vlocityVersionService.versionCache.size).toBe(0);
    });
  });

  describe('Default Version', () => {
    it('should set default version if available', () => {
      const version = '1.17.18';
      vlocityVersionService.addVersion(version);
      
      const success = vlocityVersionService.setDefaultVersion(version);
      expect(success).toBe(true);
      
      const defaultVersion = vlocityVersionService.getDefaultVersion();
      expect(defaultVersion).toBe(version);
    });

    it('should not set default version if not available', () => {
      const version = '999.999.999';
      const success = vlocityVersionService.setDefaultVersion(version);
      expect(success).toBe(false);
    });
  });
});
