const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Service to fix malformed JSON files in exported DataPacks
 * Fixes common issues like duplicate closing brackets/braces
 */
class DataPackFileFixer {
  /**
   * Fix JSON syntax errors in a file
   * @param {string} filePath - Path to the JSON file
   * @returns {Promise<boolean>} True if file was fixed, false if no fix needed
   */
  async fixJsonFile(filePath) {
    try {
      if (!await fs.pathExists(filePath)) {
        return false;
      }

      const content = await fs.readFile(filePath, 'utf8');
      const trimmed = content.trim();

      // Check if file is empty or only whitespace
      if (!trimmed || trimmed.length === 0) {
        logger.warn('Empty JSON file detected', { filePath });
        return false;
      }

      // Check if it's valid JSON
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
        // File is valid, no fix needed
        return false;
      } catch (parseError) {
        // File has syntax errors, attempt to fix
        logger.warn('Invalid JSON detected, attempting to fix', {
          filePath,
          error: parseError.message
        });
      }

      // Fix common issues:
      // 1. Remove duplicate closing brackets/braces at the end
      let fixed = trimmed;
      
      // Remove trailing duplicate closing brackets for arrays (multiple patterns)
      fixed = fixed.replace(/\]\s*\]\s*$/g, ']');
      fixed = fixed.replace(/\]\s*\]\s*\]\s*$/g, ']');
      
      // Remove trailing duplicate closing braces for objects (multiple patterns)
      fixed = fixed.replace(/\}\s*\}\s*$/g, '}');
      fixed = fixed.replace(/\}\s*\}\s*\}\s*$/g, '}');
      
      // Remove trailing bracket/brace combinations
      fixed = fixed.replace(/\]\s*\}\s*$/g, ']');
      fixed = fixed.replace(/\}\s*\]\s*$/g, '}');
      
      // Remove leading/trailing whitespace and newlines that might cause issues
      fixed = fixed.trim();

      // Try to fix incomplete JSON (missing closing brace/bracket)
      // Count opening and closing braces/brackets
      const openBraces = (fixed.match(/\{/g) || []).length;
      const closeBraces = (fixed.match(/\}/g) || []).length;
      const openBrackets = (fixed.match(/\[/g) || []).length;
      const closeBrackets = (fixed.match(/\]/g) || []).length;
      
      // Add missing closing braces/brackets
      if (openBraces > closeBraces) {
        fixed += '}'.repeat(openBraces - closeBraces);
      }
      if (openBrackets > closeBrackets) {
        fixed += ']'.repeat(openBrackets - closeBrackets);
      }

      // Validate the fixed content
      try {
        JSON.parse(fixed);
        // File is now valid, write it back
        await fs.writeFile(filePath, fixed, 'utf8');
        logger.info('Fixed malformed JSON file', { filePath });
        return true;
      } catch (fixError) {
        // Try one more aggressive fix: remove everything after the last valid closing brace/bracket
        try {
          // Find the last valid closing brace or bracket
          let lastValidIndex = -1;
          let braceDepth = 0;
          let bracketDepth = 0;
          
          for (let i = 0; i < fixed.length; i++) {
            if (fixed[i] === '{') braceDepth++;
            if (fixed[i] === '}') {
              braceDepth--;
              if (braceDepth === 0 && bracketDepth === 0) {
                lastValidIndex = i;
              }
            }
            if (fixed[i] === '[') bracketDepth++;
            if (fixed[i] === ']') {
              bracketDepth--;
              if (braceDepth === 0 && bracketDepth === 0) {
                lastValidIndex = i;
              }
            }
          }
          
          if (lastValidIndex > 0 && lastValidIndex < fixed.length - 1) {
            const truncated = fixed.substring(0, lastValidIndex + 1);
            JSON.parse(truncated);
            await fs.writeFile(filePath, truncated, 'utf8');
            logger.info('Fixed malformed JSON file by truncating invalid content', { filePath });
            return true;
          }
        } catch (truncateError) {
          // Truncation also failed
        }
        
        logger.error('Failed to fix JSON file', {
          filePath,
          error: fixError.message,
          originalError: parseError.message
        });
        return false;
      }
    } catch (error) {
      logger.error('Error fixing JSON file', { filePath, error: error.message });
      return false;
    }
  }

  /**
   * Fix all JSON files in a DataPack directory
   * @param {string} dataPackPath - Path to DataPack directory
   * @returns {Promise<Object>} Fix results
   */
  async fixDataPackDirectory(dataPackPath) {
    const results = {
      fixed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      emptyFiles: 0
    };

    try {
      if (!await fs.pathExists(dataPackPath)) {
        return results;
      }

      // Find all JSON files recursively
      const files = await this.findJsonFiles(dataPackPath);

      for (const file of files) {
        results.total++;
        const wasFixed = await this.fixJsonFile(file);
        if (wasFixed) {
          results.fixed++;
        } else {
          // Check if file was already valid (skipped) or if fix failed
          try {
            const content = await fs.readFile(file, 'utf8');
            const trimmed = content.trim();
            
            // Check if file is empty
            if (!trimmed || trimmed.length === 0) {
              results.emptyFiles++;
              results.failed++;
              logger.warn('Empty JSON file found (may indicate export failure)', { file });
            } else {
              JSON.parse(trimmed);
              results.skipped++;
            }
          } catch (parseError) {
            results.failed++;
            logger.warn('Invalid JSON file that could not be fixed', {
              file,
              error: parseError.message
            });
          }
        }
      }

      logger.info('DataPack directory fix completed', {
        dataPackPath,
        ...results
      });

      return results;
    } catch (error) {
      logger.error('Error fixing DataPack directory', {
        dataPackPath,
        error: error.message
      });
      return results;
    }
  }

  /**
   * Find all JSON files recursively in a directory
   * @param {string} dirPath - Directory path
   * @returns {Promise<Array<string>>} Array of file paths
   */
  async findJsonFiles(dirPath) {
    const files = [];
    
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findJsonFiles(itemPath);
          files.push(...subFiles);
        } else if (stats.isFile() && item.endsWith('.json')) {
          files.push(itemPath);
        }
      }
    } catch (error) {
      logger.warn('Error reading directory', { dirPath, error: error.message });
    }
    
    return files;
  }

  /**
   * Fix all DataPack directories in an export folder
   * @param {string} exportPath - Path to export directory
   * @returns {Promise<Object>} Fix results by DataPack type
   */
  async fixExportDirectory(exportPath) {
    const results = {
      totalFixed: 0,
      totalFailed: 0,
      totalSkipped: 0,
      totalFiles: 0,
      byDataPackType: {}
    };

    try {
      if (!await fs.pathExists(exportPath)) {
        return results;
      }

      const items = await fs.readdir(exportPath);
      
      for (const item of items) {
        const itemPath = path.join(exportPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          // This is a DataPack type directory (e.g., SObject_PricingElement)
          const dataPackResults = await this.fixDataPackDirectory(itemPath);
          
          results.byDataPackType[item] = dataPackResults;
          results.totalFixed += dataPackResults.fixed;
          results.totalFailed += dataPackResults.failed;
          results.totalSkipped += dataPackResults.skipped;
          results.totalFiles += dataPackResults.total;
        }
      }

      logger.info('Export directory fix completed', {
        exportPath,
        ...results
      });

      return results;
    } catch (error) {
      logger.error('Error fixing export directory', {
        exportPath,
        error: error.message
      });
      return results;
    }
  }
}

module.exports = new DataPackFileFixer();

