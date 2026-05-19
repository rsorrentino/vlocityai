/**
 * Enterprise Job Queue Service
 * Advanced job queue with priority, scheduling, and resource management
 */

const logger = require('../utils/logger');
const databaseService = require('./databaseService');
const { Op } = require('sequelize');
const EventEmitter = require('events');

class EnterpriseJobQueueService extends EventEmitter {
  constructor() {
    super();
    this.isEnabled = process.env.ENABLE_ENTERPRISE_JOB_QUEUE === 'true';
    this.queues = new Map(); // Priority queues
    this.workers = new Map(); // Active workers
    this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS) || 10;
    this.maxJobsPerUser = parseInt(process.env.MAX_JOBS_PER_USER) || 5;
    this.maxJobsPerTenant = parseInt(process.env.MAX_JOBS_PER_TENANT) || 20;
    this.priorityLevels = ['critical', 'high', 'normal', 'low'];
    this.isProcessing = false;
    this.processingInterval = null;

    if (this.isEnabled) {
      this.initializeQueues();
      this.startProcessor();
    }
  }

  /**
   * Initialize priority queues
   */
  initializeQueues() {
    for (const priority of this.priorityLevels) {
      this.queues.set(priority, []);
    }
    logger.info('Enterprise job queue service initialized');
  }

  /**
   * Add job to queue
   */
  async enqueue(job, options = {}) {
    if (!this.isEnabled) {
      throw new Error('Enterprise job queue is not enabled');
    }

    const {
      priority = 'normal',
      scheduledTime = null,
      userId = null,
      tenantId = null,
      maxRetries = 3,
      retryDelay = 5000,
      timeout = 3600000, // 1 hour default
      resourceLimits = {},
    } = options;

    // Validate priority
    if (!this.priorityLevels.includes(priority)) {
      throw new Error(`Invalid priority: ${priority}. Must be one of: ${this.priorityLevels.join(', ')}`);
    }

    // Check resource limits
    await this.checkResourceLimits(userId, tenantId);

    const queueJob = {
      id: job.id || this.generateJobId(),
      job,
      priority,
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
      userId,
      tenantId,
      maxRetries,
      retryDelay,
      timeout,
      resourceLimits,
      status: scheduledTime ? 'scheduled' : 'queued',
      createdAt: new Date(),
      attempts: 0,
      metadata: options.metadata || {},
    };

    // Store in database
    await this.storeJob(queueJob);

    // Add to appropriate queue
    if (scheduledTime) {
      // Scheduled job - will be processed later
      this.emit('job:scheduled', queueJob);
    } else {
      // Immediate job - add to queue
      this.queues.get(priority).push(queueJob);
      this.emit('job:queued', queueJob);
    }

    logger.info(`Job ${queueJob.id} enqueued with priority ${priority}`);
    return queueJob;
  }

  /**
   * Check resource limits
   */
  async checkResourceLimits(userId, tenantId) {
    if (userId) {
      const userJobCount = await this.getActiveJobCount({ userId });
      if (userJobCount >= this.maxJobsPerUser) {
        throw new Error(`User has reached maximum concurrent jobs limit: ${this.maxJobsPerUser}`);
      }
    }

    if (tenantId) {
      const tenantJobCount = await this.getActiveJobCount({ tenantId });
      if (tenantJobCount >= this.maxJobsPerTenant) {
        throw new Error(`Tenant has reached maximum concurrent jobs limit: ${this.maxJobsPerTenant}`);
      }
    }
  }

  /**
   * Get active job count
   */
  async getActiveJobCount({ userId = null, tenantId = null } = {}) {
    try {
      const { Job } = databaseService.getModels();
      const where = {
        status: {
          [Op.in]: ['queued', 'running', 'scheduled'],
        },
      };

      if (userId) {
        where.userId = userId;
      }
      if (tenantId) {
        where.tenantId = tenantId;
      }

      return await Job.count({ where });
    } catch (error) {
      logger.logError(error, { operation: 'getActiveJobCount' });
      return 0;
    }
  }

  /**
   * Store job in database
   */
  async storeJob(queueJob) {
    try {
      const { Job } = databaseService.getModels();
      
      await Job.upsert({
        id: queueJob.id,
        name: queueJob.job.name || `Job ${queueJob.id}`,
        type: queueJob.job.type || 'unknown',
        status: queueJob.status,
        priority: queueJob.priority,
        userId: queueJob.userId,
        tenantId: queueJob.tenantId,
        scheduledTime: queueJob.scheduledTime,
        metadata: {
          ...queueJob.metadata,
          maxRetries: queueJob.maxRetries,
          retryDelay: queueJob.retryDelay,
          timeout: queueJob.timeout,
          resourceLimits: queueJob.resourceLimits,
        },
      });
    } catch (error) {
      logger.logError(error, { operation: 'storeJob', jobId: queueJob.id });
    }
  }

  /**
   * Start job processor
   */
  startProcessor() {
    if (this.processingInterval) return;

    // Process jobs every second
    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, 1000);

    // Process scheduled jobs every minute
    setInterval(() => {
      this.processScheduledJobs();
    }, 60000);

    logger.info('Job processor started');
  }

  /**
   * Process jobs from queues
   */
  async processJobs() {
    if (this.isProcessing) return;
    if (this.workers.size >= this.maxConcurrentJobs) return;

    // Get next job from highest priority queue
    let nextJob = null;
    for (const priority of this.priorityLevels) {
      const queue = this.queues.get(priority);
      if (queue.length > 0) {
        nextJob = queue.shift();
        break;
      }
    }

    if (!nextJob) return;

    this.isProcessing = true;

    try {
      await this.executeJob(nextJob);
    } catch (error) {
      logger.logError(error, { operation: 'processJobs', jobId: nextJob.id });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process scheduled jobs
   */
  async processScheduledJobs() {
    try {
      const { Job } = databaseService.getModels();
      const now = new Date();

      const scheduledJobs = await Job.findAll({
        where: {
          status: 'scheduled',
          scheduledTime: {
            [Op.lte]: now,
          },
        },
        order: [['priority', 'DESC'], ['scheduledTime', 'ASC']],
        limit: 100,
      });

      for (const jobRecord of scheduledJobs) {
        const queueJob = await this.loadJobFromDatabase(jobRecord.id);
        if (queueJob) {
          // Add to appropriate priority queue
          this.queues.get(queueJob.priority).push(queueJob);
          await this.updateJobStatus(queueJob.id, 'queued');
          this.emit('job:scheduled:ready', queueJob);
        }
      }
    } catch (error) {
      logger.logError(error, { operation: 'processScheduledJobs' });
    }
  }

  /**
   * Execute a job
   */
  async executeJob(queueJob) {
    const workerId = this.generateWorkerId();
    this.workers.set(workerId, {
      id: workerId,
      jobId: queueJob.id,
      startTime: new Date(),
    });

    try {
      await this.updateJobStatus(queueJob.id, 'running');
      this.emit('job:started', queueJob);

      // Execute with timeout
      const executionPromise = queueJob.job.execute();
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Job ${queueJob.id} timed out after ${queueJob.timeout}ms`));
        }, queueJob.timeout);
      });

      let result;
      try {
        result = await Promise.race([executionPromise, timeoutPromise]);
        // Clear timeout if execution completed first
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        // Clear timeout on error
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        throw error;
      }

      await this.updateJobStatus(queueJob.id, 'completed');
      this.emit('job:completed', { ...queueJob, result });
      logger.info(`Job ${queueJob.id} completed successfully`);

      return result;
    } catch (error) {
      queueJob.attempts++;

      if (queueJob.attempts < queueJob.maxRetries) {
        // Retry
        logger.warn(`Job ${queueJob.id} failed, retrying (attempt ${queueJob.attempts}/${queueJob.maxRetries})`);
        
        // Re-queue with delay
        setTimeout(() => {
          this.queues.get(queueJob.priority).push(queueJob);
        }, queueJob.retryDelay * queueJob.attempts); // Exponential backoff

        await this.updateJobStatus(queueJob.id, 'retrying');
        this.emit('job:retrying', { ...queueJob, error: error.message });
      } else {
        // Max retries reached
        await this.updateJobStatus(queueJob.id, 'failed');
        this.emit('job:failed', { ...queueJob, error: error.message });
        logger.error(`Job ${queueJob.id} failed after ${queueJob.attempts} attempts: ${error.message}`);
      }

      throw error;
    } finally {
      this.workers.delete(workerId);
    }
  }

  /**
   * Load job from database
   */
  async loadJobFromDatabase(jobId) {
    try {
      const { Job } = databaseService.getModels();
      const jobRecord = await Job.findByPk(jobId);

      if (!jobRecord) return null;

      return {
        id: jobRecord.id,
        job: {
          id: jobRecord.id,
          name: jobRecord.name,
          type: jobRecord.type,
          execute: async () => {
            // This would need to be reconstructed based on job type
            // For now, return the job record
            return jobRecord;
          },
        },
        priority: jobRecord.priority || 'normal',
        scheduledTime: jobRecord.scheduledTime,
        userId: jobRecord.userId,
        tenantId: jobRecord.tenantId,
        maxRetries: jobRecord.metadata?.maxRetries || 3,
        retryDelay: jobRecord.metadata?.retryDelay || 5000,
        timeout: jobRecord.metadata?.timeout || 3600000,
        resourceLimits: jobRecord.metadata?.resourceLimits || {},
        status: jobRecord.status,
        createdAt: jobRecord.createdAt,
        attempts: jobRecord.metadata?.attempts || 0,
        metadata: jobRecord.metadata || {},
      };
    } catch (error) {
      logger.logError(error, { operation: 'loadJobFromDatabase', jobId });
      return null;
    }
  }

  /**
   * Update job status
   */
  async updateJobStatus(jobId, status) {
    try {
      const { Job } = databaseService.getModels();
      await Job.update({ status }, { where: { id: jobId } });
    } catch (error) {
      logger.logError(error, { operation: 'updateJobStatus', jobId, status });
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    const stats = {
      totalQueued: 0,
      byPriority: {},
      activeWorkers: this.workers.size,
      maxConcurrentJobs: this.maxConcurrentJobs,
    };

    for (const priority of this.priorityLevels) {
      const queue = this.queues.get(priority);
      const count = queue.length;
      stats.byPriority[priority] = count;
      stats.totalQueued += count;
    }

    return stats;
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId) {
    // Remove from queue if not started
    for (const queue of this.queues.values()) {
      const index = queue.findIndex(j => j.id === jobId);
      if (index !== -1) {
        queue.splice(index, 1);
        await this.updateJobStatus(jobId, 'cancelled');
        this.emit('job:cancelled', { id: jobId });
        return true;
      }
    }

    // Check if it's running
    const worker = Array.from(this.workers.values()).find(w => w.jobId === jobId);
    if (worker) {
      // Job is running - would need to implement cancellation logic
      await this.updateJobStatus(jobId, 'cancelling');
      this.emit('job:cancelling', { id: jobId });
      return true;
    }

    return false;
  }

  /**
   * Generate job ID
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate worker ID
   */
  generateWorkerId() {
    return `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
let instance = null;

module.exports = function getEnterpriseJobQueueService() {
  if (!instance) {
    instance = new EnterpriseJobQueueService();
  }
  return instance;
};

module.exports.EnterpriseJobQueueService = EnterpriseJobQueueService;

