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
    it('maps ValidationError to 400 and keeps its message for the user', () => {
      errorHandler(new ValidationError('username is required'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      const body = mockRes.json.mock.calls[0][0];
      expect(body.error).toMatchObject({ message: 'username is required', statusCode: 400, path: '/api/test', method: 'GET' });
    });

    it('uses the generic label for third-party errors named ValidationError', () => {
      const err = new Error('column "x" violates constraint on table secret_table');
      err.name = 'ValidationError';
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.json.mock.calls[0][0].error.message).toBe('Validation Error');
    });

    it('does not reveal file paths of file-system errors', () => {
      const err = new Error("ENOENT: no such file or directory, open '/srv/app/secret.yaml'");
      err.code = 'ENOENT';
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.json.mock.calls[0][0].error).toMatchObject({ statusCode: 404, message: 'File or directory not found' });
    });

    it('maps UnauthorizedError to 401', () => {
      errorHandler(new UnauthorizedError('No token provided'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json.mock.calls[0][0].error.statusCode).toBe(401);
    });

    it('maps NotFoundError to 404', () => {
      errorHandler(new NotFoundError('Job 42 not found'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json.mock.calls[0][0].error.message).toBe('Job 42 not found');
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
