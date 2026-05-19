const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// In-memory notification store (newest first)
const _store = [];
const MAX_STORED = 200;

const VALID_TYPES = [
  'job_completed', 'job_failed',
  'pipeline_stage_awaiting_approval', 'pipeline_completed', 'pipeline_failed',
  'export_health_warning', 'job_status'
];

class NotificationService {
  constructor() {
    // Lazy-load jobMonitor to avoid circular dependency
    this._jobMonitor = null;
  }

  _getJobMonitor() {
    if (!this._jobMonitor) {
      try { this._jobMonitor = require('./jobMonitor'); } catch (_) {}
    }
    return this._jobMonitor;
  }

  /**
   * Create a notification, store it in memory, and broadcast via WebSocket.
   * @param {Object} opts
   * @param {string|null} opts.userId        - Target user ID (null = all users)
   * @param {string}      opts.type          - Notification type
   * @param {string}      opts.title
   * @param {string}      opts.message
   * @param {string}      [opts.relatedId]   - Job ID or Pipeline ID
   * @param {string}      [opts.relatedType] - 'job' | 'pipeline'
   * @param {string}      [opts.relatedUrl]  - Front-end path to navigate to
   * @returns {Object} Created notification
   */
  create({ userId = null, type, title, message, relatedId = null, relatedType = null, relatedUrl = null }) {
    if (!VALID_TYPES.includes(type)) {
      logger.warn('Unknown notification type', { type });
    }

    const notification = {
      id: uuidv4(),
      userId,
      type,
      title,
      message,
      relatedId,
      relatedType,
      relatedUrl,
      read: false,
      createdAt: new Date().toISOString()
    };

    _store.unshift(notification);
    if (_store.length > MAX_STORED) _store.splice(MAX_STORED);

    // Broadcast via jobMonitor WebSocket so badge updates in real time
    try {
      const jm = this._getJobMonitor();
      if (jm && typeof jm.broadcast === 'function') {
        jm.broadcast({ type: 'notification', data: notification });
      }
    } catch (err) {
      logger.warn('Could not broadcast notification', { error: err.message });
    }

    logger.info('Notification created', { id: notification.id, type, title });
    return notification;
  }

  /**
   * Get notifications for a user (most recent first, limit 50).
   */
  getForUser(userId, limit = 50) {
    return _store
      .filter(n => n.userId === null || n.userId === userId)
      .slice(0, limit);
  }

  /**
   * Count unread notifications for a user.
   */
  getUnreadCount(userId) {
    return _store.filter(n => !n.read && (n.userId === null || n.userId === userId)).length;
  }

  /**
   * Mark a single notification as read.
   */
  markRead(notificationId) {
    const n = _store.find(x => x.id === notificationId);
    if (!n) return false;
    n.read = true;
    return true;
  }

  /**
   * Mark all notifications for a user as read.
   */
  markAllRead(userId) {
    _store
      .filter(n => n.userId === null || n.userId === userId)
      .forEach(n => { n.read = true; });
  }

  // ── Legacy API surface (kept for backwards compatibility) ────────────────

  subscribe() {}
  unsubscribe() {}

  async notifyJobStatus(jobId, status, userId) {
    let jobName = jobId;
    try {
      const { Job } = require('../models');
      const job = await Job.findByPk(jobId);
      if (job) jobName = job.name;
    } catch (_) {}

    const type = status === 'failed' ? 'job_failed' : 'job_completed';
    const title = status === 'failed' ? 'Job Failed' : 'Job Completed';
    const message = status === 'failed'
      ? `Job "${jobName}" failed`
      : `Job "${jobName}" completed successfully`;

    this.create({ userId, type, title, message, relatedId: jobId, relatedType: 'job', relatedUrl: `/jobs/export/${jobId}` });
  }

  async broadcast(notification) {
    this.create({ userId: null, ...notification });
  }
}

module.exports = new NotificationService();
