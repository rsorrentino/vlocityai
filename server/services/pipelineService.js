const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const notificationService = require('./notificationService');

// In-memory pipeline store (replace with DB model in future)
const _pipelines = new Map();

const VALID_STATUSES = ['idle', 'running', 'paused_awaiting_approval', 'completed', 'failed', 'aborted'];

class PipelineService {
  /**
   * Create a new pipeline definition.
   */
  create({ name, description = '', stages = [], createdBy = null }) {
    const id = uuidv4();
    const pipeline = {
      id,
      name,
      description,
      stages: stages.map((s, i) => ({
        name: s.name || `Stage ${i + 1}`,
        exportPath: s.exportPath || './export',
        targetOrg: s.targetOrg || '',
        runPreValidation: s.runPreValidation !== false,
        runPostValidation: s.runPostValidation !== false,
        requireApproval: s.requireApproval !== false,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        deployJobId: null,
        preValidationResult: null,
        postValidationResult: null
      })),
      status: 'idle',
      currentStageIndex: 0,
      createdBy,
      lastRunAt: null,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    _pipelines.set(id, pipeline);
    logger.info('Pipeline created', { id, name });
    return pipeline;
  }

  /**
   * List all pipelines.
   */
  list() {
    return Array.from(_pipelines.values()).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Get a single pipeline by ID.
   */
  get(id) {
    return _pipelines.get(id) || null;
  }

  /**
   * Update a pipeline definition (only allowed when status = idle).
   */
  update(id, updates) {
    const pipeline = this._require(id);
    if (pipeline.status !== 'idle') {
      throw new Error('Pipeline can only be modified when idle');
    }
    Object.assign(pipeline, {
      ...updates,
      id: pipeline.id,
      status: pipeline.status,
      updatedAt: new Date().toISOString()
    });
    return pipeline;
  }

  /**
   * Delete a pipeline (only when idle/completed/failed/aborted).
   */
  delete(id) {
    const pipeline = this._require(id);
    const terminatedStatuses = ['idle', 'completed', 'failed', 'aborted'];
    if (!terminatedStatuses.includes(pipeline.status)) {
      throw new Error('Cannot delete a running pipeline. Abort it first.');
    }
    _pipelines.delete(id);
    return true;
  }

  /**
   * Start a pipeline from stage 0.
   */
  async start(id, startedBy = null) {
    const pipeline = this._require(id);
    if (pipeline.status === 'running' || pipeline.status === 'paused_awaiting_approval') {
      throw new Error('Pipeline is already running');
    }

    // Reset all stages
    pipeline.stages.forEach(s => {
      s.status = 'pending';
      s.approvedBy = null;
      s.approvedAt = null;
      s.deployJobId = null;
      s.preValidationResult = null;
      s.postValidationResult = null;
    });

    pipeline.status = 'running';
    pipeline.currentStageIndex = 0;
    pipeline.lastRunAt = new Date().toISOString();
    pipeline.updatedAt = new Date().toISOString();

    logger.info('Pipeline started', { id, startedBy });

    // Run stage 0 asynchronously
    this._runStage(id, 0).catch(err => {
      logger.error('Pipeline stage execution error', { id, stageIndex: 0, error: err.message });
      this._failPipeline(id, err.message);
    });

    return pipeline;
  }

  /**
   * Execute a pipeline stage.
   * This runs pre-validation, deploy job, post-validation then sets stage to awaiting_approval.
   */
  async _runStage(pipelineId, stageIndex) {
    const pipeline = this._require(pipelineId);
    const stage = pipeline.stages[stageIndex];
    if (!stage) {
      // All stages done
      pipeline.status = 'completed';
      pipeline.updatedAt = new Date().toISOString();
      pipeline.history.push({ completedAt: new Date().toISOString(), status: 'completed' });
      notificationService.create({
        userId: null,
        type: 'pipeline_completed',
        title: `Pipeline "${pipeline.name}" completed`,
        message: `All ${pipeline.stages.length} stages completed successfully.`,
        relatedId: pipelineId,
        relatedType: 'pipeline',
        relatedUrl: `/pipeline/${pipelineId}`
      });
      return;
    }

    stage.status = 'running';
    pipeline.currentStageIndex = stageIndex;
    pipeline.updatedAt = new Date().toISOString();

    logger.info('Pipeline stage started', { pipelineId, stageIndex, stageName: stage.name });

    // Pre-validation (placeholder — wire to validationService when available)
    if (stage.runPreValidation) {
      stage.preValidationResult = { status: 'skipped', message: 'Pre-validation not configured' };
    }

    // Deploy job (placeholder — wire to deploysService when available)
    const fakeJobId = uuidv4();
    stage.deployJobId = fakeJobId;
    logger.info('Pipeline stage deploy job created (placeholder)', { pipelineId, stageIndex, fakeJobId });

    // Post-validation (placeholder)
    if (stage.runPostValidation) {
      stage.postValidationResult = { status: 'skipped', message: 'Post-validation not configured' };
    }

    // Always require approval (per plan)
    stage.status = 'awaiting_approval';
    pipeline.status = 'paused_awaiting_approval';
    pipeline.updatedAt = new Date().toISOString();

    notificationService.create({
      userId: null,
      type: 'pipeline_stage_awaiting_approval',
      title: `Pipeline "${pipeline.name}" — Stage ${stageIndex + 1} needs approval`,
      message: `Stage "${stage.name}" completed. Review and approve to continue.`,
      relatedId: pipelineId,
      relatedType: 'pipeline',
      relatedUrl: `/pipeline/${pipelineId}`
    });

    logger.info('Pipeline stage awaiting approval', { pipelineId, stageIndex });
  }

  /**
   * Approve a stage and proceed to the next.
   */
  async approveStage(pipelineId, stageIndex, approvedByUserId) {
    const pipeline = this._require(pipelineId);
    const stage = pipeline.stages[stageIndex];
    if (!stage) throw new Error(`Stage ${stageIndex} not found`);
    if (stage.status !== 'awaiting_approval') {
      throw new Error(`Stage ${stageIndex} is not awaiting approval (current status: ${stage.status})`);
    }

    stage.status = 'completed';
    stage.approvedBy = approvedByUserId;
    stage.approvedAt = new Date().toISOString();
    pipeline.status = 'running';
    pipeline.updatedAt = new Date().toISOString();

    logger.info('Pipeline stage approved', { pipelineId, stageIndex, approvedByUserId });

    // Start next stage
    const nextIndex = stageIndex + 1;
    this._runStage(pipelineId, nextIndex).catch(err => {
      logger.error('Pipeline stage execution error', { pipelineId, stageIndex: nextIndex, error: err.message });
      this._failPipeline(pipelineId, err.message);
    });

    return pipeline;
  }

  /**
   * Abort a running pipeline.
   */
  abort(pipelineId, reason = '') {
    const pipeline = this._require(pipelineId);
    const runningStatuses = ['running', 'paused_awaiting_approval'];
    if (!runningStatuses.includes(pipeline.status)) {
      throw new Error('Pipeline is not running');
    }
    pipeline.status = 'aborted';
    pipeline.updatedAt = new Date().toISOString();
    pipeline.history.push({ abortedAt: new Date().toISOString(), status: 'aborted', reason });

    // Mark current stage as failed
    const stage = pipeline.stages[pipeline.currentStageIndex];
    if (stage && stage.status === 'running') stage.status = 'failed';

    logger.info('Pipeline aborted', { pipelineId, reason });
    return pipeline;
  }

  _failPipeline(pipelineId, reason) {
    const pipeline = _pipelines.get(pipelineId);
    if (!pipeline) return;
    pipeline.status = 'failed';
    pipeline.updatedAt = new Date().toISOString();
    pipeline.history.push({ failedAt: new Date().toISOString(), status: 'failed', reason });

    notificationService.create({
      userId: null,
      type: 'pipeline_failed',
      title: `Pipeline "${pipeline.name}" failed`,
      message: reason,
      relatedId: pipelineId,
      relatedType: 'pipeline',
      relatedUrl: `/pipeline/${pipelineId}`
    });
  }

  _require(id) {
    const pipeline = _pipelines.get(id);
    if (!pipeline) throw new Error(`Pipeline ${id} not found`);
    return pipeline;
  }
}

module.exports = new PipelineService();
