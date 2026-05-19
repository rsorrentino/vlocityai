const express = require('express');
const router = express.Router();
const getVlocityCommandsService = require('../services/vlocityCommandsService');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs-extra');
const jobMonitor = require('../services/jobMonitor');
const jobHistoryService = require('../services/jobHistoryService');

// Get service instance
const vlocityCommandsService = getVlocityCommandsService();

/**
 * @swagger
 * /api/vlocity-commands:
 *   get:
 *     operationId: listVlocityCommands
 *     summary: List available commands
 *     description: Returns all available Vlocity commands grouped into primary, troubleshooting, and additional categories with their descriptions
 *     tags: [Vlocity Commands]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Grouped command list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 commands:
 *                   type: object
 *                   properties:
 *                     primary:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           description:
 *                             type: string
 *                     troubleshooting:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           description:
 *                             type: string
 *                     additional:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           description:
 *                             type: string
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
  const commands = vlocityCommandsService.getAvailableCommands();
  
  // Add descriptions to each command
  const commandsWithDescriptions = {
    primary: commands.primary.map(cmd => ({
      name: cmd,
      description: vlocityCommandsService.getCommandDocumentation(cmd)?.description || 'No description available',
    })),
    troubleshooting: commands.troubleshooting.map(cmd => ({
      name: cmd,
      description: vlocityCommandsService.getCommandDocumentation(cmd)?.description || 'No description available',
    })),
    additional: commands.additional.map(cmd => ({
      name: cmd,
      description: vlocityCommandsService.getCommandDocumentation(cmd)?.description || 'No description available',
    })),
  };
  
  res.json({
    success: true,
    commands: commandsWithDescriptions,
  });
}));

/**
 * @swagger
 * /api/vlocity-commands/{command}:
 *   get:
 *     operationId: getVlocityCommandDocs
 *     summary: Get command documentation
 *     description: Returns detailed documentation for a specific Vlocity command
 *     tags: [Vlocity Commands]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: command
 *         required: true
 *         schema:
 *           type: string
 *         description: Vlocity command name (e.g. packExport, packDeploy)
 *         example: packExport
 *     responses:
 *       200:
 *         description: Command documentation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 command:
 *                   type: string
 *                 documentation:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Command not found
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
router.get('/:command', asyncHandler(async (req, res) => {
  const { command } = req.params;
  const doc = vlocityCommandsService.getCommandDocumentation(command);
  
  if (!doc) {
    return res.status(404).json({
      success: false,
      error: `Command '${command}' not found`,
    });
  }
  
  res.json({
    success: true,
    command,
    documentation: doc,
  });
}));

/**
 * @swagger
 * /api/vlocity-commands/{command}/execute:
 *   post:
 *     operationId: executeVlocityCommand
 *     summary: Execute command
 *     description: >
 *       Execute a named Vlocity command asynchronously. Returns a jobId immediately;
 *       progress is streamed via WebSocket. Supported commands include packExport,
 *       packDeploy, packExportSingle, packExportAllDefault, packContinue, packRetry,
 *       validateLocalData, cleanOrgData, refreshProject, checkStaleObjects,
 *       packGetDiffs, packGetDiffsAndDeploy, packBuildFile, runJavaScript, runApex,
 *       packGetAllAvailableExports, refreshVlocityBase, installVlocityInitial,
 *       installDPsfromStaticResource, packUpdateSettings, packValidate.
 *     tags: [Vlocity Commands]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: command
 *         required: true
 *         schema:
 *           type: string
 *         description: Vlocity command name
 *         example: packExport
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *             properties:
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               options:
 *                 type: object
 *                 description: Command-specific options (e.g. jobFile, type, id, apexCode, scriptPath)
 *     responses:
 *       200:
 *         description: Command execution started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 jobId:
 *                   type: string
 *                   description: WebSocket job ID to track progress
 *                 command:
 *                   type: string
 *                 message:
 *                   type: string
 *                 job:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *       400:
 *         description: Missing required fields
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
router.post('/:command/execute', asyncHandler(async (req, res) => {
  const { command } = req.params;
  const { username, options = {} } = req.body;
  
  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required',
    });
  }
  
  // Generate a job ID for WebSocket streaming
  const jobId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Create job record immediately (non-blocking)
  let createdJob = null;
  try {
    createdJob = await jobHistoryService.addJobToHistory({
      type: 'vlocity-command',
      name: `${command} - ${username}`,
      status: 'running',
      username: username,
      configuration: {
        command,
        options,
      },
      message: `Executing ${command} command`,
      startedAt: new Date().toISOString(),
      jobId: jobId,
    });
    
    // Register job with job monitor for WebSocket streaming
    jobMonitor.addJob(jobId, {
      id: createdJob.id,
      type: 'vlocity-command',
      command,
      username,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    
    jobMonitor.addJobLog(jobId, `🚀 Starting ${command} command execution...`, 'info');
  } catch (error) {
    logger.logError(error, { operation: 'createCommandJob', command, username });
    // Continue even if job creation fails
  }
  
  // Return immediately with job ID (non-blocking response)
  res.json({
    success: true,
    jobId,
    command,
    message: 'Command execution started. Use WebSocket to monitor progress.',
    job: createdJob ? {
      id: createdJob.id,
      status: 'running',
    } : null,
  });
  
  // Execute command in background (don't await - fire and forget)
  // Wrap in setImmediate to ensure response is sent first, and handle all errors
  setImmediate(() => {
    executeCommandAsync(command, username, options, jobId, createdJob?.id).catch(error => {
      logger.logError(error, { operation: `executeCommandAsync_${command}`, username, jobId });
      
      // Update job monitor
      try {
        jobMonitor.addJobLog(jobId, `❌ Command execution failed: ${error.message}`, 'error');
        jobMonitor.updateJobStatus(jobId, 'failed');
      } catch (monitorError) {
        logger.logError(monitorError, { operation: 'updateJobMonitorOnError', jobId });
      }
      
      // Update job history if available
      if (createdJob?.id) {
        jobHistoryService.updateJobStatus(createdJob.id, 'failed', error.message).catch(err => {
          logger.logError(err, { operation: 'updateJobStatus', jobId: createdJob.id });
        });
      }
    });
  });
}));

/**
 * Execute command asynchronously in the background
 */
async function executeCommandAsync(command, username, options, jobId, historyJobId) {
  try {
    let result;
    
    // Route to appropriate command method based on command name
    switch (command) {
      case 'packExport':
        jobMonitor.addJobLog(jobId, `📦 Starting packExport...`, 'info');
        result = await vlocityCommandsService.packExport(
          username,
          options.jobFile,
          jobId,
          options.version
        );
        break;
        
      case 'packExportSingle':
        if (!options.type || !options.id) {
          throw new Error('type and id are required for packExportSingle');
        }
        jobMonitor.addJobLog(jobId, `📦 Starting packExportSingle for ${options.type}...`, 'info');
        result = await vlocityCommandsService.packExportSingle(
          username,
          options.jobFile,
          options.type,
          options.id,
          options.depth,
          jobId
        );
        break;
        
      case 'packExportAllDefault':
        jobMonitor.addJobLog(jobId, `📦 Starting packExportAllDefault...`, 'info');
        result = await vlocityCommandsService.packExportAllDefault(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'packDeploy':
        jobMonitor.addJobLog(jobId, `🚀 Starting packDeploy...`, 'info');
        result = await vlocityCommandsService.packDeploy(
          username,
          options.jobFile,
          jobId,
          options.version
        );
        break;
        
      case 'packContinue':
        result = await vlocityCommandsService.packContinue(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'packRetry':
        result = await vlocityCommandsService.packRetry(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'validateLocalData':
        result = await vlocityCommandsService.validateLocalData(
          username,
          options.jobFile,
          options.fixLocalGlobalKeys || false,
          jobId
        );
        break;
        
      case 'cleanOrgData':
        result = await vlocityCommandsService.cleanOrgData(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'refreshProject':
        result = await vlocityCommandsService.refreshProject(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'checkStaleObjects':
        result = await vlocityCommandsService.checkStaleObjects(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'packGetDiffs':
        result = await vlocityCommandsService.packGetDiffs(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'packGetDiffsAndDeploy':
        result = await vlocityCommandsService.packGetDiffsAndDeploy(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'packBuildFile':
        result = await vlocityCommandsService.packBuildFile(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'runJavaScript':
        if (!options.scriptPath) {
          throw new Error('scriptPath is required for runJavaScript');
        }
        jobMonitor.addJobLog(jobId, `📜 Starting runJavaScript...`, 'info');
        result = await vlocityCommandsService.runJavaScript(
          username,
          options.scriptPath,
          options.scriptArgs || {},
          jobId
        );
        break;
        
      case 'runApex':
        if (!options.apexCode) {
          throw new Error('apexCode is required for runApex');
        }
        jobMonitor.addJobLog(jobId, `⚡ Starting runApex...`, 'info');
        result = await vlocityCommandsService.runApex(
          username,
          options.apexCode,
          jobId
        );
        break;
        
      case 'packGetAllAvailableExports':
        result = await vlocityCommandsService.packGetAllAvailableExports(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'refreshVlocityBase':
        result = await vlocityCommandsService.refreshVlocityBase(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'installVlocityInitial':
        result = await vlocityCommandsService.installVlocityInitial(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'installDPsfromStaticResource':
        if (!options.staticResourceName) {
          throw new Error('staticResourceName is required for installDPsfromStaticResource');
        }
        jobMonitor.addJobLog(jobId, `📦 Starting installDPsfromStaticResource...`, 'info');
        result = await vlocityCommandsService.installDPsfromStaticResource(
          username,
          options.staticResourceName,
          options.jobFile,
          jobId
        );
        break;
        
      case 'packUpdateSettings':
        result = await vlocityCommandsService.packUpdateSettings(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      case 'packValidate':
        result = await vlocityCommandsService.packValidate(
          username,
          options.jobFile,
          jobId
        );
        break;
        
      default:
        throw new Error(`Command '${command}' is not implemented`);
    }
    
    // Command completed successfully
    const stdout = result?.stdout || '';
    const stderr = result?.stderr || '';
    const exitCode = result?.exitCode || 0;
    
    // Stream output to job monitor
    if (stdout) {
      jobMonitor.addJobLog(jobId, stdout, 'info');
    }
    if (stderr) {
      jobMonitor.addJobLog(jobId, stderr, exitCode === 0 ? 'warn' : 'error');
    }
    
    // Update job status
    const finalStatus = exitCode === 0 ? 'completed' : 'failed';
    jobMonitor.addJobLog(jobId, `✅ Command ${command} ${finalStatus === 'completed' ? 'completed successfully' : 'failed'}`, finalStatus === 'completed' ? 'info' : 'error');
    jobMonitor.updateJobStatus(jobId, finalStatus);
    
    if (historyJobId) {
      await jobHistoryService.updateJobStatus(historyJobId, finalStatus, exitCode === 0 ? 'Command completed successfully' : `Command failed with exit code ${exitCode}`);
      if (stdout || stderr) {
        await jobHistoryService.addJobLog(historyJobId, `Output:\n${stdout}\n${stderr}`, exitCode === 0 ? 'info' : 'error');
      }
    }
    
    logger.logOperation(`Command ${command} ${finalStatus}`, { username, jobId, exitCode });
  } catch (error) {
    logger.logError(error, { operation: `executeCommandAsync_${command}`, username, jobId });
    
    // Update job status to failed
    jobMonitor.addJobLog(jobId, `❌ Command execution failed: ${error.message}`, 'error');
    jobMonitor.updateJobStatus(jobId, 'failed');
    
    if (historyJobId) {
      await jobHistoryService.updateJobStatus(historyJobId, 'failed', error.message).catch(err => {
        logger.logError(err, { operation: 'updateJobStatus', jobId: historyJobId });
      });
    }
    
    // Re-throw to be caught by the caller
    throw error;
  }
}

module.exports = router;

