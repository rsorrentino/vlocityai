const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');

const jobMonitor = require('./jobMonitor');

/**
 * Check whether the `sfdmu` SF CLI plugin is installed.
 * Returns true/false without throwing.
 */
async function checkSfdmuInstalled() {
  return new Promise((resolve) => {
    const child = spawn('sf', ['plugins', '--core'], {
      shell: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    child.on('close', () => resolve(out.toLowerCase().includes('sfdmu')));
    child.on('error', () => resolve(false));
  });
}

/**
 * Build an export.json object from a config (DB model or inline object).
 *
 * @param {object} config
 * @param {Array}  config.objects   - array of ScriptObject configs
 * @param {object} config.settings  - global settings
 * @returns {object} export.json payload
 */
function buildExportJson(config) {
  const settings = config.settings || {};
  const objects = (config.objects || []).map(o => {
    const obj = {
      query: o.query || `SELECT ALL FROM ${o.sObjectType}`,
      operation: o.operation || 'Upsert',
    };

    // External ID (only for upsert-like ops)
    if (!['Insert', 'Delete', 'HardDelete', 'DeleteSource', 'DeleteHierarchy'].includes(obj.operation) && o.externalId) {
      obj.externalId = o.externalId;
    }

    // Advanced query options
    if (o.orderBy) obj.orderBy = o.orderBy;
    if (o.limit && o.limit > 0) obj.limit = o.limit;
    if (o.offset && o.offset > 0) obj.offset = o.offset;
    if (o.useQueryAll) obj.useQueryAll = true;

    // Delete options
    if (o.deleteOldData) obj.deleteOldData = true;
    if (o.deleteQuery) obj.deleteQuery = o.deleteQuery;
    if (o.skipExistingRecords) obj.skipExistingRecords = true;

    // Field exclusions
    if (o.excludedFields && o.excludedFields.length) obj.excludedFields = o.excludedFields;
    if (o.excludedFromUpdateFields && o.excludedFromUpdateFields.length) obj.excludedFromUpdateFields = o.excludedFromUpdateFields;

    // Field mapping
    if (o.useFieldMapping && o.fieldMapping && o.fieldMapping.length) {
      obj.fieldMapping = o.fieldMapping;
    }

    // Anonymization / mock
    if (o.updateWithMockData && o.mockFields && o.mockFields.length) {
      obj.mockFields = o.mockFields;
      obj.updateWithMockData = true;
    }

    return obj;
  });

  return {
    objects,
    bulkThreshold: settings.bulkThreshold ?? 200,
    simulationMode: !!settings.simulationMode,
    allOrNone: !!settings.allOrNone,
    concurrencyMode: settings.concurrencyMode || 'Serial',
    promptOnMissingParentObjects: false,
    promptOnIssuesInCSVFiles: false,
    // Advanced API settings
    ...(settings.apiVersion ? { apiVersion: settings.apiVersion } : {}),
    ...(settings.bulkApiVersion ? { bulkApiVersion: settings.bulkApiVersion } : {}),
    ...(settings.bulkApiV1BatchSize ? { bulkApiV1BatchSize: settings.bulkApiV1BatchSize } : {}),
    ...(settings.restApiBatchSize ? { restApiBatchSize: settings.restApiBatchSize } : {}),
    ...(settings.parallelBulkJobs ? { parallelBulkJobs: settings.parallelBulkJobs } : {}),
    ...(settings.parallelRestJobs ? { parallelRestJobs: settings.parallelRestJobs } : {}),
    // CSV options
    ...(settings.csvReadFileDelimiter ? { csvReadFileDelimiter: settings.csvReadFileDelimiter } : {}),
    ...(settings.csvWriteFileDelimiter ? { csvWriteFileDelimiter: settings.csvWriteFileDelimiter } : {}),
    ...(settings.createTargetCSVFiles ? { createTargetCSVFiles: true } : {}),
    ...(settings.importCSVFilesAsIs ? { importCSVFilesAsIs: true } : {}),
    ...(settings.excludeIdsFromCSVFiles ? { excludeIdsFromCSVFiles: true } : {}),
    ...(settings.validateCSVFilesOnly ? { validateCSVFilesOnly: true } : {}),
    // Behavior
    ...(settings.skipRecordsComparison ? { skipRecordsComparison: true } : {}),
    ...(settings.allowFieldTruncation ? { allowFieldTruncation: true } : {}),
    ...(settings.keepObjectOrderWhileExecute ? { keepObjectOrderWhileExecute: true } : {}),
  };
}

/**
 * Write a config's export.json to a directory on disk.
 *
 * @param {object} config  - config object (with objects + settings)
 * @param {string} dirPath - directory to write into
 * @returns {Promise<string>} full path to written file
 */
async function saveConfigToFile(config, dirPath) {
  await fs.ensureDir(dirPath);
  const exportJson = buildExportJson(config);
  const filePath = path.join(dirPath, 'export.json');
  await fs.writeFile(filePath, JSON.stringify(exportJson, null, 2), 'utf8');
  return filePath;
}

/**
 * Read and parse an export.json file from disk.
 *
 * @param {string} filePath - absolute path to export.json
 * @returns {Promise<object>}
 */
async function loadConfigFromFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Write the export.json config file and run `sf sfdmu run`.
 *
 * @param {object} opts
 * @param {string} opts.sourceUsername
 * @param {string} opts.targetUsername
 * @param {object} opts.exportConfig  - the export.json content
 * @param {string} opts.jobId         - DB job ID for WebSocket progress
 * @param {string} opts.workDir       - directory to write export.json into
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, code: number }>}
 */
async function runMigration({ sourceUsername, targetUsername, exportConfig, jobId, workDir }) {
  await fs.ensureDir(workDir);

  // Write export.json
  const exportJsonPath = path.join(workDir, 'export.json');
  await fs.writeFile(exportJsonPath, JSON.stringify(exportConfig, null, 2), 'utf8');

  logger.info('SFDMU: export.json written', { path: exportJsonPath, jobId });

  if (jobId) {
    jobMonitor.addJobLog(jobId, `📋 Config: ${exportJsonPath}`, 'info');
    jobMonitor.addJobLog(jobId, `📤 Source: ${sourceUsername}`, 'info');
    jobMonitor.addJobLog(jobId, `📥 Target: ${targetUsername}`, 'info');
  }

  const args = [
    'sfdmu', 'run',
    '--sourceusername', sourceUsername,
    '--targetusername', targetUsername,
    '--path', workDir,
    '--noprompt',
    '--filelog', '0',
  ];

  if (exportConfig.simulationMode) {
    args.push('--simulation');
  }

  const commandString = `sf ${args.join(' ')}`;

  if (jobId) {
    jobMonitor.addJobLog(jobId, `📋 Command: ${commandString}`, 'debug');
  }

  logger.info('SFDMU: starting run', { commandString, jobId });

  return new Promise((resolve, reject) => {
    const child = spawn('sf', args, {
      cwd: process.cwd(),
      shell: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (jobId) {
        text.split('\n').filter(l => l.trim()).forEach(line => {
          jobMonitor.addJobLog(jobId, line, 'info');
          if (/error/i.test(line) && !/\d+\s+errors?:\s*0/i.test(line)) {
            jobMonitor.addJobLog(jobId, line, 'warn');
          }
        });
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (jobId) {
        text.split('\n').filter(l => l.trim()).forEach(line => {
          // Filter node deprecation noise
          if (!/DeprecationWarning|DEP00\d{2}|\(node:\d+\)/.test(line)) {
            jobMonitor.addJobLog(jobId, line, 'error');
          }
        });
      }
    });

    child.on('close', (code) => {
      logger.info('SFDMU: run complete', { code, jobId });
      resolve({
        success: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.on('error', (err) => {
      logger.logError(err, { operation: 'sfdmu run', jobId });
      reject(err);
    });
  });
}

module.exports = { checkSfdmuInstalled, buildExportJson, saveConfigToFile, loadConfigFromFile, runMigration };
