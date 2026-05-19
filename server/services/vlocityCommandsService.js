/**
 * Comprehensive Vlocity Commands Service
 * Implements all Vlocity Build commands from vlocity_build-master
 */

const logger = require('../utils/logger');
const vlocityService = require('./vlocityService');
const path = require('path');
const fs = require('fs-extra');

class VlocityCommandsService {
  constructor() {
    this.vlocityService = vlocityService;
  }

  /**
   * Execute any Vlocity command with proper error handling
   */
  async executeVlocityCommand(command, options = {}) {
    const { username, jobFile, jobId, extraArgs = {}, version = null } = options;
    
    try {
      return await this.vlocityService.executeCommand(command, {
        username,
        jobFile,
        jobId,
        extraArgs,
        version,
      });
    } catch (error) {
      logger.logError(error, { operation: command, username, jobFile });
      throw error;
    }
  }

  // ============================================
  // PRIMARY COMMANDS
  // ============================================

  /**
   * packExport - Export from a Salesforce org into a DataPack Directory
   * Already implemented in vlocityService.exportDataPacks()
   */
  async packExport(username, jobFile, jobId = null, version = null) {
    return this.vlocityService.exportDataPacks(username, jobFile, jobId);
  }

  /**
   * packExportSingle - Export a Single DataPack by Id
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} type - VlocityDataPackType
   * @param {string} id - Salesforce Id
   * @param {number} depth - Max depth for dependencies (0 = no dependencies)
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packExportSingle(username, jobFile, type, id, depth = null, jobId = null) {
    const extraArgs = {
      '-type': type,
      '-id': id,
    };

    if (depth !== null && depth !== undefined) {
      extraArgs['-depth'] = depth.toString();
    }

    return this.executeVlocityCommand('packExportSingle', {
      username,
      jobFile,
      jobId,
      extraArgs,
    });
  }

  /**
   * packExportAllDefault - Export All Default DataPacks
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packExportAllDefault(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('packExportAllDefault', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * packDeploy - Deploy all contents of a DataPacks Directory
   * Already implemented in vlocityService.deployDataPacks()
   */
  async packDeploy(username, jobFile, jobId = null, version = null) {
    return this.vlocityService.deployDataPacks(username, jobFile, jobId, version);
  }

  // ============================================
  // TROUBLESHOOTING COMMANDS
  // ============================================

  /**
   * packContinue - Continues a job that failed due to an error
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packContinue(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('packContinue', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * packRetry - Continues a Job retrying all deploy errors or re-running all export queries
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packRetry(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('packRetry', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * validateLocalData - Check for Missing Global Keys in Data
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {boolean} fixLocalGlobalKeys - Fix missing/duplicate Global Keys
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async validateLocalData(username, jobFile, fixLocalGlobalKeys = false, jobId = null) {
    const extraArgs = {};
    if (fixLocalGlobalKeys) {
      extraArgs['--fixLocalGlobalKeys'] = '';
    }

    return this.executeVlocityCommand('validateLocalData', {
      username,
      jobFile,
      jobId,
      extraArgs,
    });
  }

  /**
   * cleanOrgData - Run Scripts to Clean Data in the Org and Add Global Keys
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async cleanOrgData(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('cleanOrgData', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * refreshProject - Refresh the Project's Data to the latest format
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async refreshProject(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('refreshProject', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * checkStaleObjects - Ensure all references exist in org or locally
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async checkStaleObjects(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('checkStaleObjects', {
      username,
      jobFile,
      jobId,
    });
  }

  // ============================================
  // ADDITIONAL COMMANDS
  // ============================================

  /**
   * packGetDiffs - Find all Diffs in Org Compared to Local Files
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packGetDiffs(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('packGetDiffs', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * packGetDiffsAndDeploy - Deploy only files that are modified compared to target Org
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packGetDiffsAndDeploy(username, jobFile, jobId = null) {
    return this.executeVlocityCommand('packGetDiffsAndDeploy', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * packBuildFile - Build a DataPacks Directory into a DataPack file
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} outputFile - Output file path (optional)
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packBuildFile(username, jobFile, outputFile = null, jobId = null) {
    const extraArgs = {};
    if (outputFile) {
      extraArgs['-outputFile'] = outputFile;
    }

    return this.executeVlocityCommand('packBuildFile', {
      username,
      jobFile,
      jobId,
      extraArgs,
    });
  }

  /**
   * runJavaScript - Rebuild all DataPacks running JavaScript on each or run a Node.js Script
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} jsFile - JavaScript file path
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async runJavaScript(username, jobFile, jsFile, jobId = null) {
    const extraArgs = {
      '-js': jsFile,
    };

    return this.executeVlocityCommand('runJavaScript', {
      username,
      jobFile,
      jobId,
      extraArgs,
    });
  }

  /**
   * runApex - Runs Anonymous Apex specified in the option -apex
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path
   * @param {string} apexFile - Apex file path or Apex code
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async runApex(username, jobFile, apexFile, jobId = null) {
    const extraArgs = {
      '-apex': apexFile,
    };

    return this.executeVlocityCommand('runApex', {
      username,
      jobFile,
      jobId,
      extraArgs,
    });
  }

  /**
   * packGetAllAvailableExports - Get list of all DataPacks that can be exported
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path (optional, can use --nojob)
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async packGetAllAvailableExports(username, jobFile = null, jobId = null) {
    const extraArgs = {};
    if (!jobFile) {
      extraArgs['--nojob'] = '';
    }

    return this.executeVlocityCommand('packGetAllAvailableExports', {
      username,
      jobFile,
      jobId,
      extraArgs,
    });
  }

  /**
   * refreshVlocityBase - Deploy and Activate the Base Vlocity DataPacks
   * @param {string} username - Salesforce username
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async refreshVlocityBase(username, jobId = null) {
    return this.executeVlocityCommand('refreshVlocityBase', {
      username,
      jobId,
    });
  }

  /**
   * installVlocityInitial - Deploy and Activate Base and Configuration DataPacks
   * @param {string} username - Salesforce username
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async installVlocityInitial(username, jobId = null) {
    return this.executeVlocityCommand('installVlocityInitial', {
      username,
      jobId,
    });
  }

  /**
   * installDPsfromStaticResource - Install DataPacks from Static Resource
   * @param {string} username - Salesforce username
   * @param {string} jobFile - Job file path (must contain StaticResourceQuery)
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   */
  async installDPsfromStaticResource(username, jobFile, jobId = null) {
    // Verify job file contains StaticResourceQuery
    try {
      const jobConfig = await this.vlocityService.readJobFile(jobFile);
      if (!jobConfig.StaticResourceQuery) {
        throw new Error('Job file must contain StaticResourceQuery field');
      }
    } catch (error) {
      logger.logError(error, { operation: 'installDPsfromStaticResource', username, jobFile });
      throw error;
    }

    return this.executeVlocityCommand('installDPsfromStaticResource', {
      username,
      jobFile,
      jobId,
    });
  }

  /**
   * packUpdateSettings - Refreshes the DataPacks Settings
   * Already implemented in vlocityService.updateSettings()
   */
  async packUpdateSettings(username, jobId = null) {
    return this.vlocityService.updateSettings(username);
  }

  /**
   * packValidate - Validate DataPacks (pre-deploy validation)
   * Already implemented in vlocityService.validateDataPacks()
   */
  async packValidate(username, jobFile, jobId = null) {
    return this.vlocityService.validateDataPacks(username, jobFile, jobId);
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Get list of all available commands
   */
  getAvailableCommands() {
    return {
      primary: [
        'packExport',
        'packExportSingle',
        'packExportAllDefault',
        'packDeploy',
      ],
      troubleshooting: [
        'packContinue',
        'packRetry',
        'validateLocalData',
        'cleanOrgData',
        'refreshProject',
        'checkStaleObjects',
      ],
      additional: [
        'packGetDiffs',
        'packGetDiffsAndDeploy',
        'packBuildFile',
        'runJavaScript',
        'runApex',
        'packGetAllAvailableExports',
        'refreshVlocityBase',
        'installVlocityInitial',
        'installDPsfromStaticResource',
        'packUpdateSettings',
        'packValidate',
      ],
    };
  }

  /**
   * Check if a command is available
   */
  async checkCommandAvailability(username, command) {
    try {
      // Try to execute help command to see if command exists
      const result = await this.vlocityService.executeCommand('help', {
        username,
        extraArgs: {},
      });
      
      // Check if command is in help output
      return result.stdout.includes(command);
    } catch (error) {
      // If help fails, assume command might be available
      return true;
    }
  }

  /**
   * Get command documentation
   */
  getCommandDocumentation(command) {
    const docs = {
      packExport: {
        description: 'Export from a Salesforce org into a DataPack Directory',
        usage: 'packExport(username, jobFile, jobId)',
        parameters: {
          username: 'Salesforce username',
          jobFile: 'Path to job file',
          jobId: 'Job ID for WebSocket streaming (optional)',
        },
      },
      packExportSingle: {
        description: 'Export a Single DataPack by Id with optional dependencies',
        usage: 'packExportSingle(username, jobFile, type, id, depth, jobId)',
        parameters: {
          username: 'Salesforce username',
          jobFile: 'Path to job file',
          type: 'VlocityDataPackType',
          id: 'Salesforce Id',
          depth: 'Max depth for dependencies (0 = no dependencies, optional)',
          jobId: 'Job ID for WebSocket streaming (optional)',
        },
      },
      packExportAllDefault: {
        description: 'Export All Default DataPacks as listed in Supported Types Table',
        usage: 'packExportAllDefault(username, jobFile, jobId)',
        parameters: {
          username: 'Salesforce username',
          jobFile: 'Path to job file',
          jobId: 'Job ID for WebSocket streaming (optional)',
        },
      },
      packDeploy: {
        description: 'Deploy all contents of a DataPacks Directory',
        usage: 'packDeploy(username, jobFile, jobId, version)',
        parameters: {
          username: 'Salesforce username',
          jobFile: 'Path to job file',
          jobId: 'Job ID for WebSocket streaming (optional)',
          version: 'Vlocity version (optional)',
        },
      },
      packContinue: {
        description: 'Continues a job that failed due to an error',
        usage: 'packContinue(username, jobFile, jobId)',
      },
      packRetry: {
        description: 'Continues a Job retrying all deploy errors or re-running all export queries',
        usage: 'packRetry(username, jobFile, jobId)',
      },
      validateLocalData: {
        description: 'Check for Missing Global Keys in Data. Can fix with --fixLocalGlobalKeys',
        usage: 'validateLocalData(username, jobFile, fixLocalGlobalKeys, jobId)',
        parameters: {
          fixLocalGlobalKeys: 'Boolean - Fix missing/duplicate Global Keys (default: false)',
        },
      },
      cleanOrgData: {
        description: 'Run Scripts to Clean Data in the Org and Add Global Keys to SObjects missing them',
        usage: 'cleanOrgData(username, jobFile, jobId)',
      },
      refreshProject: {
        description: 'Refresh the Project\'s Data to the latest format for this tool',
        usage: 'refreshProject(username, jobFile, jobId)',
      },
      checkStaleObjects: {
        description: 'Ensure that all references in your project exist in either the org or locally',
        usage: 'checkStaleObjects(username, jobFile, jobId)',
      },
      packGetDiffs: {
        description: 'Find all Diffs in Org Compared to Local Files',
        usage: 'packGetDiffs(username, jobFile, jobId)',
      },
      packGetDiffsAndDeploy: {
        description: 'Deploy only files that are modified compared to the target Org',
        usage: 'packGetDiffsAndDeploy(username, jobFile, jobId)',
      },
      packBuildFile: {
        description: 'Build a DataPacks Directory into a DataPack file',
        usage: 'packBuildFile(username, jobFile, outputFile, jobId)',
        parameters: {
          outputFile: 'Output file path (optional)',
        },
      },
      runJavaScript: {
        description: 'Rebuild all DataPacks running JavaScript on each or run a Node.js Script',
        usage: 'runJavaScript(username, jobFile, jsFile, jobId)',
        parameters: {
          jsFile: 'JavaScript file path',
        },
      },
      runApex: {
        description: 'Runs Anonymous Apex specified in the option -apex',
        usage: 'runApex(username, jobFile, apexFile, jobId)',
        parameters: {
          apexFile: 'Apex file path or Apex code',
        },
      },
      packGetAllAvailableExports: {
        description: 'Get list of all DataPacks that can be exported',
        usage: 'packGetAllAvailableExports(username, jobFile, jobId)',
        parameters: {
          jobFile: 'Job file path (optional, can use --nojob)',
        },
      },
      refreshVlocityBase: {
        description: 'Deploy and Activate the Base Vlocity DataPacks included in the Managed Package',
        usage: 'refreshVlocityBase(username, jobId)',
      },
      installVlocityInitial: {
        description: 'Deploy and Activate the Base Vlocity DataPacks and Configuration DataPacks',
        usage: 'installVlocityInitial(username, jobId)',
      },
      installDPsfromStaticResource: {
        description: 'Install DataPacks from Static Resource based on a Query',
        usage: 'installDPsfromStaticResource(username, jobFile, jobId)',
        note: 'Job file must contain StaticResourceQuery field',
      },
      packUpdateSettings: {
        description: 'Refreshes the DataPacks Settings to the version included in this project',
        usage: 'packUpdateSettings(username, jobId)',
      },
      packValidate: {
        description: 'Validate DataPacks before deployment',
        usage: 'packValidate(username, jobFile, jobId)',
      },
    };

    return docs[command] || null;
  }
}

// Singleton instance
let instance = null;

module.exports = function getVlocityCommandsService() {
  if (!instance) {
    instance = new VlocityCommandsService();
  }
  return instance;
};

module.exports.VlocityCommandsService = VlocityCommandsService;

