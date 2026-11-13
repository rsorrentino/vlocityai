const { EventEmitter } = require('events');

jest.mock('../../utils/processRunner', () => ({ spawnSafe: jest.fn() }));

const { spawnSafe } = require('../../utils/processRunner');
const salesforceMetadataService = require('../../services/salesforceMetadataService');

function fakeChild({ stdout = '', stderr = '', code = 0, error = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    if (error) {
      child.emit('error', error);
      return;
    }
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

const records = (rows) => JSON.stringify({ status: 0, result: { records: rows } });

describe('SalesforceMetadataService', () => {
  beforeEach(() => {
    spawnSafe.mockReset();
  });

  describe('resolveIdPrefixes', () => {
    it('resolves prefixes to SObject names', async () => {
      spawnSafe.mockImplementation(() => fakeChild({
        stdout: records([
          { KeyPrefix: '01t', QualifiedApiName: 'Product2' },
          { KeyPrefix: 'a0X', QualifiedApiName: 'vlocity_cmt__Catalog__c' },
        ]),
      }));

      const map = await salesforceMetadataService.resolveIdPrefixes(
        ['01t8s00000A8ZPRAA3', '01t8s00000A8ZPSAA3', 'a0X8s00000ABCDEFGH'],
        'user@example.com'
      );

      expect(map.get('01t')).toBe('Product2');
      expect(map.get('a0X')).toBe('vlocity_cmt__Catalog__c');
      expect(spawnSafe).toHaveBeenCalledTimes(1);
    });

    it('passes the username as a separate argv entry (no shell interpolation)', async () => {
      spawnSafe.mockImplementation(() => fakeChild({ stdout: records([]) }));
      const evil = 'user@example.com; rm -rf /';

      await salesforceMetadataService.resolveIdPrefixes(['01t8s00000A8ZPRAA3'], evil);

      const [cmd, args, opts] = spawnSafe.mock.calls[0];
      expect(cmd).toBe('sf');
      expect(args).toEqual(expect.arrayContaining(['--target-org', evil]));
      expect(opts.shell).toBeUndefined();
    });

    it('returns an empty map for no ids', async () => {
      const map = await salesforceMetadataService.resolveIdPrefixes([], 'u');
      expect(map.size).toBe(0);
      expect(spawnSafe).not.toHaveBeenCalled();
    });

    it('rejects when the CLI fails', async () => {
      spawnSafe.mockImplementation(() => fakeChild({ code: 1, stderr: 'No authorization' }));
      await expect(
        salesforceMetadataService.resolveIdPrefixes(['01t8s00000A8ZPRAA3'], 'u')
      ).rejects.toThrow(/No authorization/);
    });

    it('strips ANSI colours before parsing JSON', async () => {
      spawnSafe.mockImplementation(() => fakeChild({
        stdout: `\x1b[32m${records([{ KeyPrefix: '01t', QualifiedApiName: 'Product2' }])}\x1b[0m`,
      }));
      const map = await salesforceMetadataService.resolveIdPrefixes(['01t8s00000A8ZPRAA3'], 'u');
      expect(map.get('01t')).toBe('Product2');
    });
  });

  describe('mapIdsToObjects', () => {
    it('groups ids by object', () => {
      const prefixMap = new Map([['01t', 'Product2']]);
      const result = salesforceMetadataService.mapIdsToObjects(
        ['01t8s00000A8ZPRAA3', '01t8s00000A8ZPSAA3', 'zzz000000000000', 'ab'],
        prefixMap
      );
      expect(result.get('Product2')).toHaveLength(2);
      expect(result.size).toBe(1);
    });
  });

  describe('queryRecords', () => {
    it('waits for every chunk and returns the records', async () => {
      spawnSafe.mockImplementation(() => fakeChild({ stdout: records([{ Id: '01t8s00000A8ZPRAA3', Name: 'Hearing aid' }]) }));
      const rows = await salesforceMetadataService.queryRecords('Product2', ['01t8s00000A8ZPRAA3'], 'u');
      expect(rows).toEqual([{ Id: '01t8s00000A8ZPRAA3', Name: 'Hearing aid' }]);
    });

    it('drops ids that are not Salesforce ids', async () => {
      spawnSafe.mockImplementation(() => fakeChild({ stdout: records([]) }));
      await salesforceMetadataService.queryRecords('Product2', ["01t8s00000A8ZPRAA3", "x' OR Name != '"], 'u');
      const soql = spawnSafe.mock.calls[0][1][3];
      expect(soql).toContain("'01t8s00000A8ZPRAA3'");
      expect(soql).not.toContain('OR Name');
    });

    it('rejects invalid object names', async () => {
      await expect(
        salesforceMetadataService.queryRecords('Product2 WHERE Id != null', ['01t8s00000A8ZPRAA3'], 'u')
      ).rejects.toThrow(/Invalid Salesforce object name/);
    });
  });

  describe('getObjectInfo', () => {
    it('returns the first EntityDefinition row', async () => {
      spawnSafe.mockImplementation(() => fakeChild({ stdout: records([{ QualifiedApiName: 'Product2', KeyPrefix: '01t' }]) }));
      await expect(salesforceMetadataService.getObjectInfo('Product2', 'u')).resolves.toMatchObject({ KeyPrefix: '01t' });
    });

    it('returns null when nothing matches', async () => {
      spawnSafe.mockImplementation(() => fakeChild({ stdout: records([]) }));
      await expect(salesforceMetadataService.getObjectInfo('Product2', 'u')).resolves.toBeNull();
    });
  });
});
