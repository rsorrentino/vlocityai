const propertiesService = require('../services/propertiesService');
const fs = require('fs-extra');

jest.mock('fs-extra');

describe('PropertiesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    propertiesService.propertiesCache.clear();
  });

  describe('Properties Loading', () => {
    it('should load properties with fallback', async () => {
      const mockProperties = {
        'key1': 'value1',
        'key2': 'value2'
      };
      
      fs.pathExists.mockResolvedValue(true);
      fs.readFile.mockResolvedValue('key1=value1\nkey2=value2');
      
      const result = await propertiesService.loadProperties();
      
      expect(result).toHaveProperty('properties');
      expect(result).toHaveProperty('loadedFiles');
      expect(result.properties).toMatchObject(mockProperties);
    });

    it('should get a specific property', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readFile.mockResolvedValue('test.key=test.value');
      
      const value = await propertiesService.getProperty('test.key');
      
      expect(value).toBeDefined();
    });

    it('should return default value when property not found', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readFile.mockResolvedValue('other.key=other.value');
      
      const value = await propertiesService.getProperty('nonexistent.key', null, 'default');
      
      expect(value).toBe('default');
    });
  });

  describe('Properties Parsing', () => {
    it('should parse properties file content', () => {
      const content = 'key1=value1\nkey2=value2\n# This is a comment\nkey3=value3';
      
      const properties = propertiesService.parseProperties(content);
      
      expect(properties.key1).toBe('value1');
      expect(properties.key2).toBe('value2');
      expect(properties.key3).toBe('value3');
      expect(properties['#']).toBeUndefined();
    });

    it('should handle quoted values', () => {
      const content = 'key1="quoted value"\nkey2=\'single quoted\'';
      
      const properties = propertiesService.parseProperties(content);
      
      expect(properties.key1).toBe('quoted value');
      expect(properties.key2).toBe('single quoted');
    });
  });

  describe('Properties File Management', () => {
    it('should get available properties files', async () => {
      fs.readdir.mockResolvedValue(['vlocity.properties', 'default.properties', 'other.txt']);
      
      const files = await propertiesService.getAvailablePropertiesFiles();
      
      expect(Array.isArray(files)).toBe(true);
      expect(files.every(f => f.filename.endsWith('.properties'))).toBe(true);
    });

    it('should create a properties file', async () => {
      fs.writeFile.mockResolvedValue();
      
      const properties = { key1: 'value1', key2: 'value2' };
      const filePath = await propertiesService.createPropertiesFile('test.properties', properties);
      
      expect(filePath).toBeDefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should delete a properties file', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.remove.mockResolvedValue();
      
      const deleted = await propertiesService.deletePropertiesFile('test.properties');
      
      expect(deleted).toBe(true);
    });

    it('should return false when deleting non-existent file', async () => {
      fs.pathExists.mockResolvedValue(false);
      
      const deleted = await propertiesService.deletePropertiesFile('nonexistent.properties');
      
      expect(deleted).toBe(false);
    });
  });

  describe('Properties Validation', () => {
    it('should validate a properties file', async () => {
      fs.readFile.mockResolvedValue('key1=value1\nkey2=value2');
      
      const validation = await propertiesService.validatePropertiesFile('/path/to/file.properties');
      
      expect(validation).toHaveProperty('valid');
      expect(validation).toHaveProperty('errors');
      expect(validation).toHaveProperty('warnings');
    });

    it('should return invalid for non-existent file', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));
      
      const validation = await propertiesService.validatePropertiesFile('/path/to/nonexistent.properties');
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Cache Management', () => {
    it('should clear properties cache', () => {
      propertiesService.propertiesCache.set('test', {});
      expect(propertiesService.propertiesCache.size).toBeGreaterThan(0);
      
      propertiesService.clearCache();
      expect(propertiesService.propertiesCache.size).toBe(0);
    });
  });

  describe('Properties Statistics', () => {
    it('should get properties statistics', async () => {
      fs.readdir.mockResolvedValue(['vlocity.properties']);
      fs.pathExists.mockResolvedValue(true);
      fs.readFile.mockResolvedValue('key1=value1\nkey2=value2');
      
      const stats = await propertiesService.getPropertiesStats();
      
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('environments');
      expect(stats).toHaveProperty('totalProperties');
    });
  });
});
