const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const logger = require('../utils/logger');
const errorLogParser = require('./errorLogParser');
const salesforceMetadataService = require('./salesforceMetadataService');
const vlocityService = require('./vlocityService');
const jobMonitor = require('./jobMonitor');
const jobStateService = require('./jobStateService');
const vlocityErrorHandler = require('./vlocityErrorHandler');

/**
 * Service for handling export recovery (missing dependencies)
 */
class ExportRecoveryService {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'server', 'temp', 'recovery');
    this.ensureTempDir();
  }

  ensureTempDir() {
    fs.ensureDirSync(this.tempDir);
  }

  /**
   * Recover from errors using error analysis
   * @param {string} jobId - Original job ID
   * @param {string} username - Salesforce username
   * @returns {Promise<string|null>} Recovery job ID or null
   */
  async recoverFromErrors(jobId, username) {
    try {
      const errorAnalysis = await errorLogParser.parseVlocityErrors();
      
      const recoveryActions = [];
      
      // Handle "Not Found" errors
      if (errorAnalysis.notFoundErrors?.length > 0) {
        recoveryActions.push({
          type: 'EXCLUDE_MISSING',
          items: errorAnalysis.notFoundErrors.map(e => ({
            type: e.objectType,
            name: e.objectName
          })),
          action: 'Remove missing references from job or deploy dependencies first'
        });
      }
      
      // Handle "No Match Found" errors (missing parent dependencies)
      if (errorAnalysis.missingDependencies?.length > 0) {
        recoveryActions.push({
          type: 'DEPLOY_DEPENDENCIES',
          dependencies: errorAnalysis.missingDependencies,
          action: 'Create recovery job to deploy parent dependencies first'
        });
      }
      
      // Auto-create recovery job
      if (recoveryActions.length > 0) {
        const recoveryJobId = await jobStateService.createRecoveryJob(jobId, recoveryActions);
        
        logger.info('Recovery job created', {
          originalJobId: jobId,
          recoveryJobId,
          actions: recoveryActions.length
        });
        
        return recoveryJobId;
      }
      
      return null;
    } catch (error) {
      logger.error('Recovery from errors failed', { jobId, error: error.message });
      return null;
    }
  }

  /**
   * Run iterative export recovery to catch all missing dependencies
   * @param {string} username - Salesforce username
   * @param {string} mainJobPath - Path to main export job file
   * @param {string} jobId - Job ID for progress updates
   * @param {Object} options - Recovery options
   * @returns {Promise<Object>} Recovery results
   */
  async runIterativeRecovery(username, mainJobPath, jobId, options = {}) {
    const {
      maxIterations = 10,
      projectPath = null
    } = options;

    try {
      logger.info('Starting iterative export recovery', {
        username,
        mainJobPath,
        maxIterations,
        jobId
      });

      const processedIds = new Set();
      const recoveryJobs = [];
      let iteration = 1;
      let totalRecovered = 0;
      let staleIterations = 0;       // iterations where no new IDs were found
      const maxStaleIterations = 3;  // give up after 3 consecutive stale retries

      // Read project path from main job if not provided
      let targetProjectPath = projectPath;
      if (!targetProjectPath) {
        const mainJob = await this.readJobFile(mainJobPath);
        targetProjectPath = mainJob.projectPath || './export';
      }

      jobMonitor.addJobLog(jobId, `🔄 Starting export recovery (max ${maxIterations} iterations)`, 'info');
      jobMonitor.addJobLog(jobId, `📁 Project path: ${targetProjectPath}`, 'info');

      while (iteration <= maxIterations) {
        jobMonitor.addJobLog(jobId, `\n🔍 Recovery Iteration ${iteration}/${maxIterations}`, 'info');
        
        // Run main export
        jobMonitor.addJobLog(jobId, `▶️  Running main export...`, 'info');
        await vlocityService.exportDataPacks(username, mainJobPath, jobId);
        
        // Check for errors — hasErrors() returns an object, not a boolean
        const errCheck = await errorLogParser.hasErrors();
        const buildLogStats = await errorLogParser.parseVlocityBuildLog();
        const buildLogErrors = buildLogStats?.errorCount || 0;
        const buildLogRemaining = buildLogStats?.remainingCount || 0;
        const hasAnyErrors = errCheck?.hasErrors || buildLogErrors > 0 || buildLogRemaining > 0;

        if (!hasAnyErrors) {
          jobMonitor.addJobLog(jobId, `✅ Export completed with no errors`, 'info');
          break;
        }

        if (buildLogErrors > 0 || buildLogRemaining > 0) {
          jobMonitor.addJobLog(jobId, `📊 Build log: ${buildLogErrors} errors, ${buildLogRemaining} remaining items`, 'warn');
        }

        // Parse error log for missing dependency IDs
        jobMonitor.addJobLog(jobId, `📋 Parsing error log...`, 'info');
        const errorAnalysis = await errorLogParser.parseVlocityErrors();

        if (errorAnalysis.missingIds.length === 0) {
          if (buildLogErrors === 0 && buildLogRemaining === 0) {
            jobMonitor.addJobLog(jobId, `✅ No missing IDs or build errors, recovery complete`, 'info');
            break;
          }
          // "Data Not Retrieved" or remaining items — re-run the main export on the next
          // iteration so Vlocity skips already-exported records and retries the failures.
          // But if errors are non-recoverable (e.g. unsupported sObject), stop retrying.
          staleIterations++;
          if (staleIterations >= maxStaleIterations) {
            jobMonitor.addJobLog(jobId, `⚠️  ${buildLogErrors} non-recoverable error(s) persisting after ${staleIterations} retries — stopping recovery`, 'warn');
            break;
          }
          jobMonitor.addJobLog(jobId, `🔄 Retrying ${buildLogErrors + buildLogRemaining} failed/remaining items via re-export (stale attempt ${staleIterations}/${maxStaleIterations})`, 'warn');
          iteration++;
          continue;
        }
        // New IDs found — reset stale counter
        staleIterations = 0;

        // Filter out already processed IDs
        const newIds = errorAnalysis.missingIds.filter(id => !processedIds.has(id));
        
        if (newIds.length === 0) {
          jobMonitor.addJobLog(jobId, `✅ All missing IDs already processed, recovery complete`, 'info');
          break;
        }

        jobMonitor.addJobLog(jobId, `📊 Found ${errorAnalysis.missingIds.length} missing IDs (${newIds.length} new)`, 'warn');

        // Resolve ID prefixes to object names
        jobMonitor.addJobLog(jobId, `🔍 Resolving object types for ${newIds.length} IDs...`, 'info');
        const prefixMap = await salesforceMetadataService.resolveIdPrefixes(newIds, username);
        
        if (prefixMap.size === 0) {
          jobMonitor.addJobLog(jobId, `⚠️  Could not resolve any object types, skipping iteration`, 'warn');
          break;
        }

        // Map IDs to objects
        const objectMap = salesforceMetadataService.mapIdsToObjects(newIds, prefixMap);
        
        jobMonitor.addJobLog(jobId, `📦 Grouped IDs into ${objectMap.size} object types`, 'info');

        // Generate recovery job
        const recoveryJobPath = await this.generateRecoveryJob(
          objectMap,
          targetProjectPath,
          iteration,
          jobId
        );

        recoveryJobs.push(recoveryJobPath);

        // Run recovery export
        jobMonitor.addJobLog(jobId, `▶️  Running recovery export (iteration ${iteration})...`, 'info');
        await vlocityService.exportDataPacks(username, recoveryJobPath, jobId);

        // Mark IDs as processed
        newIds.forEach(id => processedIds.add(id));
        totalRecovered += newIds.length;

        jobMonitor.addJobLog(jobId, `✅ Recovery iteration ${iteration} complete (${newIds.length} IDs processed)`, 'info');
        jobMonitor.updateJobProgress(jobId, Math.min(90, (iteration / maxIterations) * 100));

        iteration++;
      }

      // Final summary
      const finalIterations = iteration - 1;
      jobMonitor.addJobLog(jobId, `\n📊 Recovery Summary:`, 'info');
      jobMonitor.addJobLog(jobId, `   • Iterations: ${finalIterations}`, 'info');
      jobMonitor.addJobLog(jobId, `   • IDs recovered: ${totalRecovered}`, 'info');
      jobMonitor.addJobLog(jobId, `   • Recovery jobs: ${recoveryJobs.length}`, 'info');

      // Generate merged job if multiple recovery iterations
      let mergedJobPath = null;
      if (recoveryJobs.length > 0) {
        mergedJobPath = await this.generateMergedJob(
          mainJobPath,
          recoveryJobs,
          targetProjectPath,
          jobId
        );
        jobMonitor.addJobLog(jobId, `📄 Merged job created: ${path.basename(mergedJobPath)}`, 'info');
      }

      logger.info('Export recovery completed', {
        iterations: finalIterations,
        totalRecovered,
        jobId
      });

      return {
        iterations: finalIterations,
        recoveredIds: totalRecovered,
        processedIds: Array.from(processedIds),
        recoveryJobs,
        mergedJobPath,
        success: true
      };
    } catch (error) {
      logger.logError(error, { operation: 'runIterativeRecovery', username, jobId });
      jobMonitor.addJobLog(jobId, `❌ Recovery failed: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Generate recovery job YAML from object-ID mapping
   * @param {Map} objectMap - Map of objectName -> Array of IDs
   * @param {string} projectPath - Project path for export
   * @param {number} iteration - Current iteration number
   * @param {string} jobId - Job ID for logging
   * @returns {Promise<string>} Path to generated recovery job
   */
  async generateRecoveryJob(objectMap, projectPath, iteration, jobId) {
    try {
      const recoveryJob = {
        projectPath: projectPath,
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: []
      };

      // Generate queries for each object
      for (const [objectName, ids] of objectMap.entries()) {
        // Chunk IDs in groups of 1000 (SOQL IN clause limit)
        const chunkSize = 1000;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const idList = chunk.map(id => `'${id}'`).join(', ');
          
          recoveryJob.queries.push({
            VlocityDataPackType: 'SObject',
            query: `SELECT Id FROM ${objectName} WHERE Id IN (${idList})`
          });
        }
      }

      jobMonitor.addJobLog(jobId, `   • Generated ${recoveryJob.queries.length} recovery queries`, 'info');

      // Write recovery job file
      const recoveryJobPath = path.join(
        this.tempDir,
        `recovery-iteration-${iteration}-${Date.now()}.yaml`
      );

      await fs.writeFile(recoveryJobPath, yaml.stringify(recoveryJob), 'utf8');
      
      logger.info('Recovery job generated', {
        path: recoveryJobPath,
        objectCount: objectMap.size,
        queryCount: recoveryJob.queries.length,
        iteration
      });

      return recoveryJobPath;
    } catch (error) {
      logger.logError(error, { operation: 'generateRecoveryJob', iteration });
      throw error;
    }
  }

  /**
   * Generate merged job combining main and all recovery jobs
   * @param {string} mainJobPath - Path to main job file
   * @param {Array<string>} recoveryJobPaths - Paths to recovery job files
   * @param {string} projectPath - Project path
   * @param {string} jobId - Job ID for logging
   * @returns {Promise<string>} Path to merged job file
   */
  async generateMergedJob(mainJobPath, recoveryJobPaths, projectPath, jobId) {
    try {
      jobMonitor.addJobLog(jobId, `\n📦 Generating merged job...`, 'info');

      // Read main job
      const mainJob = await this.readJobFile(mainJobPath);
      
      // Aggregate all queries
      const allQueries = [...(mainJob.queries || [])];
      const objectQueries = new Map(); // objectName -> Set of IDs

      // Parse main job queries
      this.parseQueries(mainJob.queries || [], objectQueries);

      // Parse recovery job queries
      for (const recoveryPath of recoveryJobPaths) {
        const recoveryJob = await this.readJobFile(recoveryPath);
        this.parseQueries(recoveryJob.queries || [], objectQueries);
      }

      // Generate merged queries with deduplicated IDs
      const mergedQueries = [];
      
      // Add main queries first (non-SObject queries)
      (mainJob.queries || []).forEach(query => {
        if (query.VlocityDataPackType !== 'SObject') {
          mergedQueries.push(query);
        }
      });

      // Add merged SObject queries
      for (const [objectName, ids] of objectQueries.entries()) {
        const uniqueIds = Array.from(ids);
        
        // Chunk in groups of 1000
        const chunkSize = 1000;
        for (let i = 0; i < uniqueIds.length; i += chunkSize) {
          const chunk = uniqueIds.slice(i, i + chunkSize);
          const idList = chunk.map(id => `'${id}'`).join(', ');
          
          mergedQueries.push({
            VlocityDataPackType: 'SObject',
            query: `SELECT Id FROM ${objectName} WHERE Id IN (${idList})`
          });
        }
      }

      // Create merged job
      const mergedJob = {
        ...mainJob,
        projectPath: projectPath,
        queries: mergedQueries
      };

      // Write merged job file
      const mergedJobPath = path.join(
        this.tempDir,
        `merged-export-${Date.now()}.yaml`
      );

      await fs.writeFile(mergedJobPath, yaml.stringify(mergedJob), 'utf8');
      
      jobMonitor.addJobLog(jobId, `   • Total queries: ${mergedQueries.length}`, 'info');
      jobMonitor.addJobLog(jobId, `   • Unique objects: ${objectQueries.size}`, 'info');

      logger.info('Merged job generated', {
        path: mergedJobPath,
        queryCount: mergedQueries.length,
        objectCount: objectQueries.size
      });

      return mergedJobPath;
    } catch (error) {
      logger.logError(error, { operation: 'generateMergedJob' });
      throw error;
    }
  }

  /**
   * Parse queries and extract object-ID mappings
   * @param {Array} queries - Array of query objects
   * @param {Map} objectQueries - Map to populate with object -> IDs
   */
  parseQueries(queries, objectQueries) {
    queries.forEach(query => {
      if (query.VlocityDataPackType === 'SObject' && query.query) {
        // Extract object name and IDs from query
        const match = query.query.match(/SELECT\s+Id\s+FROM\s+(\w+)\s+WHERE\s+Id\s+IN\s+\(([^)]+)\)/i);
        if (match) {
          const objectName = match[1];
          const idsString = match[2];
          
          // Extract IDs
          const ids = idsString.match(/'([A-Za-z0-9]{15,18})'/g);
          if (ids) {
            if (!objectQueries.has(objectName)) {
              objectQueries.set(objectName, new Set());
            }
            ids.forEach(id => {
              const cleanId = id.replace(/'/g, '');
              objectQueries.get(objectName).add(cleanId);
            });
          }
        }
      }
    });
  }

  /**
   * Read and parse job file
   * @param {string} jobPath - Path to job file
   * @returns {Promise<Object>} Parsed job object
   */
  async readJobFile(jobPath) {
    try {
      const content = await fs.readFile(jobPath, 'utf8');
      return yaml.parse(content);
    } catch (error) {
      logger.logError(error, { operation: 'readJobFile', jobPath });
      throw error;
    }
  }

  /**
   * Clean up temporary recovery files
   * @param {Array<string>} filePaths - Paths to files to clean up
   */
  async cleanupRecoveryFiles(filePaths = []) {
    try {
      for (const filePath of filePaths) {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          logger.info('Recovery file cleaned up', { path: filePath });
        }
      }
    } catch (error) {
      logger.logError(error, { operation: 'cleanupRecoveryFiles' });
    }
  }
}

module.exports = new ExportRecoveryService();

