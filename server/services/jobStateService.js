const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../utils/logger');

/**
 * Job State Service
 * Manages job state persistence for resume/retry functionality
 * Based on patterns from official Vlocity Build Tool
 */
class JobStateService {
  constructor() {
    this.stateDir = path.join(__dirname, '../../vlocity-temp/job-states');
    this.logDir = path.join(__dirname, '../../vlocity-temp/logs');
    fs.ensureDirSync(this.stateDir);
    fs.ensureDirSync(this.logDir);
  }

  /**
   * Save job state to file
   * @param {string} jobId - Job ID
   * @param {Object} state - Job state data
   */
  async saveJobState(jobId, state) {
    try {
      const stateFile = path.join(this.stateDir, `${jobId}.json`);
      const stateData = {
        jobId,
        timestamp: new Date().toISOString(),
        state,
        version: '1.0'
      };

      await fs.writeJson(stateFile, stateData, { spaces: 2 });
      logger.info('Job state saved', { jobId, stateFile });
      
      return stateFile;
    } catch (error) {
      logger.error('Failed to save job state', { jobId, error: error.message });
      throw error;
    }
  }

  /**
   * Load job state from file
   * @param {string} jobId - Job ID
   * @returns {Promise<Object|null>} Job state or null if not found
   */
  async loadJobState(jobId) {
    try {
      const stateFile = path.join(this.stateDir, `${jobId}.json`);
      
      if (await fs.pathExists(stateFile)) {
        const stateData = await fs.readJson(stateFile);
        logger.info('Job state loaded', { jobId });
        return stateData;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to load job state', { jobId, error: error.message });
      return null;
    }
  }

  /**
   * Get remaining items from job (errors, remaining items, etc.)
   * @param {string} jobId - Job ID
   * @returns {Promise<Object|null>} Remaining items information
   */
  async getRemainingItems(jobId) {
    try {
      // Try to parse VlocityBuildLog.yaml
      const logFile = path.join(__dirname, '../../VlocityBuildLog.yaml');
      
      if (await fs.pathExists(logFile)) {
        const logData = yaml.load(await fs.readFile(logFile, 'utf8'));
        
        return {
          errors: logData.errors || [],
          remaining: logData.remaining || [],
          successful: logData.successful || [],
          totalProcessed: logData.successful?.length || 0,
          totalErrors: logData.errors?.length || 0
        };
      }

      // Fallback: Check job state
      const state = await this.loadJobState(jobId);
      if (state && state.state.remaining) {
        return {
          remaining: state.state.remaining,
          errors: state.state.errors || [],
          successful: state.state.successful || []
        };
      }

      // Check error log
      const errorLogPath = path.join(__dirname, '../../VlocityBuildErrors.log');
      if (await fs.pathExists(errorLogPath)) {
        const errorLog = await fs.readFile(errorLogPath, 'utf8');
        const errorLines = errorLog.split('\n').filter(line => line.trim().includes('Error'));
        
        return {
          errors: errorLines,
          remaining: [],
          successful: []
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to get remaining items', { jobId, error: error.message });
      return null;
    }
  }

  /**
   * Create a retry job from failed job
   * @param {string} originalJobId - Original job ID
   * @param {string} username - Salesforce username
   * @param {Object} options - Retry options
   * @returns {Promise<string>} Retry job ID
   */
  async createRetryJob(originalJobId, username, options = {}) {
    try {
      const remaining = await this.getRemainingItems(originalJobId);
      
      if (!remaining || (!remaining.errors?.length && !remaining.remaining?.length)) {
        throw new Error('No remaining items to retry');
      }

      // Get original job state
      const originalState = await this.loadJobState(originalJobId);
      
      // Create retry job
      const retryJobId = `retry-${originalJobId}-${Date.now()}`;
      const retryJob = {
        originalJobId,
        username,
        type: 'retry',
        createdAt: new Date().toISOString(),
        itemsToRetry: remaining.remaining || [],
        errorsToRetry: remaining.errors || [],
        originalJobType: originalState?.state?.jobType || 'unknown',
        jobConfig: originalState?.state?.jobConfig || {},
        retryAttempt: (originalState?.state?.retryAttempt || 0) + 1
      };

      await this.saveJobState(retryJobId, retryJob);
      
      logger.info('Retry job created', { 
        originalJobId, 
        retryJobId, 
        itemsCount: retryJob.itemsToRetry.length,
        errorsCount: retryJob.errorsToRetry.length
      });

      return retryJobId;
    } catch (error) {
      logger.error('Failed to create retry job', { originalJobId, error: error.message });
      throw error;
    }
  }

  /**
   * Update job state with progress
   * @param {string} jobId - Job ID
   * @param {Object} updates - State updates
   */
  async updateJobState(jobId, updates) {
    try {
      const currentState = await this.loadJobState(jobId);
      
      if (!currentState) {
        // Create new state if doesn't exist
        await this.saveJobState(jobId, {
          jobType: updates.jobType || 'unknown',
          status: updates.status || 'running',
          progress: updates.progress || 0,
          ...updates
        });
      } else {
        // Update existing state
        const updatedState = {
          ...currentState.state,
          ...updates,
          lastUpdated: new Date().toISOString()
        };
        await this.saveJobState(jobId, updatedState);
      }
    } catch (error) {
      logger.error('Failed to update job state', { jobId, error: error.message });
    }
  }

  /**
   * Mark job as completed
   * @param {string} jobId - Job ID
   * @param {Object} result - Job result
   * @param {boolean} success - Whether job succeeded
   */
  async completeJobState(jobId, result = null, success = true) {
    try {
      await this.updateJobState(jobId, {
        status: success ? 'completed' : 'failed',
        completedAt: new Date().toISOString(),
        result,
        success
      });

      logger.info('Job state marked as completed', { jobId, success });
    } catch (error) {
      logger.error('Failed to complete job state', { jobId, error: error.message });
    }
  }

  /**
   * Get all active jobs (running or pending)
   * @returns {Promise<Array>} List of active job states
   */
  async getActiveJobs() {
    try {
      const files = await fs.readdir(this.stateDir);
      const activeJobs = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const jobId = file.replace('.json', '');
          const state = await this.loadJobState(jobId);
          
          if (state && ['running', 'pending'].includes(state.state?.status)) {
            activeJobs.push({
              jobId,
              ...state
            });
          }
        }
      }

      return activeJobs;
    } catch (error) {
      logger.error('Failed to get active jobs', { error: error.message });
      return [];
    }
  }

  /**
   * Clean up old job states
   * @param {number} daysOld - Number of days to keep (default: 30)
   */
  async cleanupOldJobStates(daysOld = 30) {
    try {
      const files = await fs.readdir(this.stateDir);
      const cutoffDate = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.stateDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime.getTime() < cutoffDate) {
            await fs.remove(filePath);
            deletedCount++;
          }
        }
      }

      logger.info('Cleaned up old job states', { deletedCount, daysOld });
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old job states', { error: error.message });
      return 0;
    }
  }

  /**
   * Create recovery job from error analysis
   * @param {string} originalJobId - Original job ID
   * @param {Array} recoveryActions - Recovery actions from error analysis
   * @returns {Promise<string>} Recovery job ID
   */
  async createRecoveryJob(originalJobId, recoveryActions) {
    try {
      const recoveryJobId = `recovery-${originalJobId}-${Date.now()}`;
      const recoveryJob = {
        originalJobId,
        type: 'recovery',
        createdAt: new Date().toISOString(),
        recoveryActions,
        status: 'pending'
      };

      await this.saveJobState(recoveryJobId, recoveryJob);
      
      logger.info('Recovery job created', { 
        originalJobId, 
        recoveryJobId, 
        actionsCount: recoveryActions.length
      });

      return recoveryJobId;
    } catch (error) {
      logger.error('Failed to create recovery job', { originalJobId, error: error.message });
      throw error;
    }
  }
}

module.exports = new JobStateService();

