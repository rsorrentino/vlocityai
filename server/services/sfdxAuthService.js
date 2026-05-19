const { spawn } = require('child_process');
const logger = require('../utils/logger');

/**
 * SFDX/SF CLI Authentication Service
 * Uses SF CLI stored credentials instead of Connected App
 * This is much better as it leverages existing CLI authentication
 */
class SfdxAuthService {
  constructor() {
    this.cliCommand = 'sf'; // or 'sfdx' for older CLI
  }

  /**
   * Strip ANSI color codes from string
   * @param {string} str - String potentially containing ANSI codes
   * @returns {string} Clean string
   */
  stripAnsi(str) {
    // Remove ANSI escape codes (color codes, cursor movements, etc.)
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
              .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
              .replace(/\x1b\[[0-9;]*m/g, '')
              .replace(/\u001b\[[0-9;]*m/g, '');
  }

  /**
   * Get access token from SF CLI for a specific org
   * @param {string} usernameOrAlias - Salesforce username or alias
   * @returns {Promise<Object>} { accessToken, instanceUrl, orgId }
   */
  async getAccessToken(usernameOrAlias) {
    const stripAnsi = this.stripAnsi.bind(this); // Bind stripAnsi for use in callbacks
    
    return new Promise((resolve, reject) => {
      const args = ['org', 'display', '--target-org', usernameOrAlias, '--json'];
      
      logger.info('Getting access token from SF CLI', { org: usernameOrAlias });
      
      const child = spawn(this.cliCommand, args, {
        shell: true,
        windowsHide: true,
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
        if (code !== 0) {
          logger.logError(new Error(`SF CLI error: ${stderr}`), { 
            operation: 'getAccessToken', 
            org: usernameOrAlias 
          });
          
          // Check if org is not authenticated
          if (stderr.includes('No authorization information found') || 
              stderr.includes('not found')) {
            reject(new Error(
              `Org '${usernameOrAlias}' is not authenticated. ` +
              `Please run: sf org login web --alias ${usernameOrAlias}`
            ));
          } else {
            reject(new Error(`Failed to get access token: ${stderr}`));
          }
          return;
        }

        try {
          // Strip ANSI color codes before parsing JSON
          const cleanOutput = stripAnsi(stdout);
          const result = JSON.parse(cleanOutput);
          
          if (result.status !== 0 || !result.result) {
            throw new Error('Invalid SF CLI response');
          }

          const orgInfo = result.result;
          
          logger.info('Access token retrieved successfully', { 
            org: usernameOrAlias,
            instanceUrl: orgInfo.instanceUrl 
          });

          resolve({
            accessToken: orgInfo.accessToken,
            instanceUrl: orgInfo.instanceUrl,
            orgId: orgInfo.id,
            username: orgInfo.username,
            alias: orgInfo.alias,
          });
        } catch (error) {
          logger.logError(error, { operation: 'parseAccessToken', org: usernameOrAlias });
          reject(new Error(`Failed to parse SF CLI response: ${error.message}`));
        }
      });

      child.on('error', (error) => {
        logger.logError(error, { operation: 'spawnSfCli', org: usernameOrAlias });
        reject(new Error(`SF CLI not available: ${error.message}`));
      });
    });
  }

  /**
   * List all authenticated orgs from SF CLI
   * @returns {Promise<Array>} List of org info
   */
  async listOrgs() {
    const stripAnsi = this.stripAnsi.bind(this);
    
    return new Promise((resolve, reject) => {
      const args = ['org', 'list', '--json'];
      
      logger.info('Listing orgs from SF CLI');
      
      const child = spawn(this.cliCommand, args, {
        shell: true,
        windowsHide: true,
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
        if (code !== 0) {
          logger.logError(new Error(`SF CLI error: ${stderr}`), { operation: 'listOrgs' });
          reject(new Error(`Failed to list orgs: ${stderr}`));
          return;
        }

        try {
          // Strip ANSI color codes before parsing JSON
          const cleanOutput = stripAnsi(stdout);
          const result = JSON.parse(cleanOutput);
          
          if (result.status !== 0 || !result.result) {
            throw new Error('Invalid SF CLI response');
          }

          // Combine scratch orgs and non-scratch orgs
          const allOrgs = [
            ...(result.result.nonScratchOrgs || []),
            ...(result.result.scratchOrgs || []),
          ];

          logger.info('Orgs listed successfully', { count: allOrgs.length });

          resolve(allOrgs.map(org => ({
            username: org.username,
            alias: org.alias || org.username,
            orgId: org.orgId,
            instanceUrl: org.instanceUrl,
            isDevHub: org.isDevHub,
            isScratchOrg: !!org.expirationDate,
            connectedStatus: org.connectedStatus,
          })));
        } catch (error) {
          logger.logError(error, { operation: 'parseOrgList' });
          reject(new Error(`Failed to parse org list: ${error.message}`));
        }
      });

      child.on('error', (error) => {
        logger.logError(error, { operation: 'spawnSfCli' });
        reject(new Error(`SF CLI not available: ${error.message}`));
      });
    });
  }

  /**
   * Test if an org is accessible
   * @param {string} usernameOrAlias - Salesforce username or alias
   * @returns {Promise<boolean>} true if accessible
   */
  async testConnection(usernameOrAlias) {
    try {
      const orgInfo = await this.getAccessToken(usernameOrAlias);
      return {
        success: true,
        message: 'Connection successful',
        orgInfo,
      };
    } catch (error) {
      // Check if it's an authentication error
      const isAuthError = error.message.includes('not authenticated') || 
                         error.message.includes('No authorization information') ||
                         error.message.includes('not found');
      
      let authError = null;
      if (isAuthError) {
        // Get relogin instructions from vlocityService
        const vlocityService = require('./vlocityService');
        authError = vlocityService.getReloginInstructions(usernameOrAlias);
      }
      
      return {
        success: false,
        message: error.message,
        error: error,
        authError,
      };
    }
  }

  /**
   * Execute a SOQL query using SF CLI
   * @param {string} usernameOrAlias - Org username or alias
   * @param {string} soql - SOQL query
   * @returns {Promise<Object>} Query results
   */
  async query(usernameOrAlias, soql) {
    const stripAnsi = this.stripAnsi.bind(this);
    
    return new Promise((resolve, reject) => {
      const args = [
        'data', 'query',
        '--target-org', usernameOrAlias,
        '--query', soql,
        '--json',
      ];
      
      logger.info('Executing SOQL via SF CLI', { org: usernameOrAlias });
      
      const child = spawn(this.cliCommand, args, {
        shell: true,
        windowsHide: true,
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
        if (code !== 0) {
          logger.logError(new Error(`SF CLI query error: ${stderr}`), {
            operation: 'sfdxQuery',
            org: usernameOrAlias,
          });
          reject(new Error(`Query failed: ${stderr}`));
          return;
        }

        try {
          // Strip ANSI color codes before parsing JSON
          const cleanOutput = stripAnsi(stdout);
          const result = JSON.parse(cleanOutput);
          
          if (result.status !== 0 || !result.result) {
            throw new Error('Invalid query response');
          }

          resolve(result.result);
        } catch (error) {
          logger.logError(error, { operation: 'parseSfdxQuery', org: usernameOrAlias });
          reject(new Error(`Failed to parse query result: ${error.message}`));
        }
      });

      child.on('error', (error) => {
        logger.logError(error, { operation: 'spawnSfCli' });
        reject(new Error(`SF CLI not available: ${error.message}`));
      });
    });
  }

  /**
   * Check if SF CLI is available
   * @returns {Promise<boolean>}
   */
  async isCliAvailable() {
    return new Promise((resolve) => {
      const child = spawn(this.cliCommand, ['--version'], {
        shell: true,
        windowsHide: true,
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });
    });
  }
}

module.exports = new SfdxAuthService();

