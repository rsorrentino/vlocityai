const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const backendPort = process.env.REACT_APP_API_PORT || process.env.REACT_APP_WS_PORT || '3001';
  const target = process.env.REACT_APP_API_URL || `http://localhost:${backendPort}`;

  app.use(
    ['/api', '/health', '/metrics', '/uploads', '/logs', '/api-docs', '/api-docs.json'],
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: false,
      secure: false,
      logLevel: 'warn',
    })
  );

  app.use(
    '/ws/jobs',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      secure: false,
      logLevel: 'silent',
      onError: (err) => {
        // Ignore expected socket close/reset noise during reconnects.
        const ignoredCodes = new Set([
          'ERR_STREAM_WRITE_AFTER_END',
          'ECONNRESET',
          'EPIPE',
          'ECONNABORTED',
        ]);
        if (err && ignoredCodes.has(err.code)) {
          return;
        }
        console.warn('[HPM] WebSocket proxy error:', err && err.message ? err.message : err);
      },
    })
  );
};
