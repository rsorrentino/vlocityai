const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const logger = require('../utils/logger');

/**
 * Service for automatically generating deploy jobs from export folders
 * **NEW FEATURE**: Discovers exported DataPack folders and creates deploy job
 */
class DeployJobGenerator {
  /**
   * Generate deploy job from export directory by scanning for folders
   * @param {string} exportPath - Path to export directory (default: './export')
   * @param {string} environment - Environment suffix (dev/uat/prod) (optional)
   * @returns {Object} Generated deploy job configuration and path
   */
  async generateDeployJobFromExport(exportPath = './export', environment = '') {
    try {
      // Adjust export path based on environment
      const actualExportPath = environment ? `${exportPath}/${environment}` : exportPath;
      const fullExportPath = path.isAbsolute(actualExportPath) 
        ? actualExportPath 
        : path.join(process.cwd(), actualExportPath);

      logger.info('Scanning export directory for DataPack folders', { 
        exportPath: actualExportPath,
        fullPath: fullExportPath,
        environment 
      });

      // Check if export directory exists
      if (!await fs.pathExists(fullExportPath)) {
        throw new Error(`Export directory not found: ${fullExportPath}`);
      }

      // Read all directories under export path
      const items = await fs.readdir(fullExportPath);
      const queries = [];
      
      for (const item of items) {
        const itemPath = path.join(fullExportPath, item);
        const stats = await fs.stat(itemPath);
        
        // Only include directories (DataPack folders)
        if (stats.isDirectory()) {
          queries.push(item);
        }
      }

      if (queries.length === 0) {
        logger.warn('No DataPack folders found in export directory', { exportPath: fullExportPath });
        throw new Error('No DataPack folders found in export directory. Please run export first.');
      }

      // Sort queries alphabetically for consistency
      queries.sort();

      // Generate deploy job configuration
      const deployJob = {
        projectPath: actualExportPath,
        queries: queries,
        autoUpdateSettings: true,
        compileOnBuild: false,
        useAllRelationships: true,
        generatedBy: 'deployJobGenerator',
        generatedAt: new Date().toISOString(),
        environment: environment || undefined
      };

      logger.info('Deploy job generated from export', {
        exportPath: actualExportPath,
        dataPackTypes: queries.length,
        queries: queries.slice(0, 10) // Log first 10
      });

      return {
        success: true,
        deployJob,
        dataPackTypes: queries.length,
        queries,
        exportPath: actualExportPath
      };
    } catch (error) {
      logger.logError(error, { operation: 'generateDeployJobFromExport', exportPath, environment });
      throw error;
    }
  }

  /**
   * Generate and save deploy job file
   * @param {string} exportPath - Path to export directory
   * @param {string} environment - Environment suffix (optional)
   * @param {string} outputPath - Output path for deploy job file (optional)
   * @returns {Object} Generated job file information
   */
  async generateAndSaveDeployJob(exportPath = './export', environment = '', outputPath = null) {
    try {
      // Generate deploy job
      const result = await this.generateDeployJobFromExport(exportPath, environment);
      
      // Determine output file path
      const envSuffix = environment ? `.${environment}` : '';
      const defaultOutputPath = path.join(process.cwd(), `EPC-deploy${envSuffix}.yaml`);
      const actualOutputPath = outputPath || defaultOutputPath;

      // Write deploy job to file
      await fs.writeFile(actualOutputPath, yaml.stringify(result.deployJob), 'utf8');

      logger.info('Deploy job saved to file', {
        outputPath: actualOutputPath,
        dataPackTypes: result.dataPackTypes
      });

      return {
        success: true,
        jobFilePath: actualOutputPath,
        deployJob: result.deployJob,
        dataPackTypes: result.dataPackTypes,
        queries: result.queries
      };
    } catch (error) {
      logger.logError(error, { operation: 'generateAndSaveDeployJob', exportPath, environment });
      throw error;
    }
  }

  /**
   * Merge multiple export directories into a single deploy job
   * Useful when you have multiple recovery exports
   * @param {Array<string>} exportPaths - Array of export directory paths
   * @param {string} environment - Environment suffix (optional)
   * @returns {Object} Merged deploy job configuration
   */
  async mergeExportDirectories(exportPaths, environment = '') {
    try {
      const allQueries = new Set();
      let projectPath = '';

      for (const exportPath of exportPaths) {
        const result = await this.generateDeployJobFromExport(exportPath, environment);
        
        // Use the first export path as project path
        if (!projectPath) {
          projectPath = result.exportPath;
        }

        // Merge queries (deduplicate)
        result.queries.forEach(query => allQueries.add(query));
      }

      const mergedQueries = Array.from(allQueries).sort();

      const mergedJob = {
        projectPath,
        queries: mergedQueries,
        autoUpdateSettings: true,
        compileOnBuild: false,
        useAllRelationships: true,
        generatedBy: 'deployJobGenerator',
        generatedAt: new Date().toISOString(),
        mergedFrom: exportPaths,
        environment: environment || undefined
      };

      logger.info('Export directories merged', {
        exportPaths,
        totalDataPackTypes: mergedQueries.length
      });

      return {
        success: true,
        deployJob: mergedJob,
        dataPackTypes: mergedQueries.length,
        queries: mergedQueries,
        mergedFrom: exportPaths
      };
    } catch (error) {
      logger.logError(error, { operation: 'mergeExportDirectories', exportPaths, environment });
      throw error;
    }
  }

  /**
   * Update existing deploy job with newly discovered folders
   * @param {string} existingJobPath - Path to existing deploy job
   * @param {string} exportPath - Path to export directory to scan
   * @returns {Object} Updated deploy job
   */
  async updateDeployJobFromExport(existingJobPath, exportPath = './export') {
    try {
      // Read existing job
      const existingContent = await fs.readFile(existingJobPath, 'utf8');
      const existingJob = yaml.parse(existingContent);

      // Generate new queries from export
      const result = await this.generateDeployJobFromExport(exportPath);

      // Merge queries - keep existing + add new (deduplicate)
      const existingQueries = Array.isArray(existingJob.queries) ? existingJob.queries : [];
      const allQueries = new Set([...existingQueries, ...result.queries]);
      const mergedQueries = Array.from(allQueries).sort();

      // Update job
      const updatedJob = {
        ...existingJob,
        queries: mergedQueries,
        updatedBy: 'deployJobGenerator',
        updatedAt: new Date().toISOString()
      };

      // Save updated job
      await fs.writeFile(existingJobPath, yaml.stringify(updatedJob), 'utf8');

      logger.info('Deploy job updated with new queries', {
        jobPath: existingJobPath,
        previousQueries: existingQueries.length,
        newQueries: result.queries.length,
        totalQueries: mergedQueries.length
      });

      return {
        success: true,
        deployJob: updatedJob,
        previousQueriesCount: existingQueries.length,
        newQueriesCount: result.queries.length,
        totalQueriesCount: mergedQueries.length,
        addedQueries: result.queries.filter(q => !existingQueries.includes(q))
      };
    } catch (error) {
      logger.logError(error, { operation: 'updateDeployJobFromExport', existingJobPath, exportPath });
      throw error;
    }
  }

  /**
   * Get statistics about export directory
   * @param {string} exportPath - Path to export directory
   * @param {string} environment - Environment suffix (optional)
   * @returns {Object} Export directory statistics
   */
  async getExportStatistics(exportPath = './export', environment = '') {
    try {
      const actualExportPath = environment ? `${exportPath}/${environment}` : exportPath;
      const fullExportPath = path.isAbsolute(actualExportPath) 
        ? actualExportPath 
        : path.join(process.cwd(), actualExportPath);

      if (!await fs.pathExists(fullExportPath)) {
        return {
          exists: false,
          path: actualExportPath,
          dataPackTypes: 0,
          totalFiles: 0,
          totalSize: 0
        };
      }

      const items = await fs.readdir(fullExportPath);
      const dataPackFolders = [];
      let totalFiles = 0;
      let totalSize = 0;

      for (const item of items) {
        const itemPath = path.join(fullExportPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          dataPackFolders.push(item);
          
          // Count files in this DataPack folder
          const files = await fs.readdir(itemPath);
          totalFiles += files.length;
          
          // Calculate folder size
          for (const file of files) {
            const filePath = path.join(itemPath, file);
            const fileStats = await fs.stat(filePath);
            if (fileStats.isFile()) {
              totalSize += fileStats.size;
            }
          }
        }
      }

      return {
        exists: true,
        path: actualExportPath,
        dataPackTypes: dataPackFolders.length,
        dataPackFolders: dataPackFolders.sort(),
        totalFiles,
        totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        environment: environment || 'default'
      };
    } catch (error) {
      logger.logError(error, { operation: 'getExportStatistics', exportPath, environment });
      throw error;
    }
  }
}

module.exports = new DeployJobGenerator();

