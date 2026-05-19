const { spawn } = require('child_process');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class JobExecutionService extends EventEmitter {
  constructor() {
    super();
    this.maxConcurrentExecutions = parseInt(process.env.JOB_EXECUTION_MAX_CONCURRENT, 10) || 2;
    this.activeCount = 0;
    this.queue = [];
    this.pendingByJobId = new Map();
    this.activeByJobId = new Map();
  }

  enqueueExecution({ jobId, label = 'job', execute }) {
    if (typeof execute !== 'function') {
      throw new Error('execute function is required');
    }

    return new Promise((resolve, reject) => {
      const item = {
        jobId,
        label,
        execute,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      if (jobId) {
        if (this.pendingByJobId.has(jobId) || this.activeByJobId.has(jobId)) {
          reject(new Error(`Job ${jobId} is already queued or running`));
          return;
        }
      }

      if (this.activeCount < this.maxConcurrentExecutions) {
        this.startItem(item);
      } else {
        this.queue.push(item);
        if (jobId) {
          this.pendingByJobId.set(jobId, item);
        }
        this.emit('queued', {
          jobId,
          label,
          queueLength: this.queue.length,
          activeCount: this.activeCount,
        });
      }
    });
  }

  async abortJob(jobId, reason = 'Aborted by user') {
    if (!jobId) {
      return { state: 'invalid' };
    }

    const pendingItem = this.pendingByJobId.get(jobId);
    if (pendingItem) {
      this.pendingByJobId.delete(jobId);
      this.queue = this.queue.filter((item) => item !== pendingItem);
      const error = new Error(reason);
      error.code = 'JOB_ABORTED';
      pendingItem.reject(error);

      this.emit('aborted', { jobId, state: 'queued', reason });
      return { state: 'queued' };
    }

    const active = this.activeByJobId.get(jobId);
    if (!active) {
      return { state: 'not-found' };
    }

    active.aborted = true;
    active.abortReason = reason;

    if (active.child && !active.child.killed) {
      this.terminateChild(active.child);
    }

    this.emit('aborted', { jobId, state: 'running', reason });
    return { state: 'running' };
  }

  terminateChild(child) {
    if (!child || child.killed) {
      return;
    }

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).on('error', () => {
          try {
            child.kill('SIGTERM');
          } catch (error) {
            logger.debug('Failed to SIGTERM child process after taskkill error', { error: error.message });
          }
        });
      } else {
        child.kill('SIGTERM');
      }
    } catch (error) {
      logger.debug('Failed to terminate child process', { error: error.message });
    }
  }

  startItem(item) {
    const { jobId, label } = item;

    this.activeCount += 1;
    if (jobId) {
      this.pendingByJobId.delete(jobId);
      this.activeByJobId.set(jobId, {
        child: null,
        label,
        startedAt: Date.now(),
        aborted: false,
        abortReason: null,
      });
    }

    const setProcess = (child) => {
      if (!jobId) {
        return;
      }
      const active = this.activeByJobId.get(jobId);
      if (active) {
        active.child = child;
      }
    };

    const isAborted = () => {
      if (!jobId) {
        return false;
      }
      const active = this.activeByJobId.get(jobId);
      return !!active?.aborted;
    };

    const getAbortReason = () => {
      if (!jobId) {
        return 'Aborted by user';
      }
      const active = this.activeByJobId.get(jobId);
      return active?.abortReason || 'Aborted by user';
    };

    this.emit('started', {
      jobId,
      label,
      queueLength: this.queue.length,
      activeCount: this.activeCount,
    });

    Promise.resolve()
      .then(() => item.execute({ setProcess, isAborted, getAbortReason }))
      .then((result) => {
        item.resolve(result);
      })
      .catch((error) => {
        item.reject(error);
      })
      .finally(() => {
        if (jobId) {
          this.activeByJobId.delete(jobId);
        }
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.pump();
      });
  }

  pump() {
    while (this.activeCount < this.maxConcurrentExecutions && this.queue.length > 0) {
      const next = this.queue.shift();
      this.startItem(next);
    }
  }

  getStats() {
    return {
      maxConcurrentExecutions: this.maxConcurrentExecutions,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      activeJobIds: Array.from(this.activeByJobId.keys()),
      queuedJobIds: Array.from(this.pendingByJobId.keys()),
    };
  }
}

module.exports = new JobExecutionService();
