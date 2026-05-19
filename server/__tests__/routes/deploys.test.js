const request = require('supertest');
const express = require('express');
const deployRoutes = require('../../routes/deploys');

// Mock dependencies
jest.mock('../../models/Job');
jest.mock('../../services/vlocityService');
jest.mock('../../services/exportRecoveryService');
jest.mock('../../services/errorLogParser');

const Job = require('../../models/Job');
const vlocityService = require('../../services/vlocityService');
const exportRecoveryService = require('../../services/exportRecoveryService');
const errorLogParser = require('../../services/errorLogParser');

describe('Deploy Routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/deploys', deployRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/deploys', () => {
    it('should create a new deploy job', async () => {
      const mockJob = {
        id: 'test-job-id',
        name: 'Test Deploy',
        type: 'deploy',
        status: 'pending',
        save: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/deploys')
        .send({
          name: 'Test Deploy',
          configuration: {
            projectPath: './deploy',
            queries: ['Product2'],
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(Job.create).toHaveBeenCalled();
    });
  });

  describe('POST /api/deploys/run', () => {
    it('should run deploy successfully', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      vlocityService.deployDataPacks = jest.fn().mockResolvedValue({
        success: true,
        message: 'Deploy completed',
      });
      errorLogParser.parseVlocityErrors = jest.fn().mockResolvedValue({
        missingIds: [],
        failedTypes: [],
        settingsMismatch: false,
        authErrors: false,
      });

      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          targetUsername: 'target@example.com',
          jobFilePath: './test-deploy.yaml',
          jobConfig: { projectPath: './deploy' },
          attempts: 3,
          prealignSettings: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(vlocityService.deployDataPacks).toHaveBeenCalled();
    });

    it('should pre-align settings when requested', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      vlocityService.updateSettings = jest.fn().mockResolvedValue(true);
      vlocityService.deployDataPacks = jest.fn().mockResolvedValue({
        success: true,
      });
      errorLogParser.parseVlocityErrors = jest.fn().mockResolvedValue({
        missingIds: [],
        failedTypes: [],
        settingsMismatch: false,
        authErrors: false,
      });

      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          targetUsername: 'target@example.com',
          jobFilePath: './test-deploy.yaml',
          jobConfig: { projectPath: './deploy' },
          prealignSettings: true,
        });

      expect(response.status).toBe(200);
      expect(vlocityService.updateSettings).toHaveBeenCalled();
    });

    it('should handle settings mismatch with auto-sync', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      
      let callCount = 0;
      vlocityService.deployDataPacks = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First attempt fails with settings mismatch
          throw new Error('Settings mismatch detected');
        }
        // Second attempt succeeds after settings sync
        return Promise.resolve({ success: true });
      });

      vlocityService.updateSettings = jest.fn().mockResolvedValue(true);
      
      errorLogParser.parseVlocityErrors = jest.fn().mockResolvedValue({
        missingIds: [],
        failedTypes: [],
        settingsMismatch: true,
        authErrors: false,
      });

      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          targetUsername: 'target@example.com',
          sourceUsername: 'source@example.com',
          jobFilePath: './test-deploy.yaml',
          jobConfig: { projectPath: './deploy' },
          attempts: 3,
        });

      expect(response.status).toBe(200);
      expect(vlocityService.updateSettings).toHaveBeenCalled();
    });

    it('should perform targeted retry for failed types', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      
      let callCount = 0;
      vlocityService.deployDataPacks = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Deploy failed');
        }
        return Promise.resolve({ success: true });
      });

      errorLogParser.parseVlocityErrors = jest.fn().mockResolvedValue({
        missingIds: [],
        failedTypes: ['Product2', 'VlocityUITemplate'],
        settingsMismatch: false,
        authErrors: false,
      });

      errorLogParser.buildRetryJob = jest.fn().mockResolvedValue('./retry-job.yaml');

      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          targetUsername: 'target@example.com',
          jobFilePath: './test-deploy.yaml',
          jobConfig: { projectPath: './deploy' },
          attempts: 3,
        });

      expect(response.status).toBe(200);
      expect(errorLogParser.buildRetryJob).toHaveBeenCalled();
    });

    it('should trigger export recovery on deploy failure', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      
      let callCount = 0;
      vlocityService.deployDataPacks = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1 || callCount === 2 || callCount === 3) {
          throw new Error('Deploy failed');
        }
        return Promise.resolve({ success: true });
      });

      errorLogParser.parseVlocityErrors = jest.fn().mockResolvedValue({
        missingIds: ['01t8s00000A8ZPRAA3'],
        failedTypes: [],
        settingsMismatch: false,
        authErrors: false,
      });

      exportRecoveryService.runIterativeRecovery = jest.fn().mockResolvedValue({
        success: true,
        iterations: 2,
        recoveredIds: 1,
      });

      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          targetUsername: 'target@example.com',
          sourceUsername: 'source@example.com',
          jobFilePath: './test-deploy.yaml',
          jobConfig: { projectPath: './deploy' },
          attempts: 3,
          triggerExportRecovery: true,
        });

      expect(response.status).toBe(200);
      expect(exportRecoveryService.runIterativeRecovery).toHaveBeenCalled();
    });

    it('should validate source !== target', async () => {
      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          targetUsername: 'same@example.com',
          sourceUsername: 'same@example.com',
          jobFilePath: './test-deploy.yaml',
          attempts: 3,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('same');
    });

    it('should return 400 for missing target username', async () => {
      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          jobFilePath: './test-deploy.yaml',
        });

      expect(response.status).toBe(400);
    });

    it('should handle authentication errors', async () => {
      const mockJob = {
        id: 'test-job-id',
        update: jest.fn(),
      };

      Job.create = jest.fn().mockResolvedValue(mockJob);
      vlocityService.deployDataPacks = jest.fn().mockRejectedValue({
        authError: {
          message: 'Authentication failed',
          username: 'target@example.com',
        },
      });

      const response = await request(app)
        .post('/api/deploys/run')
        .send({
          targetUsername: 'target@example.com',
          jobFilePath: './test-deploy.yaml',
        });

      expect(response.status).toBe(401);
      expect(response.body.reloginInfo).toBeDefined();
    });
  });

  describe('POST /api/deploys/validate', () => {
    it('should validate deploy job', async () => {
      vlocityService.validateDataPacks = jest.fn().mockResolvedValue({
        success: true,
        message: 'Validation passed',
      });

      const response = await request(app)
        .post('/api/deploys/validate')
        .send({
          targetUsername: 'target@example.com',
          jobFilePath: './test-deploy.yaml',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(vlocityService.validateDataPacks).toHaveBeenCalled();
    });

    it('should return validation errors', async () => {
      vlocityService.validateDataPacks = jest.fn().mockRejectedValue(
        new Error('Validation failed')
      );

      const response = await request(app)
        .post('/api/deploys/validate')
        .send({
          targetUsername: 'target@example.com',
          jobFilePath: './test-deploy.yaml',
        });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/deploys', () => {
    it('should return all deploy jobs', async () => {
      const mockJobs = [
        { id: '1', name: 'Deploy 1', type: 'deploy' },
        { id: '2', name: 'Deploy 2', type: 'deploy' },
      ];

      Job.findAll = jest.fn().mockResolvedValue(mockJobs);

      const response = await request(app).get('/api/deploys');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('DELETE /api/deploys/:id', () => {
    it('should delete deploy job', async () => {
      const mockJob = {
        id: 'test-job-id',
        destroy: jest.fn(),
      };

      Job.findByPk = jest.fn().mockResolvedValue(mockJob);

      const response = await request(app).delete('/api/deploys/test-job-id');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockJob.destroy).toHaveBeenCalled();
    });
  });
});

