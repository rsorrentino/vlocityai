/**
 * Route files load some modules lazily inside handlers. A wrong relative path
 * there only fails when that request arrives, so resolve every relative
 * require() in every route file up front.
 */
const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../../routes');

function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

const cases = routeFiles(ROUTES_DIR).flatMap((file) => {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/require\((['"])(\.{1,2}\/[^'"]+)\1\)/g)].map((m) => [path.relative(ROUTES_DIR, file), m[2]]);
});

describe('route files', () => {
  it('have relative requires to check', () => {
    expect(cases.length).toBeGreaterThan(100);
  });

  it.each(cases)('%s: %s resolves', (file, target) => {
    expect(() => require.resolve(path.resolve(ROUTES_DIR, path.dirname(file), target))).not.toThrow();
  });
});
