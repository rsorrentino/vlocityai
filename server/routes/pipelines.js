const express = require('express');
const router = express.Router();
const { asyncHandler, NotFoundError, ValidationError } = require('../middleware/errorHandler');
const pipelineService = require('../services/pipelineService');

/**
 * @swagger
 * /api/pipelines:
 *   get:
 *     operationId: listPipelines
 *     summary: List all pipelines
 *     description: Returns an array of all deployment pipelines registered in the system.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pipelines retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pipelines:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Pipeline'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', asyncHandler(async (req, res) => {
  const pipelines = pipelineService.list();
  res.json({ success: true, pipelines });
}));

/**
 * @swagger
 * /api/pipelines:
 *   post:
 *     operationId: createPipeline
 *     summary: Create a new pipeline
 *     description: Creates a new deployment pipeline with one or more ordered stages.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - stages
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique name for the pipeline
 *                 example: Production Deployment
 *               description:
 *                 type: string
 *                 description: Optional human-readable description
 *                 example: Full product catalog deployment to production
 *               stages:
 *                 type: array
 *                 description: Ordered list of pipeline stages (at least one required)
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: Export from DEV
 *                     type:
 *                       type: string
 *                       enum: [export, deploy, approval]
 *                       example: export
 *                     config:
 *                       type: object
 *                       description: Stage-specific configuration
 *     responses:
 *       201:
 *         description: Pipeline created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pipeline:
 *                   $ref: '#/components/schemas/Pipeline'
 *       400:
 *         description: Validation error — name or stages missing/invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', asyncHandler(async (req, res) => {
  const { name, description, stages } = req.body;
  if (!name) throw new ValidationError('Pipeline name is required');
  if (!stages || !Array.isArray(stages) || stages.length === 0) {
    throw new ValidationError('At least one stage is required');
  }
  const pipeline = pipelineService.create({
    name, description, stages,
    createdBy: req.user?.id || null
  });
  res.status(201).json({ success: true, pipeline });
}));

/**
 * @swagger
 * /api/pipelines/{id}:
 *   get:
 *     operationId: getPipeline
 *     summary: Get a single pipeline
 *     description: Returns full details of a specific pipeline, including its stages and current execution state.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pipeline ID
 *         example: pip_abc123
 *     responses:
 *       200:
 *         description: Pipeline retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pipeline:
 *                   $ref: '#/components/schemas/Pipeline'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Pipeline not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const pipeline = pipelineService.get(req.params.id);
  if (!pipeline) throw new NotFoundError(`Pipeline ${req.params.id} not found`);
  res.json({ success: true, pipeline });
}));

/**
 * @swagger
 * /api/pipelines/{id}:
 *   put:
 *     operationId: updatePipeline
 *     summary: Update a pipeline
 *     description: Updates the name, description, or stages of an existing pipeline. Only allowed when the pipeline is in an idle state.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pipeline ID
 *         example: pip_abc123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated pipeline name
 *                 example: Production Deployment v2
 *               description:
 *                 type: string
 *                 description: Updated description
 *               stages:
 *                 type: array
 *                 description: Updated ordered list of stages
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [export, deploy, approval]
 *                     config:
 *                       type: object
 *     responses:
 *       200:
 *         description: Pipeline updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pipeline:
 *                   $ref: '#/components/schemas/Pipeline'
 *       400:
 *         description: Validation error or pipeline is currently running
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Pipeline not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, description, stages } = req.body;
  const pipeline = pipelineService.update(req.params.id, { name, description, stages });
  res.json({ success: true, pipeline });
}));

/**
 * @swagger
 * /api/pipelines/{id}/start:
 *   post:
 *     operationId: startPipeline
 *     summary: Start pipeline execution
 *     description: Triggers execution of the pipeline, running each stage in sequence. The pipeline must be in an idle state.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pipeline ID
 *         example: pip_abc123
 *     responses:
 *       200:
 *         description: Pipeline started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pipeline:
 *                   $ref: '#/components/schemas/Pipeline'
 *       400:
 *         description: Pipeline is already running or in an invalid state to start
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Pipeline not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:id/start', asyncHandler(async (req, res) => {
  const pipeline = await pipelineService.start(req.params.id, req.user?.id || null);
  res.json({ success: true, pipeline });
}));

/**
 * @swagger
 * /api/pipelines/{id}/stages/{index}/approve:
 *   post:
 *     operationId: approvePipelineStage
 *     summary: Approve a pipeline stage
 *     description: Approves the specified stage of a running pipeline, allowing execution to advance to the next stage. Used for manual approval gates.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pipeline ID
 *         example: pip_abc123
 *       - in: path
 *         name: index
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Zero-based index of the stage to approve
 *         example: 1
 *     responses:
 *       200:
 *         description: Stage approved and pipeline advanced successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pipeline:
 *                   $ref: '#/components/schemas/Pipeline'
 *       400:
 *         description: Stage index is not a valid number or stage is not awaiting approval
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Pipeline not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:id/stages/:index/approve', asyncHandler(async (req, res) => {
  const stageIndex = parseInt(req.params.index, 10);
  if (isNaN(stageIndex)) throw new ValidationError('Stage index must be a number');
  const pipeline = await pipelineService.approveStage(req.params.id, stageIndex, req.user?.id || null);
  res.json({ success: true, pipeline });
}));

/**
 * @swagger
 * /api/pipelines/{id}/abort:
 *   post:
 *     operationId: abortPipeline
 *     summary: Abort a running pipeline
 *     description: Stops a currently running pipeline, optionally recording a reason for the abort. Any in-progress stage is halted and the pipeline status is set to aborted.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pipeline ID
 *         example: pip_abc123
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Optional reason for aborting the pipeline
 *                 example: Hotfix deployment required — aborting scheduled run
 *     responses:
 *       200:
 *         description: Pipeline aborted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pipeline:
 *                   $ref: '#/components/schemas/Pipeline'
 *       400:
 *         description: Pipeline is not in a running state
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Pipeline not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:id/abort', asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const pipeline = pipelineService.abort(req.params.id, reason);
  res.json({ success: true, pipeline });
}));

/**
 * @swagger
 * /api/pipelines/{id}:
 *   delete:
 *     operationId: deletePipeline
 *     summary: Delete a pipeline
 *     description: Permanently deletes a pipeline. Only pipelines in an idle, completed, failed, or aborted state can be deleted.
 *     tags:
 *       - Deployment Pipelines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pipeline ID
 *         example: pip_abc123
 *     responses:
 *       200:
 *         description: Pipeline deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Pipeline deleted
 *       400:
 *         description: Pipeline is currently running and cannot be deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Pipeline not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  pipelineService.delete(req.params.id);
  res.json({ success: true, message: 'Pipeline deleted' });
}));

module.exports = router;
