const asyncHandler = require('../../middleware/asyncHandler');

describe('Async Handler Utility', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('should handle successful async operations', async () => {
    const asyncFn = async (req, res) => {
      res.json({ success: true });
    };

    const wrappedFn = asyncHandler(asyncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should catch and forward async errors', async () => {
    const error = new Error('Async error');
    const asyncFn = async () => {
      throw error;
    };

    const wrappedFn = asyncHandler(asyncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should handle promise rejections', async () => {
    const error = new Error('Promise rejection');
    const asyncFn = () => Promise.reject(error);

    const wrappedFn = asyncHandler(asyncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should pass through non-async functions', async () => {
    const syncFn = (req, res) => {
      res.json({ success: true });
    };

    const wrappedFn = asyncHandler(syncFn);
    await wrappedFn(mockReq, mockRes, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith({ success: true });
  });
});

