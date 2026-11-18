import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The sources use JSX in .js files (Create React App convention).
const JSX_IN_JS = /src\/.*\.jsx?$/;

const PROXIED = ['/api', '/health', '/metrics', '/uploads', '/logs', '/api-docs', '/api-docs.json'];

// Large libraries get their own long-lived chunks so a page change does not
// invalidate them.
function vendorChunk(id) {
  if (!id.includes('node_modules')) return undefined;
  if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
  if (id.includes('@mui/x-data-grid') || id.includes('@mui/x-date-pickers')) return 'mui-x';
  if (id.includes('@mui/icons-material')) return 'mui-icons';
  if (id.includes('@mui/') || id.includes('@emotion/')) return 'mui';
  if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts';
  if (id.includes('react-markdown') || id.includes('micromark') || id.includes('mdast') || id.includes('hast') || id.includes('unified')) return 'markdown';
  return undefined;
}

export default defineConfig(({ mode }) => {
  // REACT_APP_* names are kept so existing .env files keep working.
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'REACT_APP_']);
  const backendPort = env.REACT_APP_API_PORT || env.REACT_APP_WS_PORT || '3001';
  const target = env.REACT_APP_API_URL || `http://localhost:${backendPort}`;

  return {
    envPrefix: ['VITE_', 'REACT_APP_'],
    plugins: [react({ include: /\.(js|jsx)$/ })],
    esbuild: { loader: 'jsx', include: JSX_IN_JS, exclude: [] },
    optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
    server: {
      port: Number(process.env.PORT || 3000),
      proxy: {
        ...Object.fromEntries(PROXIED.map((p) => [p, { target, changeOrigin: true, secure: false }])),
        '/ws/jobs': { target, changeOrigin: true, secure: false, ws: true },
      },
    },
    preview: { port: 3000 },
    build: {
      outDir: 'build',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: { output: { manualChunks: vendorChunk } },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      include: ['src/**/*.test.{js,jsx}'],
      css: false,
    },
  };
});
