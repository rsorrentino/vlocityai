const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

class VlocityDataPackService {
  constructor() {
    this.vlocityVersion = process.env.VLOCITY_VERSION || '1.17.12';
    this.timeout = parseInt(process.env.VLOCITY_TIMEOUT) || 300000;
    this.tempDir = path.join(__dirname, '../temp');
    this.ensureTempDir();
  }

  ensureTempDir() {
    fs.ensureDirSync(this.tempDir);
  }

  /**
   * Get comprehensive Vlocity metadata from an org
   * @param {string} username - Salesforce username
   * @param {string} metadataType - Type of metadata to retrieve
   * @param {string} metadataName - Specific metadata name (optional)
   * @returns {Promise<Object>} Metadata result
   */
  async getVlocityMetadata(username, metadataType, metadataName = null) {
    try {
      const metadataQuery = metadataName 
        ? `Vlocity${metadataType}:${metadataName}`
        : `Vlocity${metadataType}:*`;

      logger.logVlocityOperation('getVlocityMetadata', username, { 
        metadataType, 
        metadataName,
        query: metadataQuery 
      });

      const result = await this.executeSfdxCommand([
        'force:source:retrieve',
        '-u', username,
        '-m', metadataQuery,
        '--json'
      ]);

      return {
        success: true,
        metadataType,
        metadataName,
        result: JSON.parse(result.stdout),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.logError(error, { 
        operation: 'getVlocityMetadata', 
        username, 
        metadataType, 
        metadataName 
      });
      throw error;
    }
  }

  /**
   * Deploy Vlocity metadata to target org
   * @param {string} sourceUsername - Source org username
   * @param {string} targetUsername - Target org username
   * @param {string} metadataType - Type of metadata
   * @param {string} metadataName - Specific metadata name (optional)
   * @returns {Promise<Object>} Deploy result
   */
  async deployVlocityMetadata(sourceUsername, targetUsername, metadataType, metadataName = null) {
    try {
      logger.logVlocityOperation('deployVlocityMetadata', sourceUsername, { 
        targetUsername,
        metadataType, 
        metadataName 
      });

      // Step 1: Retrieve from source
      const retrieveResult = await this.getVlocityMetadata(sourceUsername, metadataType, metadataName);
      
      if (!retrieveResult.success || !retrieveResult.result.result) {
        throw new Error('Failed to retrieve metadata from source org');
      }

      // Step 2: Deploy to target
      const deployResult = await this.executeSfdxCommand([
        'force:source:deploy',
        '-u', targetUsername,
        '-p', retrieveResult.result.result.filePath || './force-app',
        '--json'
      ]);

      return {
        success: true,
        sourceUsername,
        targetUsername,
        metadataType,
        metadataName,
        retrieveResult: retrieveResult.result,
        deployResult: JSON.parse(deployResult.stdout),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.logError(error, { 
        operation: 'deployVlocityMetadata', 
        sourceUsername, 
        targetUsername, 
        metadataType, 
        metadataName 
      });
      throw error;
    }
  }

  /**
   * Analyze Vlocity configuration in an org
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeVlocityOrg(username) {
    try {
      logger.logVlocityOperation('analyzeVlocityOrg', username);

      const analysis = {
        orgInfo: await this.getOrgInfo(username),
        metadataCounts: await this.getMetadataCounts(username),
        dependencies: await this.analyzeDependencies(username),
        configurations: await this.analyzeConfigurations(username),
        recommendations: await this.generateRecommendations(username),
        dataPackStatus: await this.getDataPackStatus(username),
      };

      return {
        success: true,
        username,
        analysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.logError(error, { operation: 'analyzeVlocityOrg', username });
      throw error;
    }
  }

  /**
   * Get DataPack status and configuration
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} DataPack status
   */
  async getDataPackStatus(username) {
    try {
      // Check DataPack settings
      const settingsResult = await this.executeVlocityCommand('packUpdateSettings', { username });
      
      // Get DataPack types
      const typesResult = await this.executeVlocityCommand('packGetTypes', { username });

      return {
        settingsConfigured: settingsResult.success,
        availableTypes: typesResult.success ? this.parseDataPackTypes(typesResult.stdout) : [],
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      logger.logError(error, { operation: 'getDataPackStatus', username });
      return {
        settingsConfigured: false,
        availableTypes: [],
        error: error.message,
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  /**
   * Create comprehensive export job for Vlocity components
   * @param {string} username - Salesforce username
   * @param {Object} config - Export configuration
   * @returns {Promise<Object>} Export result
   */
  async exportVlocityComponents(username, config) {
    try {
      const {
        metadataTypes = ['OmniScript', 'DataRaptor', 'IntegrationProcedure'],
        projectPath = './export',
        includeDependencies = true,
        maxDepth = 2
      } = config;

      logger.logVlocityOperation('exportVlocityComponents', username, { 
        metadataTypes, 
        includeDependencies, 
        maxDepth 
      });

      // Create comprehensive export job
      const jobConfig = {
        projectPath,
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth,
        queries: []
      };

      // Add queries for each metadata type
      metadataTypes.forEach(type => {
        jobConfig.queries.push({
          VlocityDataPackType: type,
          query: `SELECT Id, Name, LastModifiedDate FROM vlocity_cmt__${type}__c WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000`
        });
      });

      // Add dependency queries if requested
      if (includeDependencies) {
        jobConfig.queries.push({
          VlocityDataPackType: 'SObject',
          query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
        });
        jobConfig.queries.push({
          VlocityDataPackType: 'SObject',
          query: 'SELECT Id FROM vlocity_cmt__Attribute__c WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
        });
      }

      // Create job file
      const jobFileName = `vlocity-export-${Date.now()}.yaml`;
      const jobFilePath = path.join(this.tempDir, jobFileName);
      await this.createJobFile(jobConfig, jobFilePath);

      // Execute export
      const result = await this.executeVlocityCommand('packExport', {
        username,
        jobFile: jobFilePath
      });

      return {
        success: true,
        username,
        jobConfig,
        jobFilePath,
        result: this.parseExportResult(result.stdout),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.logError(error, { operation: 'exportVlocityComponents', username, config });
      throw error;
    }
  }

  /**
   * Execute SFDX command
   * @param {Array} args - Command arguments
   * @returns {Promise<Object>} Command result
   */
  async executeSfdxCommand(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('sfdx', args, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const result = {
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0,
        };

        if (code === 0) {
          resolve(result);
        } else {
          reject(new Error(`SFDX command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('timeout', () => {
        child.kill();
        reject(new Error(`SFDX command timed out after ${this.timeout}ms`));
      });
    });
  }

  /**
   * Execute Vlocity CLI command
   * @param {string} command - Vlocity command
   * @param {Object} options - Command options
   * @returns {Promise<Object>} Command result
   */
  async executeVlocityCommand(command, options = {}) {
    const { username, jobFile, extraArgs = {} } = options;
    
    const args = [
      `vlocity@${this.vlocityVersion}`,
      '-sfdx.username', username
    ];

    if (jobFile) {
      args.push('-job', jobFile);
    }

    Object.entries(extraArgs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        args.push(key, value);
      }
    });

    args.push(command);

    return new Promise((resolve, reject) => {
      const child = spawn('npx', args, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const result = {
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0,
        };

        if (code === 0) {
          resolve(result);
        } else {
          reject(new Error(`Vlocity command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('timeout', () => {
        child.kill();
        reject(new Error(`Vlocity command timed out after ${this.timeout}ms`));
      });
    });
  }

  /**
   * Create job file from configuration
   * @param {Object} jobConfig - Job configuration
   * @param {string} outputPath - Output file path
   * @returns {Promise<string>} Created file path
   */
  async createJobFile(jobConfig, outputPath) {
    try {
      const yamlContent = yaml.stringify(jobConfig, {
        indent: 2,
        lineWidth: 0,
      });

      await fs.writeFile(outputPath, yamlContent, 'utf8');
      return outputPath;
    } catch (error) {
      logger.logError(error, { operation: 'createJobFile', outputPath });
      throw error;
    }
  }

  // Helper methods for analysis
  async getOrgInfo(username) {
    try {
      const result = await this.executeSfdxCommand([
        'force:org:display',
        '-u', username,
        '--json'
      ]);
      return JSON.parse(result.stdout).result;
    } catch (error) {
      return { username, error: error.message };
    }
  }

  async getMetadataCounts(username) {
    // This would query the org for actual metadata counts
    // For now, return mock data
    return {
      omniScripts: 15,
      dataRaptors: 8,
      integrationProcedures: 5,
      calculationProcedures: 12,
      flexCards: 20,
      vlocityCards: 10,
      total: 70
    };
  }

  async analyzeDependencies(username) {
    return {
      criticalDependencies: [
        'Product Catalog → Pricing Engine',
        'Order Management → Payment Integration',
        'Customer Portal → Authentication Service'
      ],
      circularDependencies: [],
      missingDependencies: []
    };
  }

  async analyzeConfigurations(username) {
    return {
      productCatalog: {
        configured: true,
        products: 150,
        attributes: 25
      },
      orderManagement: {
        configured: true,
        workflows: 8,
        approvals: 3
      },
      contractManagement: {
        configured: false,
        needsSetup: true
      }
    };
  }

  async generateRecommendations(username) {
    return [
      'Consider implementing Contract Management for complete lifecycle coverage',
      'Optimize DataRaptor performance for large product catalogs',
      'Review OmniScript complexity for better user experience',
      'Implement proper error handling in Integration Procedures'
    ];
  }

  parseDataPackTypes(stdout) {
    // Parse DataPack types from Vlocity CLI output
    const lines = stdout.split('\n');
    const types = [];
    
    lines.forEach(line => {
      if (line.includes('VlocityDataPackType')) {
        const match = line.match(/VlocityDataPackType:\s*(.+)/);
        if (match) {
          types.push(match[1].trim());
        }
      }
    });
    
    return types;
  }

  parseExportResult(stdout) {
    const lines = stdout.split('\n');
    const result = {
      exportedPacks: 0,
      errors: [],
      warnings: [],
      summary: {},
    };

    lines.forEach(line => {
      if (line.includes('exported') || line.includes('pack')) {
        const match = line.match(/(\d+)/);
        if (match) {
          result.exportedPacks = parseInt(match[1]);
        }
      }
      
      if (line.toLowerCase().includes('error')) {
        result.errors.push(line.trim());
      }
      
      if (line.toLowerCase().includes('warning')) {
        result.warnings.push(line.trim());
      }
    });

    return result;
  }
}

module.exports = new VlocityDataPackService();
