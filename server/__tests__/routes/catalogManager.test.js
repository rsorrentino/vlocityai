/**
 * Every Catalog Manager route, with the Salesforce-facing services mocked:
 * each one answers, passes the org username through, and refuses a request
 * that has no username.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogManagerService', () => {
  const calls = [];
  const fns = {};
  return new Proxy({ __calls: calls }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (!fns[key]) {
        fns[key] = jest.fn();
      }
      // Wrapped so the call is recorded even after jest resets the mock.
      return async (...args) => {
        calls.push({ method: key, args });
        await fns[key](...args);
        if (/ById$/.test(key) && args[1] === 'missing') return null;
        return { id: 'rec1', records: [], totalSize: 0 };
      };
    },
  });
});
jest.mock('../../services/rollbackService', () => ({
  listSnapshots: jest.fn(),
  createSnapshot: jest.fn(),
  getSnapshot: jest.fn(),
  restoreSnapshot: jest.fn(),
}));
jest.mock('../../services/salesforceService', () => ({ authenticateWithSfdx: jest.fn(), instanceUrl: 'https://acme.my.salesforce.com' }));

const catalogManagerService = require('../../services/catalogManagerService');
const rollbackService = require('../../services/rollbackService');
const salesforceService = require('../../services/salesforceService');

// jest.config resets mock implementations before every test.
beforeEach(() => {
  catalogManagerService.__calls.length = 0;
  rollbackService.listSnapshots.mockResolvedValue([]);
  rollbackService.createSnapshot.mockResolvedValue({ snapshotId: 's1' });
  rollbackService.getSnapshot.mockResolvedValue({ metadata: { id: 's1' }, data: {} });
  rollbackService.restoreSnapshot.mockResolvedValue({ restored: 1 });
  salesforceService.authenticateWithSfdx.mockResolvedValue(true);
});
const router = require('../../routes/catalogManager');
const { errorHandler } = require('../../middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/catalog-manager', router);
app.use(errorHandler);

function routeTable(stack, out = []) {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) out.push([method, layer.route.path]);
    } else if (layer.handle && layer.handle.stack) {
      routeTable(layer.handle.stack, out);
    }
  }
  return out;
}

const ROUTES = routeTable(router.stack);
const fill = (p) => p.replace(/:(\w+)/g, (_, name) => `${name}-1`);
const BODY = {
  username: 'me@example.org', targetUsername: 'me@example.org', apexClassName: 'BatchJob', label: 'before change', Name: 'X',
  productId: '01t000000000001AAA', parentProductId: '01t000000000001AAA', childProductId: '01t000000000002AAA',
};

function call(method, path, { withUser = true } = {}) {
  const url = `/api/catalog-manager${fill(path)}`;
  let req = request(app)[method](url);
  if (withUser) req = req.query({ username: 'me@example.org' });
  if (method === 'post' || method === 'patch' || method === 'put') req = req.send(withUser ? BODY : { Name: 'X' });
  return req;
}

describe('Catalog Manager routes', () => {
  it('has every route mounted after the split', () => {
    expect(ROUTES.length).toBe(75);
    expect(new Set(ROUTES.map(([m, p]) => `${m} ${p}`)).size).toBe(75);
  });

  it.each(ROUTES)('%s %s answers and reaches the service', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBeLessThan(300);
    expect(res.body.success).toBe(true);
    const otherCalls = [...Object.values(rollbackService), salesforceService.authenticateWithSfdx]
      .reduce((n, fn) => n + fn.mock.calls.length, 0);
    expect(catalogManagerService.__calls.length + otherCalls).toBeGreaterThan(0);
    for (const { args } of catalogManagerService.__calls) {
      expect(args[0]).toBe('me@example.org');
    }
  });

  const needUser = ROUTES.filter(([m, p]) => !(m === 'get' && p === '/snapshots/:snapshotId') && !(m === 'post' && p === '/snapshots/:snapshotId/restore'));
  it.each(needUser)('%s %s refuses a request without a username', async (method, path) => {
    const res = await call(method, path, { withUser: false });
    expect(res.status).toBe(400);
    expect(catalogManagerService.__calls).toEqual([]);
  });

  it('returns 404 for a product that does not exist', async () => {
    const res = await request(app).get('/api/catalog-manager/products/missing').query({ username: 'me@example.org' });
    expect(res.status).toBe(404);
  });

  it('restoring a snapshot needs a target org', async () => {
    const res = await request(app).post('/api/catalog-manager/snapshots/s1/restore').send({});
    expect(res.status).toBe(400);
    expect(rollbackService.restoreSnapshot).not.toHaveBeenCalled();
  });
});
