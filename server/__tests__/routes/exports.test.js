/**
 * Export API routes that work on local files: templates, and checking /
 * repairing exported DataPack JSON. Real files in a temp folder, no org needed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

const router = require('../../routes/exports');
const { errorHandler } = require('../../middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/exports', router);
app.use(errorHandler);

let exportDir;

beforeEach(() => {
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
  const packDir = path.join(exportDir, 'Product2', 'Hearing_Aid');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'Hearing_Aid_DataPack.json'), '{"Name": "Hearing Aid"}');
  // Typical CLI glitch: a duplicated closing bracket at the end of the file
  fs.writeFileSync(path.join(packDir, 'Hearing_Aid_Attributes.json'), '[{"Code": "COLOR"}]]');
});

afterEach(() => fs.rmSync(exportDir, { recursive: true, force: true }));

describe('GET /api/exports/templates', () => {
  it('returns the ready-made templates', async () => {
    const res = await request(app).get('/api/exports/templates');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.templates.length);
    expect(res.body.templates[0]).toMatchObject({ name: 'Full Catalog Export', config: { queries: expect.any(Array) } });
    for (const t of res.body.templates) {
      expect(t.config.name).toBeTruthy();
      expect(Array.isArray(t.config.queries)).toBe(true);
    }
  });

  it('hands out a fresh copy each time', async () => {
    const { getExportTemplates } = require('../../config/exportTemplates');
    const first = getExportTemplates();
    first[0].name = 'changed';
    expect(getExportTemplates()[0].name).toBe('Full Catalog Export');
  });
});

describe('JSON file check and repair', () => {
  it('finds the broken file', async () => {
    const res = await request(app).get('/api/exports/validate-json-files').query({ exportPath: exportDir });
    expect(res.status).toBe(200);
    expect(res.body.results).toMatchObject({ totalFiles: 2, validFiles: 1, invalidFiles: 1 });
    expect(res.body.results.invalidFileList[0].relativePath).toBe(path.join('Product2', 'Hearing_Aid', 'Hearing_Aid_Attributes.json'));
  });

  it('repairs it, after which everything is valid', async () => {
    const fix = await request(app).post('/api/exports/fix-json-files').send({ exportPath: exportDir });
    expect(fix.status).toBe(200);
    expect(fix.body.results.totalFixed).toBe(1);
    const repaired = fs.readFileSync(path.join(exportDir, 'Product2', 'Hearing_Aid', 'Hearing_Aid_Attributes.json'), 'utf8');
    expect(JSON.parse(repaired)).toEqual([{ Code: 'COLOR' }]);

    const check = await request(app).get('/api/exports/validate-json-files').query({ exportPath: exportDir });
    expect(check.body.results.invalidFiles).toBe(0);
  });

  it('can be limited to one DataPack', async () => {
    const res = await request(app).post('/api/exports/fix-json-files')
      .send({ exportPath: exportDir, dataPackType: 'Product2', dataPackName: 'Hearing_Aid' });
    expect(res.status).toBe(200);
  });

  it('reports a missing folder as 404', async () => {
    const missing = path.join(exportDir, 'nope');
    expect((await request(app).get('/api/exports/validate-json-files').query({ exportPath: missing })).status).toBe(404);
    expect((await request(app).post('/api/exports/fix-json-files').send({ exportPath: exportDir, dataPackType: 'Nope' })).status).toBe(404);
  });
});
