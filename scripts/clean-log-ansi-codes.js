require('dotenv').config({ path: './.env' });
const fs = require('fs-extra');
const path = require('path');
const logger = require('../server/utils/logger');

/**
 * Clean ANSI color codes from existing log files
 */
async function cleanLogAnsiCodes() {
  const logsDir = path.join(__dirname, '../logs/jobs');
  
  logger.info('Starting ANSI code cleanup for existing log files...');
  
  try {
    // Ensure logs directory exists
    if (!await fs.pathExists(logsDir)) {
      logger.warn('Logs directory does not exist');
      return;
    }
    
    // Get all log files
    const files = await fs.readdir(logsDir);
    const logFiles = files.filter(file => file.endsWith('.log'));
    
    logger.info(`Found ${logFiles.length} log files to clean`);
    
    let cleanedCount = 0;
    
    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      
      try {
        // Read file content
        const content = await fs.readFile(filePath, 'utf8');
        
        // Strip ANSI codes using multiple patterns
        // eslint-disable-next-line no-control-regex
        const cleanedContent = content
          .replace(/\x1b\[[0-9;]*m/g, '')  // \x1b pattern
          .replace(/\u001b\[[0-9;]*m/g, '') // \u001b pattern
          .replace(/\033\[[0-9;]*m/g, '')   // \033 pattern
          .replace(/\[\d+m/g, '');          // Leftover [Nm patterns
        
        // Only write if content changed
        if (cleanedContent !== content) {
          await fs.writeFile(filePath, cleanedContent, 'utf8');
          cleanedCount++;
          logger.info(`✅ Cleaned: ${file}`);
        }
      } catch (error) {
        logger.error(`Failed to clean ${file}:`, error.message);
      }
    }
    
    logger.info(`✅ Cleanup completed: ${cleanedCount} files cleaned`);
    
  } catch (error) {
    logger.error('Cleanup failed:', error);
  }
}

// Run the cleanup
cleanLogAnsiCodes()
  .then(() => {
    logger.info('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Script failed:', error);
    process.exit(1);
  });

