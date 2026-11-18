/**
 * Deploy API routes that need no org: jobs generated from an export folder,
 * export statistics, rollback of a deployment (snapshot restore mocked) and
 * input checks of the sequential deployment.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../../services/jobHistoryService', () => ({ getJobById: jest.fn(), createJob: jest.fn(), addJobToHistory: jest.fn() }));
jest.mock('../../services/rollbackService', () => ({ getSnapshot: jest.fn(), restoreSnapshot: jest.fn() }));
jest.mock('../../services/notificationService', () => ({ create: jest.fn() }));

const jobHistoryService = require('../../services/jobHistoryService');
const rollbackService = require('../../services/rollbackService');
const notificationService = require('../../services/notificationService');
const router = require('../../routes/deploys');
const { errorHandler } = require('../../middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/deploys', router);
app.use(errorHandler);

let exportDir;

beforeEach(() => {
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-'));
  for (const [type, files] of Object.entries({ Product2: ['a.json', 'b.json'], PriceList: ['c.json'] })) {
    fs.mkdirSync(path.join(exportDir, type));
    for (const f of files) fs.writeFileSync(path.join(exportDir, type, f), '{}');
  }
  fs.writeFileSync(path.join(exportDir, 'README.txt'), 'not a DataPack folder');
  notificationService.create.mockResolvedValue({});
});

afterEach(() => fs.rmSync(exportDir, { recursive: true, force: true }));

describe('deploy job from an export folder', () => {
  it('lists the DataPack folders as queries', async () => {
    const res = await request(app).post('/api/deploys/generate-from-export').send({ exportPath: exportDir, saveToFile: false });
    expect(res.status).toBe(200);
    expect(res.body.deployJob).toMatchObject({ projectPath: exportDir, queries: ['PriceList', 'Product2'] });
  });

  it('reports export statistics', async () => {
    const res = await request(app).get('/api/deploys/export-statistics').query({ exportPath: exportDir });
    expect(res.body.statistics).toMatchObject({ exists: true, dataPackTypes: 2, dataPackFolders: ['PriceList', 'Product2'], totalFiles: 3, totalSize: 6 });
  });

  it('reports a missing export folder as empty', async () => {
    const res = await request(app).get('/api/deploys/export-statistics').query({ exportPath: path.join(exportDir, 'none') });
    expect(res.body.statistics).toMatchObject({ exists: false, dataPackTypes: 0 });
  });

  it('returns the default deployment sequence', async () => {
    const res = await request(app).get('/api/deploys/sequential/sequence');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data) || typeof res.body.data === 'object').toBe(true);
  });
});

describe('rollback of a deployment', () => {
  const job = { id: 'job1', userId: 'u1', configuration: { preDeploySnapshotId: 'snap1', targetUsername: 'target@example.org' } };

  it('404 for an unknown job', async () => {
    jobHistoryService.getJobById.mockResolvedValue(null);
    expect((await request(app).get('/api/deploys/jobs/nope/rollback-status')).status).toBe(404);
    expect((await request(app).post('/api/deploys/jobs/nope/rollback')).status).toBe(404);
  });

  it('says rollback is unavailable without a pre-deploy snapshot', async () => {
    jobHistoryService.getJobById.mockResolvedValue({ id: 'job2', configuration: {} });
    const status = await request(app).get('/api/deploys/jobs/job2/rollback-status');
    expect(status.body.data).toEqual({ available: false });
    const rollback = await request(app).post('/api/deploys/jobs/job2/rollback');
    expect(rollback.status).toBe(400);
    expect(rollbackService.restoreSnapshot).not.toHaveBeenCalled();
  });

  it('summarises the snapshot', async () => {
    jobHistoryService.getJobById.mockResolvedValue(job);
    rollbackService.getSnapshot.mockResolvedValue({
      metadata: { createdAt: '2026-11-01T10:00:00Z', username: 'x', configuration: { recordCounts: { Product2: 3, PriceList: 0, Promotion: 2 } } },
    });
    const res = await request(app).get('/api/deploys/jobs/job1/rollback-status');
    expect(res.body.data).toMatchObject({ available: true, snapshotId: 'snap1', targetUsername: 'target@example.org', types: ['Product2', 'Promotion'], totalRecords: 5 });
  });

  it('restores the snapshot into the target org and notifies the owner', async () => {
    jobHistoryService.getJobById.mockResolvedValue(job);
    rollbackService.restoreSnapshot.mockResolvedValue({ restoreJobId: 'r1', summary: { success: 5, errors: 0 } });
    const res = await request(app).post('/api/deploys/jobs/job1/rollback').send({});
    expect(res.status).toBe(200);
    expect(rollbackService.restoreSnapshot).toHaveBeenCalledWith('snap1', 'target@example.org');
    expect(notificationService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', relatedId: 'job1' }));
  });
});

describe('sequential deployment input', () => {
  it.each([
    [{ projectPath: '/x' }, /targetUsername/],
    [{ targetUsername: 'me@example.org' }, /projectPath/],
  ])('rejects %p', async (body, message) => {
    const res = await request(app).post('/api/deploys/sequential').send(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(message);
    expect(jobHistoryService.createJob).not.toHaveBeenCalled();
  });
});
