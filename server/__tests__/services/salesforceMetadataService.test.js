const salesforceMetadataService = require('../../services/salesforceMetadataService');
const { spawn } = require('child_process');

// Mock child_process
jest.mock('child_process');

describe('SalesforceMetadataService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractPrefix', () => {
    it('should extract 3-character prefix from Salesforce ID', () => {
      const prefix = salesforceMetadataService.extractPrefix('01t8s00000A8ZPRAA3');
      expect(prefix).toBe('01t');
    });

    it('should return null for invalid ID', () => {
      const prefix = salesforceMetadataService.extractPrefix('ab');
      expect(prefix).toBeNull();
    });

    it('should handle null input', () => {
      const prefix = salesforceMetadataService.extractPrefix(null);
      expect(prefix).toBeNull();
    });
  });

  describe('groupIdsByPrefix', () => {
    it('should group IDs by prefix', () => {
      const ids = [
        '01t8s00000A8ZPRAA3',
        '01t8s00000A8ZPSAA3',
        '00D8s000000pLGyEAM',
        '00D8s000000pLGzEAM',
      ];

      const grouped = salesforceMetadataService.groupIdsByPrefix(ids);

      expect(grouped['01t']).toHaveLength(2);
      expect(grouped['00D']).toHaveLength(2);
    });

    it('should filter out invalid IDs', () => {
      const ids = ['01t8s00000A8ZPRAA3', 'invalid', 'ab'];
      const grouped = salesforceMetadataService.groupIdsByPrefix(ids);

      expect(Object.keys(grouped)).toHaveLength(1);
      expect(grouped['01t']).toHaveLength(1);
    });

    it('should handle empty array', () => {
      const grouped = salesforceMetadataService.groupIdsByPrefix([]);
      expect(grouped).toEqual({});
    });
  });

  describe('buildSoqlQuery', () => {
    it('should build SOQL query for prefixes', () => {
      const prefixes = ['01t', '00D'];
      const query = salesforceMetadataService.buildSoqlQuery(prefixes);

      expect(query).toContain('SELECT KeyPrefix, QualifiedApiName FROM EntityDefinition');
      expect(query).toContain("KeyPrefix IN ('01t','00D')");
    });

    it('should handle single prefix', () => {
      const prefixes = ['01t'];
      const query = salesforceMetadataService.buildSoqlQuery(prefixes);

      expect(query).toContain("KeyPrefix IN ('01t')");
    });

    it('should handle empty array', () => {
      const query = salesforceMetadataService.buildSoqlQuery([]);
      expect(query).toContain("KeyPrefix IN ()");
    });
  });

  describe('parseSoqlResult', () => {
    it('should parse valid SOQL result', () => {
      const soqlOutput = JSON.stringify({
        result: {
          records: [
            { KeyPrefix: '01t', QualifiedApiName: 'Product2' },
            { KeyPrefix: '00D', QualifiedApiName: 'Organization' },
          ],
        },
      });

      const mapping = salesforceMetadataService.parseSoqlResult(soqlOutput);

      expect(mapping['01t']).toBe('Product2');
      expect(mapping['00D']).toBe('Organization');
    });

    it('should handle empty result', () => {
      const soqlOutput = JSON.stringify({
        result: { records: [] },
      });

      const mapping = salesforceMetadataService.parseSoqlResult(soqlOutput);
      expect(mapping).toEqual({});
    });

    it('should handle invalid JSON', () => {
      const mapping = salesforceMetadataService.parseSoqlResult('invalid json');
      expect(mapping).toEqual({});
    });

    it('should handle missing result field', () => {
      const soqlOutput = JSON.stringify({});
      const mapping = salesforceMetadataService.parseSoqlResult(soqlOutput);
      expect(mapping).toEqual({});
    });
  });

  describe('resolveIdPrefixes', () => {
    it('should resolve prefixes to SObject names', async () => {
      const mockSpawn = {
        stdout: {
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from(JSON.stringify({
                result: {
                  records: [
                    { KeyPrefix: '01t', QualifiedApiName: 'Product2' },
                  ],
                },
              })));
            }
          }),
        },
        stderr: { on: jest.fn() },
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            handler(0);
          }
        }),
      };

      spawn.mockReturnValue(mockSpawn);

      const ids = ['01t8s00000A8ZPRAA3'];
      const result = await salesforceMetadataService.resolveIdPrefixes(ids, 'test@example.com');

      expect(result.resolved['01t']).toBe('Product2');
      expect(result.objectTypes).toContain('Product2');
    });

    it('should handle empty ID list', async () => {
      const result = await salesforceMetadataService.resolveIdPrefixes([], 'test@example.com');

      expect(result.resolved).toEqual({});
      expect(result.objectTypes).toEqual([]);
      expect(result.unresolved).toEqual([]);
    });

    it('should handle command failure', async () => {
      const mockSpawn = {
        stdout: { on: jest.fn() },
        stderr: {
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('Error message'));
            }
          }),
        },
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            handler(1);
          }
        }),
      };

      spawn.mockReturnValue(mockSpawn);

      const ids = ['01t8s00000A8ZPRAA3'];
      const result = await salesforceMetadataService.resolveIdPrefixes(ids, 'test@example.com');

      expect(result.resolved).toEqual({});
      expect(result.unresolved).toContain('01t');
    });
  });

  describe('batchPrefixes', () => {
    it('should batch prefixes into groups', () => {
      const prefixes = Array.from({ length: 250 }, (_, i) => `0${i.toString().padStart(2, '0')}`);
      const batches = salesforceMetadataService.batchPrefixes(prefixes, 100);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(100);
      expect(batches[1]).toHaveLength(100);
      expect(batches[2]).toHaveLength(50);
    });

    it('should handle small arrays', () => {
      const prefixes = ['01t', '00D'];
      const batches = salesforceMetadataService.batchPrefixes(prefixes, 100);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual(prefixes);
    });

    it('should handle empty array', () => {
      const batches = salesforceMetadataService.batchPrefixes([], 100);
      expect(batches).toEqual([]);
    });
  });

  describe('getObjectTypeFromPrefix', () => {
    it('should return cached object type', () => {
      salesforceMetadataService.prefixCache = { '01t': 'Product2' };
      const objectType = salesforceMetadataService.getObjectTypeFromPrefix('01t');
      expect(objectType).toBe('Product2');
    });

    it('should return null for uncached prefix', () => {
      salesforceMetadataService.prefixCache = {};
      const objectType = salesforceMetadataService.getObjectTypeFromPrefix('01t');
      expect(objectType).toBeNull();
    });
  });

  describe('clearCache', () => {
    it('should clear the prefix cache', () => {
      salesforceMetadataService.prefixCache = { '01t': 'Product2' };
      salesforceMetadataService.clearCache();
      expect(salesforceMetadataService.prefixCache).toEqual({});
    });
  });
});

