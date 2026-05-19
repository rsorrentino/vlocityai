const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

/**
 * Vlocity Version Management Service
 * Handles per-job version control and version validation
 */
class VlocityVersionService {
  constructor() {
    this.defaultVersion = process.env.VLOCITY_VERSION || '1.17.18';
    this.availableVersions = new Set();
    this.versionCache = new Map(); // Cache for version validation results
    this.initializeAvailableVersions();
  }

  /**
   * Initialize available versions from environment and common locations
   */
  async initializeAvailableVersions() {
    try {
      // Add default version
      this.availableVersions.add(this.defaultVersion);
      
      // Check for version in package.json
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        const packageJson = await fs.readJson(packageJsonPath);
        if (packageJson.vlocityVersion) {
          this.availableVersions.add(packageJson.vlocityVersion);
        }
      }
      
      // Check for version in environment variables
      if (process.env.VLOCITY_VERSIONS) {
        const versions = process.env.VLOCITY_VERSIONS.split(',').map(v => v.trim());
        versions.forEach(version => this.availableVersions.add(version));
      }
      
      // Try to detect installed versions
      await this.detectInstalledVersions();
      
      logger.log('info', `Initialized Vlocity version service with ${this.availableVersions.size} versions`, {
        versions: Array.from(this.availableVersions),
        service: 'vlocityVersionService'
      });
    } catch (error) {
      logger.logError(error, {
        operation: 'initializeAvailableVersions',
        service: 'vlocityVersionService'
      });
    }
  }

  /**
   * Detect installed Vlocity versions
   */
  async detectInstalledVersions() {
    try {
      // Check npm global packages
      const npmVersions = await this.getNpmInstalledVersions();
      npmVersions.forEach(version => this.availableVersions.add(version));
      
      // Check for local installations
      const localVersions = await this.getLocalInstalledVersions();
      localVersions.forEach(version => this.availableVersions.add(version));
      
    } catch (error) {
      logger.logDebug('Could not detect installed versions', {
        error: error.message,
        service: 'vlocityVersionService'
      });
    }
  }

  /**
   * Get versions installed via npm
   */
  async getNpmInstalledVersions() {
    return new Promise((resolve) => {
      const child = spawn('npm', ['list', '-g', 'vlocity', '--depth=0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true
      });
      
      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.on('close', () => {
        const versions = [];
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(/vlocity@(\d+\.\d+\.\d+)/);
          if (match) {
            versions.push(match[1]);
          }
        }
        resolve(versions);
      });
      
      child.on('error', () => resolve([]));
    });
  }

  /**
   * Get versions installed locally
   */
  async getLocalInstalledVersions() {
    const versions = [];
    
    try {
      // Check node_modules
      const nodeModulesPath = path.join(process.cwd(), 'node_modules', 'vlocity');
      if (await fs.pathExists(nodeModulesPath)) {
        const packageJsonPath = path.join(nodeModulesPath, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
          const packageJson = await fs.readJson(packageJsonPath);
          if (packageJson.version) {
            versions.push(packageJson.version);
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }
    
    return versions;
  }

  /**
   * Validate if a version is available
   */
  async validateVersion(version) {
    if (this.versionCache.has(version)) {
      return this.versionCache.get(version);
    }
    
    const isValid = await this.checkVersionAvailability(version);
    this.versionCache.set(version, isValid);
    
    return isValid;
  }

  /**
   * Check if a specific version is available
   */
  async checkVersionAvailability(version) {
    try {
      // First check if it's in our available versions
      if (this.availableVersions.has(version)) {
        return true;
      }
      
      // Try to run vlocity with specific version
      const isAvailable = await this.testVersionCommand(version);
      
      if (isAvailable) {
        this.availableVersions.add(version);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.logDebug('Version availability check failed', {
        version,
        error: error.message,
        service: 'vlocityVersionService'
      });
      return false;
    }
  }

  /**
   * Test if a version command works
   */
  async testVersionCommand(version) {
    return new Promise((resolve) => {
      const command = `vlocity@${version} --version`;
      const child = spawn(command, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
        timeout: 10000
      });
      
      child.on('close', (code) => {
        resolve(code === 0);
      });
      
      child.on('error', () => resolve(false));
      
      // Timeout
      setTimeout(() => {
        child.kill();
        resolve(false);
      }, 10000);
    });
  }

  /**
   * Get the command for a specific version
   */
  getVersionCommand(version) {
    if (version === this.defaultVersion) {
      return 'vlocity';
    }
    
    return `vlocity@${version}`;
  }

  /**
   * Get available versions
   */
  getAvailableVersions() {
    return Array.from(this.availableVersions).sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || 0;
        const bPart = bParts[i] || 0;
        
        if (aPart !== bPart) {
          return bPart - aPart; // Descending order (newest first)
        }
      }
      
      return 0;
    });
  }

  /**
   * Get default version
   */
  getDefaultVersion() {
    return this.defaultVersion;
  }

  /**
   * Set default version
   */
  setDefaultVersion(version) {
    if (this.availableVersions.has(version)) {
      this.defaultVersion = version;
      logger.log('info', `Default Vlocity version set to ${version}`, {
        version,
        service: 'vlocityVersionService'
      });
      return true;
    }
    return false;
  }

  /**
   * Add a version to available versions
   */
  addVersion(version) {
    this.availableVersions.add(version);
    this.versionCache.delete(version); // Clear cache for this version
    logger.log('info', `Added Vlocity version ${version} to available versions`, {
      version,
      service: 'vlocityVersionService'
    });
  }

  /**
   * Remove a version from available versions
   */
  removeVersion(version) {
    const removed = this.availableVersions.delete(version);
    this.versionCache.delete(version); // Clear cache for this version
    
    if (removed) {
      logger.log('info', `Removed Vlocity version ${version} from available versions`, {
        version,
        service: 'vlocityVersionService'
      });
    }
    
    return removed;
  }

  /**
   * Get version info for a job
   */
  getJobVersionInfo(jobVersion = null) {
    const version = jobVersion || this.defaultVersion;
    const command = this.getVersionCommand(version);
    const isAvailable = this.availableVersions.has(version);
    
    return {
      version,
      command,
      isAvailable,
      isDefault: version === this.defaultVersion,
      availableVersions: this.getAvailableVersions()
    };
  }

  /**
   * Validate job version configuration
   */
  async validateJobVersion(jobVersion, jobId = null) {
    if (!jobVersion) {
      return {
        valid: true,
        version: this.defaultVersion,
        command: this.getVersionCommand(this.defaultVersion),
        message: 'Using default version'
      };
    }
    
    const isValid = await this.validateVersion(jobVersion);
    
    if (!isValid) {
      const error = new Error(`Vlocity version ${jobVersion} is not available`);
      error.code = 'VERSION_NOT_AVAILABLE';
      error.availableVersions = this.getAvailableVersions();
      throw error;
    }
    
    return {
      valid: true,
      version: jobVersion,
      command: this.getVersionCommand(jobVersion),
      message: `Using version ${jobVersion}`
    };
  }

  /**
   * Get version statistics
   */
  getVersionStats() {
    return {
      defaultVersion: this.defaultVersion,
      availableVersions: this.getAvailableVersions(),
      totalVersions: this.availableVersions.size,
      cacheSize: this.versionCache.size,
      service: 'vlocityVersionService'
    };
  }

  /**
   * Clear version cache
   */
  clearCache() {
    this.versionCache.clear();
    logger.log('info', 'Vlocity version cache cleared', {
      service: 'vlocityVersionService'
    });
  }

  /**
   * Refresh available versions
   */
  async refreshAvailableVersions() {
    this.availableVersions.clear();
    this.versionCache.clear();
    await this.initializeAvailableVersions();
    
    logger.log('info', 'Refreshed available Vlocity versions', {
      versions: this.getAvailableVersions(),
      service: 'vlocityVersionService'
    });
  }
}

// Create singleton instance
const vlocityVersionService = new VlocityVersionService();

module.exports = vlocityVersionService;
