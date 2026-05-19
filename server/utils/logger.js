const loggingService = require('../services/loggingService');

// Export the main logger from the logging service for backward compatibility
const logger = loggingService.loggers.get('main');

// Re-export logging service methods for enhanced functionality
logger.enableVerboseMode = () => loggingService.enableVerboseMode();
logger.disableVerboseMode = () => loggingService.disableVerboseMode();
logger.enableDebugMode = () => loggingService.enableDebugMode();
logger.disableDebugMode = () => loggingService.disableDebugMode();
logger.setLoggingMode = (verbose, debug) => loggingService.setLoggingMode(verbose, debug);
logger.getLoggingConfig = () => loggingService.getLoggingConfig();
logger.cleanupLogs = (days) => loggingService.cleanupLogs(days);

// Enhanced logging methods
logger.logVerbose = (message, meta) => loggingService.logVerbose(message, meta);
logger.logDebug = (message, meta) => loggingService.logDebug(message, meta);
logger.logJob = (jobId, level, message, meta) => loggingService.logJob(jobId, level, message, meta);
logger.logJobVerbose = (jobId, message, meta) => loggingService.logJobVerbose(jobId, message, meta);
logger.logJobDebug = (jobId, message, meta) => loggingService.logJobDebug(jobId, message, meta);
logger.logVlocityCommand = (jobId, command, output, exitCode, duration) => 
  loggingService.logVlocityCommand(jobId, command, output, exitCode, duration);
logger.logFileOperation = (jobId, operation, filePath, details) => 
  loggingService.logFileOperation(jobId, operation, filePath, details);
logger.logApiRequest = (req, res, responseTime, jobId) => 
  loggingService.logApiRequest(req, res, responseTime, jobId);

module.exports = logger;
