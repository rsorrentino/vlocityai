const {
  errorHandler,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  AppError,
} = require('../../middleware/errorHandler');

describe('Error Handler Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockReq = { url: '/api/test', method: 'GET', ip: '127.0.0.1', headers: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('error classes', () => {
    it.each([
      [ValidationError, 'ValidationError', 400],
      [UnauthorizedError, 'UnauthorizedError', 401],
      [ForbiddenError, 'ForbiddenError', 403],
      [NotFoundError, 'NotFoundError', 404],
    ])('%p has the right name and status', (Cls, name, statusCode) => {
      const error = new Cls('boom');
      expect(error).toBeInstanceOf(AppError);
      expect(error.name).toBe(name);
      expect(error.statusCode).toBe(statusCode);
      expect(error.message).toBe('boom');
      expect(error.isOperational).toBe(true);
    });
  });

  describe('errorHandler', () => {
    it('maps ValidationError to 400', () => {
      errorHandler(new ValidationError('Invalid input'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      const body = mockRes.json.mock.calls[0][0];
      expect(body.error).toMatchObject({ message: 'Validation Error', statusCode: 400, path: '/api/test', method: 'GET' });
    });

    it('maps UnauthorizedError to 401', () => {
      errorHandler(new UnauthorizedError('No token provided'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json.mock.calls[0][0].error.statusCode).toBe(401);
    });

    it('maps NotFoundError to 404', () => {
      errorHandler(new NotFoundError('Resource not found'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('returns 500 for generic errors', () => {
      errorHandler(new Error('Something went wrong'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json.mock.calls[0][0].error.message).toBe('Something went wrong');
    });

    it('works with request objects that have no get() helper', () => {
      expect(() => errorHandler({}, {}, mockRes, mockNext)).not.toThrow();
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('includes the stack for 5xx errors in development', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Test error');
      errorHandler(error, mockReq, mockRes, mockNext);
      expect(mockRes.json.mock.calls[0][0].error.stack).toBeDefined();
    });

    it('never includes the stack for 4xx errors', () => {
      process.env.NODE_ENV = 'development';
      errorHandler(new ValidationError('bad'), mockReq, mockRes, mockNext);
      expect(mockRes.json.mock.calls[0][0].error.stack).toBeUndefined();
    });

    it('hides internal messages and stack in production', () => {
      process.env.NODE_ENV = 'production';
      errorHandler(new Error('db password is hunter2'), mockReq, mockRes, mockNext);
      const body = mockRes.json.mock.calls[0][0];
      expect(body.error.message).toBe('Internal Server Error');
      expect(body.error.stack).toBeUndefined();
    });
  });
});
