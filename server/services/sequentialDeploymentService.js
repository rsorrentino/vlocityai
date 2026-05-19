/**
 * Sequential Deployment Service
 *
 * Orchestrates deployments in the strict 27-step sequence defined in
 * server/config/deploymentSequence.js.
 *
 * Algorithm per step:
 *   1.  Check whether the object type is present in the project path.
 *       – DataPack  → look for a sub-folder matching the DataPack type name.
 *       – Manual    → look for a <ObjectType>.json file in the project path.
 *   2.  Check if the step should be skipped because the object type was already
 *       deployed as a nested child in a prior step.
 *   3.  Execute the appropriate deploy strategy:
 *       – DataPack  → create a focused YAML job file (one type) + vlocity packDeploy.
 *       – Manual    → copy the JSON file to a per-step temp dir + sf CLI deploy.
 *   4.  Emit real-time progress to the React frontend via WebSocket (jobMonitor).
 *   5.  Record per-step result; on error apply configurable continueOnError policy.
 */

'use strict';

const fs      = require('fs-extra');
const path    = require('path');
const os      = require('os');
const yaml    = require('yaml');
const logger  = require('../utils/logger');
const jobMonitor = require('./jobMonitor');
const vlocityService  = require('./vlocityService');
const sfCliService    = require('./sfCliService');
const { DEPLOYMENT_SEQUENCE, NESTED_IN_MAP } = require('../config/deploymentSequence');

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * List sub-directory names inside a directory (non-recursive).
 * Returns an empty array on any read error.
 */
async function listSubdirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

/**
 * List .json file basenames (without extension) inside a directory.
 * Returns an empty array on any read error.
 */
async function listJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
  } catch {
    return [];
  }
}

/**
 * Write a minimal Vlocity job YAML that deploys a single DataPack type
 * from a given project path.
 */
async function writeFocusedJobFile(jobFilePath, baseConfig, dataPackType, projectPath) {
  const jobConfig = {
    ...baseConfig,
    queries: [dataPackType],
    projectPath,
  };
  // Remove keys that conflict with per-step focus
  delete jobConfig.name;
  const content = yaml.stringify(jobConfig, { indent: 2, lineWidth: 0 });
  await fs.outputFile(jobFilePath, content, 'utf8');
}

/**
 * Emit a structured log line to the WebSocket channel for a given job.
 */
function log(jobId, message, severity = 'info') {
  logger[severity === 'error' ? 'error' : 'info'](message, { jobId });
  if (jobId) jobMonitor.addJobLog(jobId, message, severity);
}

// ─── main orchestrator ───────────────────────────────────────────────────────

/**
 * Run all 27 steps sequentially.
 *
 * @param {Object} params
 * @param {string}  params.targetUsername   - Salesforce org username/alias
 * @param {string}  params.projectPath      - Absolute path to the DataPack export
 * @param {Object}  params.baseJobConfig    - Shared vlocity job YAML settings (projectPath, sfdx.username, etc.)
 * @param {string}  [params.jobId]          - DB job ID for WebSocket streaming
 * @param {boolean} [params.continueOnError=true]  - Keep going after a failed step
 * @param {string}  [params.version]        - Vlocity CLI version flag
 * @returns {Promise<SequentialDeployResult>}
 */
async function runSequentialDeployment({
  targetUsername,
  projectPath,
  baseJobConfig = {},
  jobId = null,
  continueOnError = true,
  version = null,
}) {
  if (!targetUsername) throw new Error('targetUsername is required');
  if (!projectPath)    throw new Error('projectPath is required');

  const resolvedProjectPath = path.resolve(projectPath);
  if (!await fs.pathExists(resolvedProjectPath)) {
    throw new Error(`Project path does not exist: ${resolvedProjectPath}`);
  }

  // Discover what is actually present in the export directory
  const dataPpackFolders = new Set(await listSubdirs(resolvedProjectPath));
  const manualJsonFiles  = new Set(await listJsonFiles(resolvedProjectPath));

  log(jobId, `Starting sequential deployment: ${DEPLOYMENT_SEQUENCE.length} steps, path: ${resolvedProjectPath}`, 'info');
  log(jobId, `DataPack folders found: ${[...dataPpackFolders].join(', ') || 'none'}`, 'info');
  log(jobId, `Manual JSON files found: ${[...manualJsonFiles].join(', ') || 'none'}`, 'info');

  // Track which object types have been deployed in this run (including nested children)
  const deployed = new Set();

  const stepResults = [];
  let successCount = 0;
  let skippedCount = 0;
  let errorCount   = 0;

  // Create a dedicated temp directory for this sequential run
  const runTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vdm-seq-'));

  try {
    for (const step of DEPLOYMENT_SEQUENCE) {
      const { step: stepNum, objectType, vlocityDataPackType, deploymentType, nestedObjects, skipIfNestedIn } = step;

      const stepLabel = `Step ${String(stepNum).padStart(2, '0')}/${DEPLOYMENT_SEQUENCE.length} [${objectType}]`;

      // ── Check skip: already deployed as nested child of a prior step ────────
      if (skipIfNestedIn && deployed.has(skipIfNestedIn)) {
        const reason = `Already deployed as nested child of ${skipIfNestedIn}`;
        log(jobId, `⏭  ${stepLabel} — SKIPPED (${reason})`, 'info');
        stepResults.push({ step: stepNum, objectType, status: 'skipped', reason });
        skippedCount++;
        continue;
      }

      // ── Check presence in export ─────────────────────────────────────────────
      const presentInExport =
        deploymentType === 'datapack'
          ? dataPpackFolders.has(vlocityDataPackType) || dataPpackFolders.has(objectType)
          : manualJsonFiles.has(objectType);

      if (!presentInExport) {
        const reason = `Not found in export (${deploymentType === 'datapack' ? 'no folder' : 'no JSON file'})`;
        log(jobId, `⏭  ${stepLabel} — SKIPPED (${reason})`, 'info');
        stepResults.push({ step: stepNum, objectType, status: 'skipped', reason });
        skippedCount++;
        continue;
      }

      // ── Update WebSocket progress ────────────────────────────────────────────
      const progressPct = Math.round(((stepNum - 1) / DEPLOYMENT_SEQUENCE.length) * 100);
      if (jobId) jobMonitor.updateJobProgress(jobId, progressPct, `${stepLabel} — deploying…`);

      log(jobId, `▶  ${stepLabel} — starting ${deploymentType} deploy…`, 'info');

      try {
        if (deploymentType === 'datapack') {
          await deployDataPackStep({ step, targetUsername, resolvedProjectPath, baseJobConfig, jobId, version, runTempDir });
        } else {
          await deployManualStep({ step, targetUsername, resolvedProjectPath, jobId, runTempDir });
        }

        // Mark this type and all its nested children as deployed
        deployed.add(objectType);
        nestedObjects.forEach(n => deployed.add(n));

        log(jobId, `✅ ${stepLabel} — completed`, 'info');
        stepResults.push({ step: stepNum, objectType, status: 'success' });
        successCount++;

      } catch (err) {
        errorCount++;
        const errorMsg = err.message || String(err);
        log(jobId, `❌ ${stepLabel} — FAILED: ${errorMsg}`, 'error');
        stepResults.push({ step: stepNum, objectType, status: 'error', error: errorMsg });

        if (!continueOnError) {
          log(jobId, `Sequential deployment aborted at step ${stepNum} (continueOnError=false)`, 'error');
          break;
        }
      }
    }
  } finally {
    // Clean up the per-run temp directory
    await fs.remove(runTempDir).catch(() => {});
  }

  if (jobId) jobMonitor.updateJobProgress(jobId, 100, `Sequential deployment finished: ${successCount} succeeded, ${skippedCount} skipped, ${errorCount} failed`);

  const summary = {
    totalSteps: DEPLOYMENT_SEQUENCE.length,
    successCount,
    skippedCount,
    errorCount,
    passed: errorCount === 0,
  };

  log(jobId, `Sequential deployment complete. Success: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`, errorCount > 0 ? 'warn' : 'info');

  return { summary, steps: stepResults };
}

// ─── per-step deploy helpers ─────────────────────────────────────────────────

/**
 * Deploy a single DataPack type via a focused vlocity job YAML.
 */
async function deployDataPackStep({ step, targetUsername, resolvedProjectPath, baseJobConfig, jobId, version, runTempDir }) {
  const { vlocityDataPackType, objectType } = step;
  const typeKey = vlocityDataPackType || objectType;

  const jobFileName  = `seq-step-${step.step}-${typeKey}.yaml`;
  const jobFilePath  = path.join(runTempDir, jobFileName);

  const jobBase = {
    sfdx: { username: targetUsername },
    projectPath: resolvedProjectPath,
    defaultMaxParallel: baseJobConfig.defaultMaxParallel || 5,
    compileOnBuild: baseJobConfig.compileOnBuild ?? false,
    ...baseJobConfig,
  };

  await writeFocusedJobFile(jobFilePath, jobBase, typeKey, resolvedProjectPath);

  await vlocityService.deployDataPacks(targetUsername, jobFilePath, jobId, version);
}

/**
 * Deploy a single "manual" (GT / Catalog) object via sf CLI.
 * Copies only the relevant JSON file to a per-step temp directory and
 * calls sfCliService.deployCustomObjects.
 */
async function deployManualStep({ step, targetUsername, resolvedProjectPath, jobId, runTempDir }) {
  const { objectType } = step;
  const sourceFile = path.join(resolvedProjectPath, `${objectType}.json`);

  if (!await fs.pathExists(sourceFile)) {
    throw new Error(`Manual deploy source file not found: ${sourceFile}`);
  }

  // Isolated temp dir so sfCliService only picks up this one object
  const stepTempDir = path.join(runTempDir, `manual-step-${step.step}`);
  await fs.ensureDir(stepTempDir);
  await fs.copy(sourceFile, path.join(stepTempDir, `${objectType}.json`));

  await sfCliService.deployCustomObjects({
    targetUsername,
    sourcePath: stepTempDir,
    jobId,
  });
}

module.exports = { runSequentialDeployment };
