const request = require('supertest');
const express = require('express');
const exportRoutes = require('../../routes/exports');

// Mock dependencies
jest.mock('../../models/Job');
jest.mock('../../services/vlocityService');
jest.mock('../../services/exportRecoveryService');
jest.mock('../../services/errorLogParser');

const Job = require('../../models/Job');
const vlocityService = require('../../services/vlocityService');
const exportRecoveryService = require('../../services/exportRecoveryService');
const errorLogParser = require('../../services/errorLogParser');

describe('Export Routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/exports', exportRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/exports', () => {
    it('should create a new export job', async () => {
      const mockJob = {
        id: 'test-job-id',
        name: 'Test Export',
        type: 'export',
        status: 'pending',
        save: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/exports')
        .send({
          name: 'Test Export',
          configuration: {
            projectPath: './export',
            queries: ['Product2'],
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(Job.create).toHaveBeenCalled();
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/exports')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/exports', () => {
    it('should return all export jobs', async () => {
      const mockJobs = [
        { id: '1', name: 'Export 1', type: 'export' },
        { id: '2', name: 'Export 2', type: 'export' },
      ];

      Job.findAll = jest.fn().mockResolvedValue(mockJobs);

      const response = await request(app).get('/api/exports');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/exports/:id', () => {
    it('should return specific export job', async () => {
      const mockJob = {
        id: 'test-job-id',
        name: 'Test Export',
        type: 'export',
      };

      Job.findByPk = jest.fn().mockResolvedValue(mockJob);

      const response = await request(app).get('/api/exports/test-job-id');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('test-job-id');
    });

    it('should return 404 for non-existent job', async () => {
      Job.findByPk = jest.fn().mockResolvedValue(null);

      const response = await request(app).get('/api/exports/non-existent');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/exports/run', () => {
    it('should run export without recovery', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      vlocityService.exportDataPacks = jest.fn().mockResolvedValue({
        success: true,
        message: 'Export completed',
      });
      errorLogParser.hasErrors = jest.fn().mockResolvedValue(false);

      const response = await request(app)
        .post('/api/exports/run')
        .send({
          username: 'test@example.com',
          jobFilePath: './test-export.yaml',
          jobConfig: { projectPath: './export' },
          enableRecovery: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(vlocityService.exportDataPacks).toHaveBeenCalled();
    });

    it('should run export with recovery', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      exportRecoveryService.runIterativeRecovery = jest.fn().mockResolvedValue({
        success: true,
        iterations: 3,
        recoveredIds: 15,
        totalIds: 15,
      });

      const response = await request(app)
        .post('/api/exports/run')
        .send({
          username: 'test@example.com',
          jobFilePath: './test-export.yaml',
          jobConfig: { projectPath: './export' },
          enableRecovery: true,
          maxRecoveryIterations: 10,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(exportRecoveryService.runIterativeRecovery).toHaveBeenCalled();
    });

    it('should handle authentication errors', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      vlocityService.exportDataPacks = jest.fn().mockRejectedValue({
        authError: {
          message: 'Authentication failed',
          username: 'test@example.com',
        },
      });

      const response = await request(app)
        .post('/api/exports/run')
        .send({
          username: 'test@example.com',
          jobFilePath: './test-export.yaml',
          jobConfig: { projectPath: './export' },
        });

      expect(response.status).toBe(401);
      expect(response.body.reloginInfo).toBeDefined();
    });

    it('should return 400 for missing username', async () => {
      const response = await request(app)
        .post('/api/exports/run')
        .send({
          jobFilePath: './test-export.yaml',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/exports/:id', () => {
    it('should update export job', async () => {
      const mockJob = {
        id: 'test-job-id',
        name: 'Old Name',
        update: jest.fn().mockResolvedValue({
          id: 'test-job-id',
          name: 'New Name',
        }),
      };

      Job.findByPk = jest.fn().mockResolvedValue(mockJob);

      const response = await request(app)
        .put('/api/exports/test-job-id')
        .send({
          name: 'New Name',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockJob.update).toHaveBeenCalled();
    });

    it('should return 404 for non-existent job', async () => {
      Job.findByPk = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .put('/api/exports/non-existent')
        .send({ name: 'New Name' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/exports/:id', () => {
    it('should delete export job', async () => {
      const mockJob = {
        id: 'test-job-id',
        destroy: jest.fn(),
      };

      Job.findByPk = jest.fn().mockResolvedValue(mockJob);

      const response = await request(app).delete('/api/exports/test-job-id');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockJob.destroy).toHaveBeenCalled();
    });

    it('should return 404 for non-existent job', async () => {
      Job.findByPk = jest.fn().mockResolvedValue(null);

      const response = await request(app).delete('/api/exports/non-existent');

      expect(response.status).toBe(404);
    });
  });
});

