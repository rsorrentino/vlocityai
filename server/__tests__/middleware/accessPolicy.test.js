const { evaluate } = require('../../middleware/accessPolicy');
const authService = require('../../services/authService');

const users = {
  admin: { role: 'admin', permissions: authService.getRolePermissions('admin') },
  developer: { role: 'developer', permissions: authService.getRolePermissions('developer') },
  functional: { role: 'functional', permissions: authService.getRolePermissions('functional') },
};

const allowed = (role, method, path) => evaluate({ method, path, user: users[role] }).allowed;

describe('accessPolicy.evaluate', () => {
  it.each([
    // [role, method, path, expected]
    // Everyone can read jobs and run them
    ['functional', 'GET', '/api/jobs', true],
    ['functional', 'POST', '/api/exports/run', true],
    ['functional', 'POST', '/api/deploys/jobs/abc/abort', true],
    ['functional', 'POST', '/api/exports/preflight', true],
    ['functional', 'POST', '/api/deploys/validate', true],
    // ...but only developers create/edit job definitions
    ['functional', 'POST', '/api/exports/create-job', false],
    ['developer', 'POST', '/api/exports/create-job', true],
    ['functional', 'PUT', '/api/deploys/jobs/abc', false],
    // Delete is admin-only in the permission matrix
    ['developer', 'DELETE', '/api/jobs/123', false],
    ['admin', 'DELETE', '/api/jobs/123', true],
    // Developer tools
    ['functional', 'POST', '/api/vlocity-commands/packExport/execute', false],
    ['developer', 'POST', '/api/vlocity-commands/packExport/execute', true],
    ['functional', 'POST', '/api/salesforce/apex/execute', false],
    // Administration
    ['developer', 'GET', '/api/audit/logs', false],
    ['developer', 'POST', '/api/backup/create', false],
    ['admin', 'POST', '/api/backup/restore', true],
    ['developer', 'GET', '/api/config/settings', true],
    ['developer', 'POST', '/api/config/settings', false],
    ['functional', 'GET', '/api/config/settings', false],
    ['developer', 'POST', '/api/logging/verbose', false],
    // Orgs
    ['functional', 'GET', '/api/orgs', true],
    ['functional', 'POST', '/api/orgs/sync', false],
    ['functional', 'POST', '/api/orgs/test-connection', true],
    ['developer', 'POST', '/api/orgs/sync', true],
    ['functional', 'POST', '/api/system/run-auth-command', false],
    ['developer', 'POST', '/api/system/run-auth-command', true],
    ['developer', 'POST', '/api/org-auth/device/start', true],
    ['functional', 'POST', '/api/org-auth/device/start', false],
    // Configuration vs pricing
    ['functional', 'POST', '/api/catalog/products', false],
    ['developer', 'POST', '/api/catalog/products', true],
    ['functional', 'PATCH', '/api/catalog/price-lists/a01/entries/b02', true],
    ['functional', 'POST', '/api/catalog/promotions', true],
    ['functional', 'POST', '/api/yaml/configs', false],
    ['functional', 'POST', '/api/yaml/validate', true],
    ['functional', 'POST', '/api/validation/pricing', true],
    ['functional', 'POST', '/api/validation/fix', false],
    ['functional', 'POST', '/api/sfdmu/configs/7/run', true],
    ['functional', 'POST', '/api/sfdmu/configs', false],
    // Self-service areas
    ['functional', 'PUT', '/api/auth/profile', true],
    ['functional', 'POST', '/api/chat/message', true],
    ['functional', 'PUT', '/api/notifications/read-all', true],
    // Unknown endpoints fail closed for non-admins
    ['developer', 'GET', '/api/brand-new-thing', false],
    ['admin', 'GET', '/api/brand-new-thing', true],
  ])('%s %s %s -> %s', (role, method, path, expected) => {
    expect(allowed(role, method, path)).toBe(expected);
  });

  it('explains why access was denied', () => {
    const d = evaluate({ method: 'POST', path: '/api/exports/create-job', user: users.functional });
    expect(d).toMatchObject({ allowed: false, resource: 'jobs', action: 'write' });
    expect(d.reason).toMatch(/write on jobs/);
  });
});
