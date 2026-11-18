const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripUnknownSettings } = require('../../services/backupService');

describe('backupService.stripUnknownSettings', () => {
  it('drops SET lines for settings the server does not know and keeps everything else', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-'));
    const src = path.join(dir, 'in.sql');
    const dst = path.join(dir, 'out.sql');
    fs.writeFileSync(src, [
      'SET statement_timeout = 0;',
      'SET transaction_timeout = 0;',
      "SET client_encoding = 'UTF8';",
      'CREATE TABLE t (id int);',
      "INSERT INTO t VALUES (1); -- SET transaction_timeout = 0; inside data is kept",
      '',
    ].join('\n'));

    const dropped = await stripUnknownSettings(src, dst, new Set(['statement_timeout', 'client_encoding']));

    expect(dropped).toEqual(['transaction_timeout']);
    const out = fs.readFileSync(dst, 'utf8');
    expect(out).not.toMatch(/^SET transaction_timeout/m);
    expect(out).toMatch(/^SET statement_timeout = 0;$/m);
    expect(out).toMatch(/CREATE TABLE t/);
    expect(out).toMatch(/-- SET transaction_timeout = 0; inside data is kept/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
