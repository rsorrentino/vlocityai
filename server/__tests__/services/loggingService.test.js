const loggingService = require('../services/loggingService');

describe('LoggingService', () => {
  beforeEach(() => {
    loggingService.disableVerboseMode();
    loggingService.disableDebugMode();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Verbose Mode', () => {
    it('should enable verbose mode', () => {
      loggingService.enableVerboseMode();
      const config = loggingService.getLoggingConfig();
      expect(config.verboseMode).toBe(true);
    });

    it('should disable verbose mode', () => {
      loggingService.enableVerboseMode();
      loggingService.disableVerboseMode();
      const config = loggingService.getLoggingConfig();
      expect(config.verboseMode).toBe(false);
    });

    it('should log verbose messages when verbose mode is enabled', () => {
      loggingService.enableVerboseMode();
      const logSpy = jest.spyOn(loggingService.loggers.get('main'), 'log');
      loggingService.logVerbose('Test verbose message');
      expect(logSpy).toHaveBeenCalled();
    });

    it('should not log verbose messages when verbose mode is disabled', () => {
      loggingService.disableVerboseMode();
      const logSpy = jest.spyOn(loggingService.loggers.get('main'), 'log');
      loggingService.logVerbose('Test verbose message');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('Debug Mode', () => {
    it('should enable debug mode', () => {
      loggingService.enableDebugMode();
      const config = loggingService.getLoggingConfig();
      expect(config.debugMode).toBe(true);
    });

    it('should disable debug mode', () => {
      loggingService.enableDebugMode();
      loggingService.disableDebugMode();
      const config = loggingService.getLoggingConfig();
      expect(config.debugMode).toBe(false);
    });

    it('should log debug messages when debug mode is enabled', () => {
      loggingService.enableDebugMode();
      const logSpy = jest.spyOn(loggingService.loggers.get('main'), 'log');
      loggingService.logDebug('Test debug message');
      expect(logSpy).toHaveBeenCalled();
    });

    it('should not log debug messages when debug mode is disabled', () => {
      loggingService.disableDebugMode();
      const logSpy = jest.spyOn(loggingService.loggers.get('main'), 'log');
      loggingService.logDebug('Test debug message');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('Job Logging', () => {
    it('should create a job logger', () => {
      const jobId = 'test-job-123';
      const logger = loggingService.createJobLogger(jobId, 'export');
      expect(logger).toBeDefined();
      expect(loggingService.jobLoggers.has(jobId)).toBe(true);
    });

    it('should get or create a job logger', () => {
      const jobId = 'test-job-456';
      const logger1 = loggingService.getJobLogger(jobId, 'deploy');
      const logger2 = loggingService.getJobLogger(jobId, 'deploy');
      expect(logger1).toBe(logger2);
    });

    it('should log job messages', () => {
      const jobId = 'test-job-789';
      const logger = loggingService.getJobLogger(jobId, 'export');
      const logSpy = jest.spyOn(logger, 'log');
      loggingService.logJob(jobId, 'info', 'Test job message');
      expect(logSpy).toHaveBeenCalledWith('info', 'Test job message', {});
    });

    it('should remove a job logger', () => {
      const jobId = 'test-job-remove';
      loggingService.createJobLogger(jobId, 'export');
      expect(loggingService.jobLoggers.has(jobId)).toBe(true);
      loggingService.removeJobLogger(jobId);
      expect(loggingService.jobLoggers.has(jobId)).toBe(false);
    });
  });

  describe('Logging Configuration', () => {
    it('should get logging configuration', () => {
      const config = loggingService.getLoggingConfig();
      expect(config).toHaveProperty('verboseMode');
      expect(config).toHaveProperty('debugMode');
      expect(config).toHaveProperty('logLevel');
      expect(config).toHaveProperty('activeJobLoggers');
      expect(config).toHaveProperty('logsDirectory');
    });

    it('should set logging mode', () => {
      loggingService.setLoggingMode(true, false);
      const config = loggingService.getLoggingConfig();
      expect(config.verboseMode).toBe(true);
      expect(config.debugMode).toBe(false);
    });

    it('should get log level based on mode', () => {
      loggingService.setLoggingMode(false, false);
      expect(loggingService.getLogLevel()).toBe('info');
      
      loggingService.setLoggingMode(true, false);
      expect(loggingService.getLogLevel()).toBe('verbose');
      
      loggingService.setLoggingMode(false, true);
      expect(loggingService.getLogLevel()).toBe('debug');
    });
  });

  describe('Vlocity Command Logging', () => {
    it('should log Vlocity command execution', () => {
      const jobId = 'test-job-command';
      const logger = loggingService.getJobLogger(jobId, 'export');
      const logSpy = jest.spyOn(logger, 'info');
      
      loggingService.logVlocityCommand(
        jobId,
        'packExport',
        'Output text',
        0,
        1000
      );
      
      expect(logSpy).toHaveBeenCalled();
    });
  });

  describe('File Operation Logging', () => {
    it('should log file operations', () => {
      const jobId = 'test-job-file';
      const logger = loggingService.getJobLogger(jobId, 'export');
      const logSpy = jest.spyOn(logger, 'info');
      
      loggingService.logFileOperation(jobId, 'read', '/path/to/file', {});
      
      expect(logSpy).toHaveBeenCalled();
    });
  });

  describe('API Request Logging', () => {
    it('should log API requests', () => {
      const req = {
        method: 'GET',
        url: '/api/test',
        get: jest.fn(),
        headers: {},
        body: {},
        query: {},
        params: {},
        ip: '127.0.0.1'
      };
      
      const res = {
        statusCode: 200
      };
      
      const logger = loggingService.loggers.get('main');
      const logSpy = jest.spyOn(logger, 'info');
      
      loggingService.logApiRequest(req, res, 50);
      
      expect(logSpy).toHaveBeenCalled();
    });
  });
});
