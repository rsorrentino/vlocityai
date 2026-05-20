# Copilot Instructions

## Build, test, and lint commands

```bash
# Initial setup
npm run setup
cp env.template .env

# Full-stack local development (auto-picks free backend/frontend ports)
npm run dev-full

# Production frontend build
npm run build

# Jest suites (server tests)
npm test
npm run test:unit
npm run test:routes
npm run test:integration
npm run test:enterprise

# Run a single Jest file
npx jest server/__tests__/services/logStorageService.test.js --runInBand

# Browser / load tests
npm run test:e2e
npm run test:load

# Code quality
npm run lint
npm run format
```

- `npm run build` runs `client/package.json`'s React build; if `react-scripts` is missing, run `npm run install-client` or `npm run setup` first.
- The Jest environment comes from `server/__tests__/setup.js`: tests force `NODE_ENV=test`, use `sqlite::memory:`, and disable Redis.
- The repo declares `npm run lint`, but there is currently no committed ESLint config, so that script fails until one is added.

## High-level architecture

- `server/index.js` is the composition root. It loads env/Sentry/security middleware, mounts all `/api/*` routes, exposes Swagger at `/api-docs`, and either serves `client/build` or redirects to the React dev server when `CLIENT_PORT` is set.
- `scripts/dev-full-auto-ports.js` is the normal full-stack dev entrypoint. It finds free backend/frontend ports, sets `CLIENT_PORT` plus the `REACT_APP_*` variables, then launches the backend and CRA dev server together.
- Persistence is centralized in `server/services/databaseService.js`. PostgreSQL in schema `vlocity_datapack_manager` is the primary target; `data/vlocity_manager.db` is the fallback. `server/models/index.js` defines the Sequelize models once, and `databaseService.syncModels()` rebinds them to the active connection.
- Long-running Salesforce/Vlocity work should go through the queueing layer, not ad hoc `spawn()` calls. `server/services/vlocityService.js` and `server/services/sfCliService.js` enqueue executions through `server/services/jobExecutionService.js`, which caps concurrency and supports aborting queued or running jobs.
- Real-time job updates are a separate subsystem. `server/services/jobMonitor.js` exposes `/ws/jobs`, broadcasts progress/log events, and batches job logs before flushing them to storage.
- The React app is route- and permission-driven. `client/src/App.js` wires page routes, `client/src/components/ProtectedRoute.js` enforces auth/role/permission access, and `client/src/components/Sidebar.js` mirrors the same page groupings in a collapsible left nav.
- `/api-docs`, `/api-docs.json`, and `/health` are intentionally server-handled routes. `client/src/App.js` forces a full-page navigation for those paths so React Router does not intercept them.
- Chat is its own streaming subsystem. `server/routes/chat.js` handles conversation CRUD plus `POST /api/chat/message`; `server/services/chatService.js` persists conversations/messages and streams assistant output over SSE while invoking adapter/tool logic, while the client chat UI adds searchable history, mobile drawer access, starter prompts, and message actions.

## Key conventions

- Playwright MCP is preconfigured for the repo: VS Code reads `.vscode/mcp.json`, and Copilot CLI project sessions can use `.github/mcp.json`.
- Chat storage must stay dialect-safe. `server/services/chatService.js` has to work with both PostgreSQL and the SQLite fallback, so avoid PostgreSQL-only SQL there.
- Client auth is cookie-based, not localStorage-token-based. `client/src/contexts/AuthContext.js` sets `axios.defaults.withCredentials = true`, calls relative `/api/...` endpoints, and expects the JWT in the `auth_token` httpOnly cookie.
- When adding protected UI, keep `App.js`, `ProtectedRoute`, and `Sidebar.js` in sync. New pages usually need both client-side gating and matching server middleware such as `authenticate`, `adminOnly`, or `requirePermission`.
- On the server, prefer `asyncHandler` and the shared error types from `server/middleware/errorHandler.js` instead of route-local promise wrappers. Throw `ValidationError`, `UnauthorizedError`, etc., and let the shared error middleware shape the response.
- Use the shared logger (`server/utils/logger.js`) and `logger.logError(...)` / `logger.logOperation(...)` patterns rather than ad hoc server-side `console.log`.
- Several runtime behaviors depend on repository files outside the main source tree: `env.template` defines the expected env vars, `environments.properties` is migrated into org records on startup and is also consulted by CLI services, and startup tries to create default users once the DB connection is ready.
- Chat adapter settings are intentionally client-stored. `client/src/components/chat/AdapterSettings.js` keeps adapter/org/API-key config in `localStorage`, while `ChatWindow.js` sends keys per request; those keys are not persisted server-side.
