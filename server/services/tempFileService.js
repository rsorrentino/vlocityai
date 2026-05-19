const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Temporary File Management Service
 * Handles creation, tracking, and cleanup of temporary files with KEEP_TMP flag support
 */
class TempFileService {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp');
    this.trackedFiles = new Map(); // jobId -> Set of file paths
    this.keepTmpMode = false;
    this.ensureTempDir();
  }

  /**
   * Ensure temp directory exists
   */
  ensureTempDir() {
    fs.ensureDirSync(this.tempDir);
  }

  /**
   * Enable KEEP_TMP mode
   */
  enableKeepTmpMode() {
    this.keepTmpMode = true;
    logger.log('info', 'KEEP_TMP mode enabled - temporary files will be retained', {
      service: 'tempFileService'
    });
  }

  /**
   * Disable KEEP_TMP mode
   */
  disableKeepTmpMode() {
    this.keepTmpMode = false;
    logger.log('info', 'KEEP_TMP mode disabled - temporary files will be cleaned up', {
      service: 'tempFileService'
    });
  }

  /**
   * Set KEEP_TMP mode
   */
  setKeepTmpMode(enabled) {
    this.keepTmpMode = enabled;
    logger.log('info', `KEEP_TMP mode ${enabled ? 'enabled' : 'disabled'}`, {
      service: 'tempFileService',
      keepTmpMode: enabled
    });
  }

  /**
   * Get current KEEP_TMP mode status
   */
  getKeepTmpMode() {
    return this.keepTmpMode;
  }

  /**
   * Create a temporary file for a job
   */
  async createTempFile(jobId, filename, content = '', options = {}) {
    const { subdir = '', extension = '' } = options;
    
    // Create job-specific subdirectory
    const jobTempDir = path.join(this.tempDir, jobId, subdir);
    await fs.ensureDir(jobTempDir);
    
    // Generate unique filename if not provided
    const finalFilename = filename || `temp_${Date.now()}${extension}`;
    const filePath = path.join(jobTempDir, finalFilename);
    
    // Write content to file
    await fs.writeFile(filePath, content, 'utf8');
    
    // Track the file
    this.trackFile(jobId, filePath);
    
    logger.logFileOperation(jobId, 'temp_file_created', filePath, {
      filename: finalFilename,
      subdir,
      size: content.length,
      keepTmpMode: this.keepTmpMode
    });
    
    return filePath;
  }

  /**
   * Create a temporary directory for a job
   */
  async createTempDir(jobId, dirname, options = {}) {
    const { subdir = '' } = options;
    
    // Create job-specific subdirectory
    const jobTempDir = path.join(this.tempDir, jobId, subdir);
    await fs.ensureDir(jobTempDir);
    
    // Generate unique directory name if not provided
    const finalDirname = dirname || `temp_dir_${Date.now()}`;
    const dirPath = path.join(jobTempDir, finalDirname);
    
    // Create the directory
    await fs.ensureDir(dirPath);
    
    // Track the directory
    this.trackFile(jobId, dirPath);
    
    logger.logFileOperation(jobId, 'temp_dir_created', dirPath, {
      dirname: finalDirname,
      subdir,
      keepTmpMode: this.keepTmpMode
    });
    
    return dirPath;
  }

  /**
   * Copy a file to temporary location
   */
  async copyToTemp(jobId, sourcePath, options = {}) {
    const { subdir = '', filename = null } = options;
    
    if (!await fs.pathExists(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }
    
    // Create job-specific subdirectory
    const jobTempDir = path.join(this.tempDir, jobId, subdir);
    await fs.ensureDir(jobTempDir);
    
    // Generate filename if not provided
    const finalFilename = filename || path.basename(sourcePath);
    const destPath = path.join(jobTempDir, finalFilename);
    
    // Copy the file
    await fs.copy(sourcePath, destPath);
    
    // Track the file
    this.trackFile(jobId, destPath);
    
    logger.logFileOperation(jobId, 'temp_file_copied', destPath, {
      sourcePath,
      filename: finalFilename,
      subdir,
      keepTmpMode: this.keepTmpMode
    });
    
    return destPath;
  }

  /**
   * Track a file for cleanup
   */
  trackFile(jobId, filePath) {
    if (!this.trackedFiles.has(jobId)) {
      this.trackedFiles.set(jobId, new Set());
    }
    this.trackedFiles.get(jobId).add(filePath);
  }

  /**
   * Untrack a file (mark as manually cleaned up)
   */
  untrackFile(jobId, filePath) {
    if (this.trackedFiles.has(jobId)) {
      this.trackedFiles.get(jobId).delete(filePath);
    }
  }

  /**
   * Get all tracked files for a job
   */
  getTrackedFiles(jobId) {
    return this.trackedFiles.get(jobId) || new Set();
  }

  /**
   * Clean up temporary files for a job
   */
  async cleanupJobTempFiles(jobId, force = false) {
    if (this.keepTmpMode && !force) {
      logger.logVerbose(`Skipping cleanup for job ${jobId} - KEEP_TMP mode enabled`, {
        jobId,
        service: 'tempFileService'
      });
      return { cleaned: 0, retained: 0 };
    }

    const trackedFiles = this.getTrackedFiles(jobId);
    let cleaned = 0;
    let retained = 0;

    for (const filePath of trackedFiles) {
      try {
        if (await fs.pathExists(filePath)) {
          const stats = await fs.stat(filePath);
          if (stats.isDirectory()) {
            await fs.remove(filePath);
            logger.logFileOperation(jobId, 'temp_dir_removed', filePath, {
              size: stats.size,
              keepTmpMode: this.keepTmpMode
            });
          } else {
            await fs.remove(filePath);
            logger.logFileOperation(jobId, 'temp_file_removed', filePath, {
              size: stats.size,
              keepTmpMode: this.keepTmpMode
            });
          }
          cleaned++;
        }
      } catch (error) {
        logger.logError(error, {
          operation: 'cleanupJobTempFiles',
          jobId,
          filePath
        });
        retained++;
      }
    }

    // Clear tracking for this job
    this.trackedFiles.delete(jobId);

    logger.log('info', `Cleaned up ${cleaned} temporary files for job ${jobId}`, {
      jobId,
      cleaned,
      retained,
      keepTmpMode: this.keepTmpMode,
      service: 'tempFileService'
    });

    return { cleaned, retained };
  }

  /**
   * Clean up all temporary files (force cleanup regardless of KEEP_TMP mode)
   */
  async cleanupAllTempFiles(olderThanHours = 24) {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    let totalCleaned = 0;
    let totalRetained = 0;

    try {
      const entries = await fs.readdir(this.tempDir);
      
      for (const entry of entries) {
        const entryPath = path.join(this.tempDir, entry);
        const stats = await fs.stat(entryPath);
        
        // Check if it's a job directory and if it's old enough
        if (stats.isDirectory() && stats.mtime.getTime() < cutoffTime) {
          try {
            await fs.remove(entryPath);
            totalCleaned++;
            
            // Remove from tracking
            this.trackedFiles.delete(entry);
            
            logger.log('info', `Cleaned up old job temp directory: ${entry}`, {
              jobId: entry,
              service: 'tempFileService'
            });
          } catch (error) {
            logger.logError(error, {
              operation: 'cleanupAllTempFiles',
              jobId: entry,
              entryPath
            });
            totalRetained++;
          }
        }
      }
    } catch (error) {
      logger.logError(error, {
        operation: 'cleanupAllTempFiles',
        service: 'tempFileService'
      });
    }

    logger.log('info', `Cleaned up ${totalCleaned} old temporary directories`, {
      totalCleaned,
      totalRetained,
      olderThanHours,
      service: 'tempFileService'
    });

    return { cleaned: totalCleaned, retained: totalRetained };
  }

  /**
   * Get temporary file statistics
   */
  async getTempFileStats() {
    const stats = {
      totalJobs: this.trackedFiles.size,
      totalFiles: 0,
      totalSize: 0,
      keepTmpMode: this.keepTmpMode,
      tempDir: this.tempDir
    };

    for (const [jobId, files] of this.trackedFiles) {
      stats.totalFiles += files.size;
      
      for (const filePath of files) {
        try {
          if (await fs.pathExists(filePath)) {
            const fileStats = await fs.stat(filePath);
            stats.totalSize += fileStats.size;
          }
        } catch (error) {
          // Ignore errors for individual files
        }
      }
    }

    return stats;
  }

  /**
   * Archive temporary files for a job (move to archive instead of delete)
   */
  async archiveJobTempFiles(jobId) {
    const trackedFiles = this.getTrackedFiles(jobId);
    const archiveDir = path.join(this.tempDir, 'archive', jobId);
    await fs.ensureDir(archiveDir);
    
    let archived = 0;
    
    for (const filePath of trackedFiles) {
      try {
        if (await fs.pathExists(filePath)) {
          const relativePath = path.relative(path.join(this.tempDir, jobId), filePath);
          const archivePath = path.join(archiveDir, relativePath);
          
          await fs.move(filePath, archivePath);
          archived++;
          
          logger.logFileOperation(jobId, 'temp_file_archived', filePath, {
            archivePath,
            keepTmpMode: this.keepTmpMode
          });
        }
      } catch (error) {
        logger.logError(error, {
          operation: 'archiveJobTempFiles',
          jobId,
          filePath
        });
      }
    }

    // Clear tracking for this job
    this.trackedFiles.delete(jobId);

    logger.log('info', `Archived ${archived} temporary files for job ${jobId}`, {
      jobId,
      archived,
      archiveDir,
      service: 'tempFileService'
    });

    return { archived };
  }
}

// Create singleton instance
const tempFileService = new TempFileService();

module.exports = tempFileService;
