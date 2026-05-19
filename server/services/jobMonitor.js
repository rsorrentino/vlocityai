const WebSocket = require('ws');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const logStorageService = require('./logStorageService');

class JobMonitor extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.clients = new Set();
    this.activeJobs = new Map();
    this.jobHistory = [];
    this.logBuffer = new Map(); // Buffer logs before persisting
    this.flushInterval = null;
    
    // Start periodic flush of logs to database
    this.startLogFlusher();
  }
  
  startLogFlusher() {
    // Flush logs to database every 2 seconds
    this.flushInterval = setInterval(() => {
      this.flushLogsToDatabase();
    }, 2000);
  }
  
  async flushLogsToDatabase() {
    if (this.logBuffer.size === 0) return;
    
    // Process all buffered logs and write to files
    for (const [jobId, bufferedLogs] of this.logBuffer.entries()) {
      if (bufferedLogs.length === 0) continue;
      
      try {
        // Write logs to file instead of database
        await logStorageService.appendLogs(jobId, bufferedLogs);
      } catch (error) {
        logger.logError(error, { operation: 'flushJobLogs', jobId, count: bufferedLogs.length });
      }
    }
    
    // Clear buffer after flushing
    this.logBuffer.clear();
  }

  initialize(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/jobs'
    });

    this.wss.on('connection', (ws, req) => {
      logger.logOperation('WebSocket client connected', { 
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      this.clients.add(ws);

      // Send current job status to new client
      this.sendToClient(ws, {
        type: 'initial_status',
        data: {
          activeJobs: Array.from(this.activeJobs.values()),
          recentJobs: this.jobHistory.slice(-10)
        }
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(ws, data);
        } catch (error) {
          logger.logError(error, { operation: 'handleWebSocketMessage' });
          this.sendToClient(ws, {
            type: 'error',
            message: 'Invalid message format'
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.logOperation('WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.logError(error, { operation: 'WebSocketError' });
        this.clients.delete(ws);
      });
    });

    logger.logOperation('WebSocket server initialized', { 
      path: '/ws/jobs' 
    });
  }

  handleClientMessage(ws, data) {
    switch (data.type) {
      case 'subscribe_job':
        this.subscribeToJob(ws, data.jobId);
        break;
      case 'unsubscribe_job':
        this.unsubscribeFromJob(ws, data.jobId);
        break;
      case 'get_job_status':
        this.sendJobStatus(ws, data.jobId);
        break;
      default:
        this.sendToClient(ws, {
          type: 'error',
          message: 'Unknown message type'
        });
    }
  }

  subscribeToJob(ws, jobId) {
    // Add client to job subscription
    if (!ws.jobSubscriptions) {
      ws.jobSubscriptions = new Set();
    }
    ws.jobSubscriptions.add(jobId);
    
    this.sendToClient(ws, {
      type: 'subscribed',
      jobId: jobId
    });
  }

  unsubscribeFromJob(ws, jobId) {
    if (ws.jobSubscriptions) {
      ws.jobSubscriptions.delete(jobId);
    }
    
    this.sendToClient(ws, {
      type: 'unsubscribed',
      jobId: jobId
    });
  }

  sendJobStatus(ws, jobId) {
    const job = this.activeJobs.get(jobId) || this.jobHistory.find(j => j.id === jobId);
    if (job) {
      this.sendToClient(ws, {
        type: 'job_status',
        jobId: jobId,
        data: job
      });
    }
  }

  startJob(jobData) {
    const jobId = jobData.id || `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job = {
      id: jobId,
      type: jobData.type || 'unknown',
      name: jobData.name || 'Unnamed Job',
      status: 'running',
      progress: 0,
      startTime: new Date().toISOString(),
      username: jobData.username,
      config: jobData.config,
      logs: [],
      errors: [],
      metadata: jobData.metadata || {}
    };

    this.activeJobs.set(jobId, job);
    this.broadcast({
      type: 'job_started',
      data: job
    });

    logger.logOperation('Job started', { 
      jobId, 
      type: job.type, 
      name: job.name 
    });

    return jobId;
  }

  updateJobProgress(jobId, progress, message = null) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    job.progress = Math.min(100, Math.max(0, progress));
    if (message) {
      job.logs.push({
        timestamp: new Date().toISOString(),
        message: message,
        level: 'info'
      });
    }

    this.broadcast({
      type: 'job_progress',
      jobId: jobId,
      data: {
        progress: job.progress,
        message: message,
        logs: job.logs.slice(-5) // Send last 5 logs
      }
    });
  }

  addJobLog(jobId, message, level = 'info') {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      message: message,
      level: level
    };

    job.logs.push(logEntry);

    // Add to buffer for batch persistence
    if (!this.logBuffer.has(jobId)) {
      this.logBuffer.set(jobId, []);
    }
    this.logBuffer.get(jobId).push(logEntry);

    // Broadcast immediately via WebSocket
    this.broadcast({
      type: 'job_log',
      jobId: jobId,
      data: logEntry
    });
  }

  addJobError(jobId, error) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: error.message || error,
      stack: error.stack,
      level: 'error'
    };

    job.errors.push(errorEntry);
    job.logs.push(errorEntry);

    this.broadcast({
      type: 'job_error',
      jobId: jobId,
      data: errorEntry
    });
  }

  updateJobStatus(jobId, status) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      logger.debug('Attempted to update status for non-existent job', { jobId, status });
      return;
    }

    job.status = status;
    
    // If status is 'failed' or 'completed', update endTime and schedule cleanup
    if (status === 'failed' || status === 'completed') {
      if (!job.endTime) {
        job.endTime = new Date().toISOString();
        if (job.startTime) {
          job.duration = new Date(job.endTime) - new Date(job.startTime);
        }
      }
      
      // Schedule cleanup of completed/failed jobs after a delay (30 minutes)
      // This prevents memory leaks while allowing clients to retrieve final status
      setTimeout(() => {
        const jobToCleanup = this.activeJobs.get(jobId);
        if (jobToCleanup && (jobToCleanup.status === 'failed' || jobToCleanup.status === 'completed')) {
          // Only cleanup if job is still in final state (not restarted)
          this.activeJobs.delete(jobId);
          this.logBuffer.delete(jobId);
          logger.debug('Cleaned up completed job from memory', { jobId, status: jobToCleanup.status });
        }
      }, 30 * 60 * 1000); // 30 minutes
    }

    this.broadcast({
      type: 'job_status_update',
      jobId: jobId,
      data: {
        status: status,
        job: job
      }
    });
  }

  async completeJob(jobId, result = null, success = true) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    job.status = success ? 'completed' : 'failed';
    job.endTime = new Date().toISOString();
    job.duration = new Date(job.endTime) - new Date(job.startTime);
    job.result = result;

    // Flush any remaining logs for this job to file immediately
    if (this.logBuffer.has(jobId)) {
      const bufferedLogs = this.logBuffer.get(jobId);
      if (bufferedLogs.length > 0) {
        try {
          await logStorageService.appendLogs(jobId, bufferedLogs);
        } catch (error) {
          logger.logError(error, { operation: 'flushFinalJobLogs', jobId });
        }
      }
      this.logBuffer.delete(jobId);
    }

    // Move to history
    this.activeJobs.delete(jobId);
    this.jobHistory.unshift(job);

    // Keep only last 100 jobs in history
    if (this.jobHistory.length > 100) {
      this.jobHistory = this.jobHistory.slice(0, 100);
    }

    this.broadcast({
      type: 'job_completed',
      data: job
    });

    logger.logOperation('Job completed', { 
      jobId, 
      status: job.status, 
      duration: job.duration 
    });
  }

  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        logger.logError(error, { operation: 'sendToClient' });
        this.clients.delete(ws);
      }
    }
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (error) {
          logger.logError(error, { operation: 'broadcast' });
          this.clients.delete(ws);
        }
      }
    });
  }

  getActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  getJobHistory(limit = 50) {
    return this.jobHistory.slice(0, limit);
  }

  getJobById(jobId) {
    return this.activeJobs.get(jobId) || this.jobHistory.find(j => j.id === jobId);
  }

  async abortJob(jobId, reason = 'Job aborted by user') {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'aborted';
      job.completedAt = new Date();
      job.duration = job.startedAt ? new Date() - new Date(job.startedAt) : 0;
      
      job.logs.push({
        timestamp: new Date(),
        message: reason,
        level: 'warn'
      });

      // Flush any remaining logs for this job to file immediately
      if (this.logBuffer.has(jobId)) {
        const bufferedLogs = this.logBuffer.get(jobId);
        if (bufferedLogs.length > 0) {
          try {
            await logStorageService.appendLogs(jobId, bufferedLogs);
          } catch (error) {
            logger.logError(error, { operation: 'flushAbortedJobLogs', jobId });
          }
        }
        this.logBuffer.delete(jobId);
      }

      // Move from active to history
      this.activeJobs.delete(jobId);
      this.jobHistory.unshift(job);

      // Broadcast abort event
      this.broadcast({
        type: 'job_aborted',
        data: job
      });

      logger.logOperation('Job aborted in monitor', { jobId, reason });
    }
  }

  // Integration with existing job system
  integrateWithJobRoutes(jobRoutes) {
    // Override the addJobToHistory function to also broadcast
    const originalAddJob = jobRoutes.addJobToHistory;
    if (originalAddJob) {
      jobRoutes.addJobToHistory = (job) => {
        // Call original function
        originalAddJob(job);
        
        // Also broadcast via WebSocket
        this.broadcast({
          type: 'job_added_to_history',
          data: job
        });
      };
    }
  }
  
  // Cleanup method for graceful shutdown
  shutdown() {
    // Stop the log flusher interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Final flush before shutdown
    this.flushLogsToDatabase().catch(error => {
      logger.logError(error, { operation: 'finalLogFlush' });
    });
    
    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }
    
    logger.logOperation('JobMonitor shutdown complete');
  }
}

module.exports = new JobMonitor();

