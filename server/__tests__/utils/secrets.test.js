const fs = require('fs');
const os = require('os');
const path = require('path');
const secrets = require('../../utils/secrets');

describe('secrets', () => {
  const saved = {};
  let tmpDir;

  beforeEach(() => {
    for (const k of ['NODE_ENV', 'JWT_SECRET', 'DATA_DIR', 'APP_ENCRYPTION_KEY']) saved[k] = process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'));
    process.env.DATA_DIR = tmpDir;
    secrets._resetForTests();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    secrets._resetForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses JWT_SECRET when provided', () => {
    process.env.JWT_SECRET = 'x'.repeat(40);
    expect(secrets.getJwtSecret()).toBe('x'.repeat(40));
  });

  it('refuses to start in production without JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    expect(() => secrets.getJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it('refuses a short JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    expect(() => secrets.getJwtSecret()).toThrow(/at least 32/);
  });

  it('generates and persists a secret in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const first = secrets.getJwtSecret();
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(fs.readFileSync(path.join(tmpDir, '.jwt-secret'), 'utf8')).toBe(first);

    secrets._resetForTests();
    expect(secrets.getJwtSecret()).toBe(first);
  });

  it('encrypts and decrypts round-trip with authentication', () => {
    process.env.JWT_SECRET = 'y'.repeat(40);
    const sealed = secrets.encrypt('gho_secret_token');
    expect(sealed).not.toContain('gho_secret_token');
    expect(secrets.decrypt(sealed)).toBe('gho_secret_token');

    const tampered = Buffer.from(sealed, 'base64');
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => secrets.decrypt(tampered.toString('base64'))).toThrow();
  });

  it('cannot decrypt with a different key', () => {
    process.env.JWT_SECRET = 'y'.repeat(40);
    const sealed = secrets.encrypt('gho_secret_token');
    process.env.APP_ENCRYPTION_KEY = 'another-key';
    expect(() => secrets.decrypt(sealed)).toThrow();
  });
});
