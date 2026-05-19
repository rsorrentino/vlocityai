const { spawn } = require('child_process');
const { OrgAnalysis } = require('../models');
const cacheService = require('./cacheService');
const logger = require('../utils/logger');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

class OrgAnalysisService {
  constructor() {
    this.analysisCache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
  }

  async analyzeOrg(username) {
    try {
      // Check cache first
      const cacheKey = `org-analysis-${username}`;
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        logger.logOperation('Org analysis served from cache', { username });
        return cached;
      }

      logger.logOperation('Starting org analysis', { username });

      // Get org info
      const orgInfo = await this.getOrgInfo(username);
      
      // Get metadata
      const metadata = await this.getOrgMetadata(username);
      
      // Get data pack info
      const dataPackInfo = await this.getDataPackInfo(username);
      
      // Get Vlocity components
      const vlocityComponents = await this.getVlocityComponents(username);
      
      // Get org limits
      const orgLimits = await this.getOrgLimits(username);

      const analysis = {
        username,
        orgInfo,
        metadata,
        dataPackInfo,
        vlocityComponents,
        orgLimits,
        analyzedAt: new Date().toISOString(),
        status: 'completed'
      };

      // Cache the result
      await cacheService.set(cacheKey, analysis, 300); // 5 minutes

      // Update org record
      await this.updateOrgRecord(username, analysis);

      logger.logOperation('Org analysis completed', { username });

      return analysis;
    } catch (error) {
      logger.logError(error, { operation: 'Org analysis', username });
      
      const errorAnalysis = {
        username,
        error: error.message,
        analyzedAt: new Date().toISOString(),
        status: 'failed'
      };

      return errorAnalysis;
    }
  }

  async getOrgInfo(username) {
    try {
      const result = await this.executeSfdxCommand([
        'org:display',
        '--target-org', username,
        '--json'
      ]);

      const data = JSON.parse(result);
      
      if (data.status === 0) {
        return {
          orgId: data.result.id,
          orgName: data.result.name,
          instanceUrl: data.result.instanceUrl,
          username: data.result.username,
          accessToken: data.result.accessToken ? '***' : null,
          connectedStatus: data.result.connectedStatus,
          isDefaultUsername: data.result.isDefaultUsername,
          alias: data.result.alias
        };
      } else {
        throw new Error(data.message || 'Failed to get org info');
      }
    } catch (error) {
      logger.logError(error, { operation: 'Get org info', username });
      throw error;
    }
  }

  async getOrgMetadata(username) {
    try {
      const result = await this.executeSfdxCommand([
        'org:list',
        '--json'
      ]);

      const data = JSON.parse(result);
      
      if (data.status === 0) {
        const org = data.result.nonScratchOrgs.find(o => o.username === username);
        return org ? {
          isDevHub: org.isDevHub,
          isDefaultDevHub: org.isDefaultDevHub,
          isDefaultUsername: org.isDefaultUsername,
          connectedStatus: org.connectedStatus,
          lastUsed: org.lastUsed
        } : null;
      } else {
        throw new Error(data.message || 'Failed to get org metadata');
      }
    } catch (error) {
      logger.logError(error, { operation: 'Get org metadata', username });
      return null;
    }
  }

  async getDataPackInfo(username) {
    try {
      const result = await this.executeVlocityCommand([
        'datapack:query',
        '--sfdx.username', username,
        '--query', 'SELECT Id, Name, Type FROM DataPack__c LIMIT 10'
      ]);

      return {
        totalDataPacks: result.split('\n').length - 1,
        sampleDataPacks: result.split('\n').slice(0, 5).map(line => {
          const parts = line.split(',');
          return {
            id: parts[0],
            name: parts[1],
            type: parts[2]
          };
        })
      };
    } catch (error) {
      logger.logError(error, { operation: 'Get data pack info', username });
      return {
        totalDataPacks: 0,
        sampleDataPacks: [],
        error: error.message
      };
    }
  }

  async getVlocityComponents(username) {
    try {
      const result = await this.executeVlocityCommand([
        'datapack:query',
        '--sfdx.username', username,
        '--query', 'SELECT COUNT() FROM VlocityDataPack__c'
      ]);

      return {
        totalComponents: parseInt(result.trim()) || 0,
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      logger.logError(error, { operation: 'Get Vlocity components', username });
      return {
        totalComponents: 0,
        error: error.message
      };
    }
  }

  async getOrgLimits(username) {
    try {
      const result = await this.executeSfdxCommand([
        'org:limits:api:display',
        '--target-org', username,
        '--json'
      ]);

      const data = JSON.parse(result);
      
      if (data.status === 0) {
        return {
          dailyApiRequests: data.result.dailyApiRequests,
          dataStorage: data.result.dataStorage,
          fileStorage: data.result.fileStorage
        };
      } else {
        throw new Error(data.message || 'Failed to get org limits');
      }
    } catch (error) {
      logger.logError(error, { operation: 'Get org limits', username });
      return {
        error: error.message
      };
    }
  }

  async updateOrgRecord(username, analysis) {
    try {
      await OrgAnalysis.upsert({
        username,
        lastConnected: new Date(),
        connectionStatus: 'connected',
        metadata: analysis
      });
    } catch (error) {
      logger.logError(error, { operation: 'Update org record', username });
    }
  }

  async executeSfdxCommand(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('sfdx', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000
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
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `SFDX command failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async executeVlocityCommand(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('vlocity', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000
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
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Vlocity command failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async getAnalysisHistory(username, limit = 10) {
    try {
      const cacheKey = `org-analysis-history-${username}`;
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      // This would typically come from a database
      // For now, return mock data
      const history = [
        {
          id: '1',
          username,
          analyzedAt: new Date(Date.now() - 86400000).toISOString(),
          status: 'completed',
          summary: 'Org analysis completed successfully'
        },
        {
          id: '2',
          username,
          analyzedAt: new Date(Date.now() - 172800000).toISOString(),
          status: 'completed',
          summary: 'Org analysis completed successfully'
        }
      ];

      await cacheService.set(cacheKey, history, 600); // 10 minutes
      return history;
    } catch (error) {
      logger.logError(error, { operation: 'Get analysis history', username });
      return [];
    }
  }
}

module.exports = new OrgAnalysisService();
