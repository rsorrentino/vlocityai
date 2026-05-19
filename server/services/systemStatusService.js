const { spawn } = require('child_process');
const { SystemStatus } = require('../models');
const logger = require('../utils/logger');
const databaseService = require('./databaseService');
const cacheService = require('./cacheService');

class SystemStatusService {
  constructor() {
    this.statusChecks = new Map();
    this.checkInterval = 60000; // 1 minute
    this.isRunning = false;
    this.vlocityCliLogged = false; // Track if we've already logged Vlocity CLI message
  }

  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('System status monitoring started');
    
    // Initial check
    await this.performAllChecks();
    
    // Set up interval
    this.statusInterval = setInterval(async () => {
      await this.performAllChecks();
    }, this.checkInterval);
  }

  async stop() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    this.isRunning = false;
    logger.info('System status monitoring stopped');
  }

  async performAllChecks() {
    const checks = [
      this.checkVlocityCLI(),
      this.checkSalesforceCLI(),
      this.checkSfdmuPlugin(),
      this.checkDatabaseConnection(),
      this.checkRedisConnection(),
      this.checkFileSystemAccess()
    ];

    await Promise.allSettled(checks);
  }

  async checkVlocityCLI() {
    try {
      // Use VlocityService to check CLI availability and get version
      const vlocityService = require('./vlocityService');
      const isAvailable = await vlocityService.checkAvailability();
      
      if (isAvailable) {
        try {
          const version = await vlocityService.getVersion();
          await this.updateStatus('vlocity-cli', {
            status: 'healthy',
            message: `Vlocity CLI available: ${version}`,
            metadata: { version: version }
          });
        } catch (versionError) {
          // CLI is available but version check failed
          logger.info(`vlocity version check failed: ${versionError.message}`);
          await this.updateStatus('vlocity-cli', {
            status: 'warning',
            message: 'Vlocity CLI detected but version check failed',
            metadata: { error: versionError.message }
          });
        }
      } else {
        throw new Error('Vlocity CLI not available');
      }
    } catch (error) {
      logger.info(`vlocity error: ${error.message}`);
      // Vlocity CLI is critical - log the error
      logger.warn('Vlocity CLI not found - this is required for export/deploy operations');
      
      await this.updateStatus('vlocity-cli', {
        status: 'error',
        message: 'Vlocity CLI not installed - required for operations. Install with: npm install -g vlocity',
        metadata: { 
          installCommand: 'npm install -g vlocity',
          critical: true 
        }
      });
    }
  }

  // Removed installVlocityCLI method - Vlocity CLI installation is now optional
  // Users can install manually with: npm install -g vlocity

  async checkSalesforceCLI() {
    try {
      // Try modern 'sf' CLI first, fallback to legacy 'sfdx'
      // Use shell execution for better Windows compatibility
      let result;
      let command = 'sf';
      
      const approaches = [
        // Approach 1: Try 'sf' command with shell (works on Windows)
        () => this.executeCommandWithShell('sf', ['--version']),
        // Approach 2: Try 'sfdx' command with shell (legacy)
        () => this.executeCommandWithShell('sfdx', ['--version']),
        // Approach 3: Try 'sf.cmd' on Windows
        () => this.executeCommandWithShell('sf.cmd', ['--version']),
        // Approach 4: Try 'sfdx.cmd' on Windows
        () => this.executeCommandWithShell('sfdx.cmd', ['--version']),
      ];

      let found = false;
      for (const approach of approaches) {
        try {
          result = await approach();
          // Determine which command worked
          if (result.includes('sf ') || result.includes('sf@')) {
            command = 'sf';
          } else if (result.includes('sfdx ') || result.includes('sfdx@')) {
            command = 'sfdx';
          }
          found = true;
          break;
        } catch (error) {
          // Continue to next approach
          continue;
        }
      }

      if (!found) {
        throw new Error('Neither sf nor sfdx CLI found');
      }
      
      await this.updateStatus('salesforce-cli', {
        status: 'healthy',
        message: `Salesforce CLI available (${command}): ${result.trim()}`,
        metadata: { version: result.trim(), command }
      });
    } catch (error) {
      await this.updateStatus('salesforce-cli', {
        status: 'error',
        message: 'Salesforce CLI not available - install with: npm install -g @salesforce/cli',
        metadata: { error: error.message, installCommand: 'npm install -g @salesforce/cli' }
      });
    }
  }

  async checkSfdmuPlugin() {
    try {
      const output = await this.executeCommandWithShell('sf', ['plugins', '--core']);
      const installed = output.toLowerCase().includes('sfdmu');
      await this.updateStatus('sfdmu-plugin', {
        status: installed ? 'healthy' : 'warning',
        message: installed
          ? 'SFDMU plugin installed'
          : 'SFDMU plugin not installed — run: sf plugins install sfdmu@latest',
        metadata: { installCommand: 'sf plugins install sfdmu@latest' }
      });
    } catch (error) {
      await this.updateStatus('sfdmu-plugin', {
        status: 'warning',
        message: 'Could not determine SFDMU plugin status',
        metadata: { error: error.message }
      });
    }
  }

  executeCommandWithShell(command, args = []) {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWindows, // Use shell on Windows for better PATH resolution
        windowsHide: true,
        timeout: 10000
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
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async checkDatabaseConnection() {
    try {
      const status = databaseService.getConnectionStatus();
      
      await this.updateStatus('database', {
        status: status.connected ? 'healthy' : 'error',
        message: status.connected ? 'Database connected' : 'Database disconnected',
        metadata: status
      });
    } catch (error) {
      await this.updateStatus('database', {
        status: 'error',
        message: 'Database connection failed',
        metadata: { error: error.message }
      });
    }
  }

  async checkRedisConnection() {
    try {
      const status = cacheService.getConnectionStatus();
      
      await this.updateStatus('redis', {
        status: status.connected ? 'healthy' : 'warning',
        message: status.connected ? 'Redis connected' : 'Redis not available (caching disabled)',
        metadata: status
      });
    } catch (error) {
      await this.updateStatus('redis', {
        status: 'warning',
        message: 'Redis connection failed (caching disabled)',
        metadata: { error: error.message }
      });
    }
  }

  async checkFileSystemAccess() {
    try {
      const fs = require('fs-extra');
      const path = require('path');
      
      const testDir = path.join(__dirname, '../temp');
      await fs.ensureDir(testDir);
      
      const testFile = path.join(testDir, 'test-write.tmp');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
      
      await this.updateStatus('filesystem', {
        status: 'healthy',
        message: 'File system access working',
        metadata: { testDir }
      });
    } catch (error) {
      await this.updateStatus('filesystem', {
        status: 'error',
        message: 'File system access failed',
        metadata: { error: error.message }
      });
    }
  }

  async updateStatus(component, statusData) {
    try {
      await SystemStatus.upsert({
        component,
        ...statusData,
        lastChecked: new Date()
      });
    } catch (error) {
      logger.logError(error, { operation: 'Update system status', component });
    }
  }

  async getSystemStatus() {
    try {
      const statuses = await SystemStatus.findAll({
        order: [['component', 'ASC']]
      });
      
      const overallStatus = this.calculateOverallStatus(statuses);
      
      return {
        overall: overallStatus,
        components: statuses,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.logError(error, { operation: 'Get system status' });
      return {
        overall: 'error',
        components: [],
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  calculateOverallStatus(statuses) {
    if (statuses.length === 0) return 'unknown';
    
    // Critical components that must be healthy for the system to function
    const criticalComponents = ['salesforce-cli', 'vlocity-cli', 'database', 'filesystem'];
    const criticalStatuses = statuses.filter(s => criticalComponents.includes(s.component));
    
    // Check critical components first
    if (criticalStatuses.some(s => s.status === 'error')) {
      return 'error';
    }
    
    // Redis is optional, so warnings from it don't affect overall status
    const nonOptionalStatuses = statuses.filter(s => s.component !== 'redis');
    
    // Check if any non-optional components have errors
    if (nonOptionalStatuses.some(s => s.status === 'error')) {
      return 'error';
    }
    
    // Check if any components have warnings (excluding optional redis)
    if (nonOptionalStatuses.some(s => s.status === 'warning')) {
      return 'warning';
    }
    
    return 'healthy';
  }

  executeCommand(command, args = []) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000
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
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}

module.exports = new SystemStatusService();
