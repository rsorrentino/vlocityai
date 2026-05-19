const { Job } = require('../models');
const jobMonitor = require('./jobMonitor');
const logger = require('../utils/logger');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');
const crypto = require('crypto');

class JobHistoryService {
  constructor() {
    this.jobHistory = new Map();
    this.maxHistorySize = 1000;
  }

  async createJob(jobData) {
    try {
      // Ensure configuration is never null - provide default if missing
      const configuration = jobData.configuration || jobData.config || {};
      
      // Handle userId properly - if username is provided, find the user ID
      let userId = jobData.userId;
      if (!userId && jobData.username) {
        // Try to find user by username/email
        const { User } = require('../models');
        const user = await User.findOne({ where: { username: jobData.username } });
        userId = user ? user.id : null;
      }
      
      const job = await Job.create({
        id: jobData.id || this.generateJobId(),
        type: jobData.type,
        name: jobData.name,
        status: jobData.status || 'pending',
        userId: userId, // Use proper UUID or null
        configuration: configuration, // Always provide a valid configuration object
        // Context information
        username: jobData.username || null,
        filePath: jobData.filePath || null,
        projectPath: jobData.projectPath || null,
        sourceUsername: jobData.sourceUsername || null,
        targetUsername: jobData.targetUsername || null,
        environment: jobData.environment || null,
        cliType: jobData.cliType || 'vlocity', // Default to vlocity for backward compatibility
        startedAt: jobData.startedAt || new Date(),
        logs: jobData.logs || []
      });

      // Also add to in-memory monitor with the created job's ID
      jobMonitor.startJob({
        ...jobData,
        id: job.id // Use the actual database job ID
      });

      logger.logOperation('Job created', { 
        jobId: job.id, 
        type: job.type, 
        name: job.name,
        username: job.username,
        filePath: job.filePath
      });

      return job;
    } catch (error) {
      logger.logError(error, { operation: 'Create job' });
      throw error;
    }
  }

  async updateJobProgress(jobId, progress, message = null) {
    try {
      const job = await Job.findOne({ where: { id: jobId } });
      if (!job) {
        throw new NotFoundError('Job not found');
      }

      job.progress = Math.min(100, Math.max(0, progress));
      
      if (message) {
        job.logs.push({
          timestamp: new Date(),
          message: message,
          level: 'info'
        });
      }

      await job.save();

      // Update in-memory monitor
      jobMonitor.updateJobProgress(jobId, progress, message);

      return job;
    } catch (error) {
      logger.logError(error, { operation: 'Update job progress', jobId });
      throw error;
    }
  }

  async abortJob(jobId, reason = 'Job aborted by user') {
    try {
      const job = await Job.findOne({ where: { id: jobId } });
      if (!job) {
        throw new NotFoundError('Job not found');
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'aborted') {
        throw new Error(`Cannot abort job: job has already ${job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : 'been aborted'}. Only running or pending jobs can be aborted.`);
      }

      job.status = 'aborted';
      job.completedAt = new Date();
      job.duration = job.startedAt ? new Date() - new Date(job.startedAt) : 0;
      
      job.logs.push({
        timestamp: new Date(),
        message: reason,
        level: 'warn'
      });

      await job.save();

      // Update in-memory monitor
      jobMonitor.abortJob(jobId, reason);

      logger.logOperation('Job aborted', { jobId, reason });
      return job;
    } catch (error) {
      logger.logError(error, { operation: 'Abort job', jobId });
      throw error;
    }
  }

  async addJobLog(jobId, message, level = 'info') {
    try {
      const job = await Job.findOne({ where: { id: jobId } });
      if (!job) {
        throw new NotFoundError('Job not found');
      }

      job.logs.push({
        timestamp: new Date(),
        message: message,
        level: level
      });

      await job.save();

      // Update in-memory monitor
      jobMonitor.addJobLog(jobId, message, level);

      return job;
    } catch (error) {
      logger.logError(error, { operation: 'Add job log', jobId });
      throw error;
    }
  }

  async addJobError(jobId, error) {
    try {
      const job = await Job.findOne({ where: { id: jobId } });
      if (!job) {
        throw new NotFoundError('Job not found');
      }

      const errorEntry = {
        timestamp: new Date(),
        message: error.message || error,
        stack: error.stack,
        level: 'error'
      };

      // Add to logs array
      job.logs.push(errorEntry);
      
      // Set error field (TEXT field in model)
      job.error = error.message || error;

      await job.save();

      // Update in-memory monitor
      jobMonitor.addJobError(jobId, error);

      return job;
    } catch (error) {
      logger.logError(error, { operation: 'Add job error', jobId });
      throw error;
    }
  }

  async completeJob(jobId, result = null, success = true) {
    try {
      const job = await Job.findOne({ where: { id: jobId } });
      if (!job) {
        throw new NotFoundError('Job not found');
      }

      job.status = success ? 'completed' : 'failed';
      job.completedAt = new Date();
      job.duration = job.completedAt - job.startedAt;
      job.result = result;

      await job.save();

      // Update in-memory monitor
      jobMonitor.completeJob(jobId, result, success);

      logger.logOperation('Job completed', { 
        jobId: job.id, 
        status: job.status, 
        duration: job.duration 
      });

      return job;
    } catch (error) {
      logger.logError(error, { operation: 'Complete job', jobId });
      throw error;
    }
  }

  async patchJobResult(jobId, extraData) {
    try {
      const job = await Job.findOne({ where: { id: jobId } });
      if (!job) throw new NotFoundError('Job not found');
      job.result = { ...(job.result || {}), ...extraData };
      await job.save();
      return job;
    } catch (error) {
      logger.logError(error, { operation: 'patchJobResult', jobId });
      throw error;
    }
  }

  async getJobHistory(limit = 50, offset = 0, filters = {}) {
    try {
      const query = {};
      
      if (filters.username) {
        // Support both userId and username filtering
        query.userId = filters.username;
      }
      
      if (filters.type) {
        query.type = filters.type;
      }
      
      if (filters.status) {
        query.status = filters.status;
      }

      const jobs = await Job.findAll({
        where: query,
        order: [['createdAt', 'DESC']],
        limit: limit,
        offset: offset,
        attributes: { exclude: ['logs'] } // Exclude large fields for list view
      });

      const total = await Job.count({ where: query });

      return {
        jobs,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    } catch (error) {
      logger.logError(error, { operation: 'Get job history' });
      throw error;
    }
  }

  async getJobById(jobId) {
    try {
      const job = await Job.findOne({ where: { id: jobId } });
      if (!job) {
        throw new NotFoundError('Job not found');
      }
      return job;
    } catch (error) {
      logger.logError(error, { operation: 'Get job by ID', jobId });
      throw error;
    }
  }

  async getActiveJobs() {
    try {
      const jobs = await Job.findAll({ 
        where: { 
          status: ['pending', 'running'] 
        },
        order: [['createdAt', 'DESC']]
      });

      return jobs;
    } catch (error) {
      logger.logError(error, { operation: 'Get active jobs' });
      throw error;
    }
  }

  async getJobStats(username = null) {
    try {
      const matchStage = username ? { userId: username } : {};
      
      // Get basic counts using Sequelize
      const totalJobs = await Job.count({ where: matchStage });
      const exportJobs = await Job.count({ where: { ...matchStage, type: 'export' } });
      const deployJobs = await Job.count({ where: { ...matchStage, type: 'deploy' } });
      const successfulJobs = await Job.count({ where: { ...matchStage, status: 'completed' } });
      const failedJobs = await Job.count({ where: { ...matchStage, status: 'failed' } });
      const runningJobs = await Job.count({ where: { ...matchStage, status: 'running' } });
      
      // Get recent jobs
      const recentJobs = await Job.findAll({
        where: matchStage,
        order: [['createdAt', 'DESC']],
        limit: 10,
        attributes: ['name', 'type', 'status', 'createdAt', 'duration']
      });

      // Get actual org count from properties
      let activeOrgs = 0;
      try {
        const propertiesService = require('./propertiesService');
        // Load properties to count unique orgs
        const propertiesResult = await propertiesService.loadProperties();
        const properties = propertiesResult.properties || {};
        const orgs = [];
        const addedUsernames = new Set();
        
        // Helper function to add org if it exists
        const addOrg = (username) => {
          if (username && username.trim() && !addedUsernames.has(username.trim())) {
            orgs.push(username.trim());
            addedUsernames.add(username.trim());
          }
        };
        
        // Count unique orgs from default properties
        addOrg(properties.SFDX_USERNAME);
        addOrg(properties.SOURCE_SFDX_USERNAME);
        addOrg(properties.TARGET_SFDX_USERNAME);
        
        // Add environment-specific orgs
        const environments = ['dev', 'uat', 'prod'];
        for (const env of environments) {
          const envProps = await propertiesService.loadProperties(env).catch(() => ({ properties: {} }));
          const envProperties = envProps.properties || {};
          addOrg(envProperties[`SFDX_USERNAME.${env}`] || envProperties.SFDX_USERNAME);
          addOrg(envProperties[`SOURCE_SFDX_USERNAME.${env}`] || envProperties.SOURCE_SFDX_USERNAME);
          addOrg(envProperties[`TARGET_SFDX_USERNAME.${env}`] || envProperties.TARGET_SFDX_USERNAME);
        }
        
        activeOrgs = orgs.length;
      } catch (error) {
        logger.logDebug('Could not count orgs from properties', { error: error.message });
        // If orgs service not available, just count based on username
        activeOrgs = username ? 1 : 0;
      }

      return {
        totalJobs,
        totalExports: exportJobs,
        totalDeploys: deployJobs,
        successfulJobs,
        failedJobs,
        runningJobs,
        activeOrgs,
        recentJobs
      };
    } catch (error) {
      logger.logError(error, { operation: 'Get job stats' });
      throw error;
    }
  }

  async deleteJob(jobId) {
    try {
      const job = await Job.destroy({ where: { id: jobId } });
      if (job === 0) {
        throw new NotFoundError('Job not found');
      }

      logger.logOperation('Job deleted', { jobId });
      return { success: true, deletedCount: job };
    } catch (error) {
      logger.logError(error, { operation: 'Delete job', jobId });
      throw error;
    }
  }

  async cleanupOldJobs(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await Job.destroy({
        where: {
          createdAt: { [require('sequelize').Op.lt]: cutoffDate },
          status: { [require('sequelize').Op.in]: ['completed', 'failed'] }
        }
      });

      logger.logOperation('Job cleanup completed', { 
        deletedCount: result,
        cutoffDate 
      });

      return result;
    } catch (error) {
      logger.logError(error, { operation: 'Cleanup old jobs' });
      throw error;
    }
  }

  generateJobId() {
    // Generate a proper UUID v4 using crypto
    return crypto.randomUUID();
  }

  // Legacy method for backward compatibility
  addJobToHistory(jobData) {
    // This method is kept for backward compatibility
    // It will create a job in the database
    return this.createJob(jobData);
  }
}

module.exports = new JobHistoryService();
