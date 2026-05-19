const { errorHandler, ValidationError, NotFoundError, AuthenticationError } = require('../../middleware/errorHandler');

describe('Error Handler Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('ValidationError', () => {
    it('should create validation error with correct properties', () => {
      const error = new ValidationError('Invalid input');
      
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.isOperational).toBe(true);
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error with correct properties', () => {
      const error = new NotFoundError('Resource not found');
      
      expect(error.name).toBe('NotFoundError');
      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
      expect(error.isOperational).toBe(true);
    });
  });

  describe('AuthenticationError', () => {
    it('should create authentication error with correct properties', () => {
      const error = new AuthenticationError('Unauthorized');
      
      expect(error.name).toBe('AuthenticationError');
      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
      expect(error.isOperational).toBe(true);
    });
  });

  describe('errorHandler', () => {
    it('should handle ValidationError correctly', () => {
      const error = new ValidationError('Invalid input');
      
      errorHandler(error, mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          name: 'ValidationError',
          message: 'Invalid input',
          statusCode: 400,
        },
      });
    });

    it('should handle NotFoundError correctly', () => {
      const error = new NotFoundError('Resource not found');
      
      errorHandler(error, mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          name: 'NotFoundError',
          message: 'Resource not found',
          statusCode: 404,
        },
      });
    });

    it('should handle generic errors', () => {
      const error = new Error('Something went wrong');
      
      errorHandler(error, mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          name: 'Error',
          message: 'Something went wrong',
          statusCode: 500,
        },
      });
    });

    it('should handle errors without message', () => {
      const error = {};
      
      errorHandler(error, mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should include stack trace in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const error = new Error('Test error');
      error.stack = 'Error stack trace';
      
      errorHandler(error, mockReq, mockRes, mockNext);
      
      const jsonCall = mockRes.json.mock.calls[0][0];
      expect(jsonCall.error.stack).toBeDefined();
      
      process.env.NODE_ENV = originalEnv;
    });

    it('should not include stack trace in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const error = new Error('Test error');
      error.stack = 'Error stack trace';
      
      errorHandler(error, mockReq, mockRes, mockNext);
      
      const jsonCall = mockRes.json.mock.calls[0][0];
      expect(jsonCall.error.stack).toBeUndefined();
      
      process.env.NODE_ENV = originalEnv;
    });
  });
});

