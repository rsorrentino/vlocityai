/**
 * Central role-based access policy for every /api route.
 *
 * Each request is mapped to a (resource, action) pair from the permission
 * matrix in authService.getRolePermissions():
 *
 *   admin       everything
 *   developer   jobs r/w/x, orgs r/w, configs r/w, pricing r/w, promotions r/w/x,
 *               system r, logs r, analytics r
 *   functional  jobs r/x, orgs r, configs r, pricing r/w, promotions r/w/x, analytics r
 *
 * Action is derived from the HTTP method (GET/HEAD = read, anything else =
 * write) unless the path is a known "run something" endpoint (execute) or a
 * POST that only reads/validates (read). Some areas are restricted by role
 * instead (admin-only settings, developer tools).
 *
 * The user's role, permissions and active flag are read from the database
 * (cached briefly), so deactivating a user or changing a role takes effect
 * within seconds instead of when the 24 h token expires.
 */
const { ForbiddenError, UnauthorizedError } = require('./errorHandler');
const logger = require('../utils/logger');

const ANY = 'any';

// POST endpoints that only read, preview or validate – they need `read`.
const READ_ONLY_POSTS = [
  /\/preflight$/,
  /\/validate$/,
  /\/test-connection$/,
  /\/test$/,
  /\/test-config$/,
  /\/preview(-fix)?$/,
  /\/compare$/,
  /\/calculate-discount$/,
  /\/analyze$/,
  /\/diagnose$/,
  /\/errors\/analyze$/,
  /\/clear-cache$/,
  /\/refresh-status$/,
  /\/bulk\/(validate|export)$/,
  /^\/api\/export\/(csv|excel|pdf)$/,
  /^\/api\/(vlocity\/promotions|vlocity\/pricing-api\/price-lists\/[^/]+|countries|sfdmu\/configs\/[^/]+)\/export$/,
  /^\/api\/validation\/(pricing|catalog|deployment|repair-product)$/,
];

// Endpoints that start, stop or apply work against an org – they need `execute`
// on the jobs resource (functional users can run jobs, not edit config).
const EXECUTE_PATHS = [
  /^\/api\/(exports|deploys)\/run$/,
  /^\/api\/(exports|deploys|jobs)\/jobs\/[^/]+\/abort$/,
  /^\/api\/jobs\/[^/]+\/(abort|log|progress|complete)$/,
  /^\/api\/deploys\/(sequential|jobs\/[^/]+\/rollback)$/,
  /^\/api\/pipelines\/[^/]+\/(start|abort|stages\/\d+\/approve)$/,
  /^\/api\/sfdmu\/(run|configs\/[^/]+\/run)$/,
  /^\/api\/service-creation\/(run|run-batch)$/,
  /^\/api\/(vlocity\/pricing|catalog)\/batch\/execute$/,
];

/**
 * Ordered rules – the first rule whose `path` matches decides.
 *   allow: ANY                    any signed-in user (router may check more)
 *   roles: [...]                  only these roles
 *   resource: '...'               permission matrix lookup
 *   mutatingRoles: [...]          roles for non-read methods (reads use `resource`)
 */
const RULES = [
  // Self-service areas; the routers scope data to the current user or check admin themselves
  { path: /^\/api\/auth(\/|$)/, allow: ANY },
  { path: /^\/api\/notifications(\/|$)/, allow: ANY },
  { path: /^\/api\/chat(\/|$)/, allow: ANY },

  // Administration
  { path: /^\/api\/(audit|backup|performance)(\/|$)/, roles: ['admin'] },
  { path: /^\/api\/(config|logging|temp-files)(\/|$)/, resource: 'system', mutatingRoles: ['admin'] },
  { path: /^\/api\/logs\/level$/, roles: ['admin'] },
  { path: /^\/api\/logs(\/|$)/, resource: 'logs' },

  // Developer tooling (raw CLI commands, Apex, metadata deploys)
  { path: /^\/api\/vlocity-commands(\/|$)/, roles: ['admin', 'developer'] },
  { path: /^\/api\/salesforce\/apex(\/|$)/, roles: ['admin', 'developer'] },
  { path: /^\/api\/vlocity\/deploy-metadata$/, roles: ['admin', 'developer'] },

  // Org management
  { path: /^\/api\/system\/run-auth-command$/, resource: 'orgs', forceAction: 'write' },
  { path: /^\/api\/org-auth(\/|$)/, resource: 'orgs' },
  { path: /^\/api\/system(\/|$)/, resource: 'system' },
  { path: /^\/api\/orgs(\/|$)/, resource: 'orgs' },

  // Jobs (exports, deploys, pipelines, job history)
  { path: /^\/api\/(exports|export-health|export|deploys|jobs|pipelines)(\/|$)/, resource: 'jobs' },

  // Pricing & promotions (functional users may edit these)
  { path: /^\/api\/vlocity\/(pricing|pricing-api|enhanced-pricing)(\/|$)/, resource: 'pricing' },
  { path: /^\/api\/vlocity\/promotions(\/|$)/, resource: 'promotions' },
  { path: /^\/api\/catalog\/(price-lists|pricing-variables|rate-codes|rate-tables)(\/|$)/, resource: 'pricing' },
  { path: /^\/api\/catalog\/promotions(\/|$)/, resource: 'promotions' },

  // Everything else is configuration / org data
  {
    path: /^\/api\/(catalog|yaml|sfdmu|properties|environments|countries|vlocity|env-comparison|service-creation|salesforce|validation)(\/|$)/,
    resource: 'configs',
  },
];

function routePath(req) {
  return ((req.baseUrl || '') + (req.path || '')).replace(/\/+$/, '') || '/';
}

function resolveAction(method, path, rule) {
  if (rule.forceAction) return rule.forceAction;
  if (EXECUTE_PATHS.some((re) => re.test(path))) return 'execute';
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (READ_ONLY_POSTS.some((re) => re.test(path))) return 'read';
  return method === 'DELETE' ? 'delete' : 'write';
}

/**
 * Decide whether a request is allowed. Pure function – exported for tests.
 * @param {{method:string, path:string, user:{role:string, permissions:Array}}} input
 * @returns {{allowed:boolean, reason?:string, resource?:string, action?:string}}
 */
function evaluate({ method, path, user }) {
  const rule = RULES.find((r) => r.path.test(path));
  if (!rule) {
    // Unknown /api path: allow only admins (fail closed for new routes)
    return user.role === 'admin'
      ? { allowed: true }
      : { allowed: false, reason: 'No access rule for this endpoint' };
  }
  if (rule.allow === ANY) return { allowed: true };
  if (user.role === 'admin') return { allowed: true };

  if (rule.roles) {
    return rule.roles.includes(user.role)
      ? { allowed: true }
      : { allowed: false, reason: `Requires role: ${rule.roles.join(' or ')}` };
  }

  const action = resolveAction(method, path, rule);
  let resource = rule.resource;

  if (rule.mutatingRoles && action !== 'read') {
    return rule.mutatingRoles.includes(user.role)
      ? { allowed: true }
      : { allowed: false, reason: `Requires role: ${rule.mutatingRoles.join(' or ')}` };
  }

  // "Run" endpoints are governed by the jobs:execute permission everywhere
  if (action === 'execute') resource = 'jobs';
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  const entry = perms.find((p) => p.resource === resource);
  const actions = entry ? entry.actions || [] : [];
  return actions.includes(action)
    ? { allowed: true, resource, action }
    : { allowed: false, reason: `Permission denied: ${action} on ${resource}`, resource, action };
}

// ── Current user lookup (role/active flag from the DB, cached briefly) ───────

const CACHE_TTL_MS = 15 * 1000;
const userCache = new Map(); // userId -> { at, data }

async function loadAccess(userId) {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const { User } = require('../models');
  const row = await User.findByPk(userId, { attributes: ['id', 'role', 'isActive', 'permissions'] });
  const data = row
    ? {
        role: row.role,
        isActive: row.isActive !== false,
        permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions || [],
      }
    : null;
  userCache.set(userId, { at: Date.now(), data });
  return data;
}

function clearAccessCache(userId) {
  if (userId) userCache.delete(userId);
  else userCache.clear();
}

/**
 * Express middleware; mount after the authentication gate.
 * @param {{isPublic:(req)=>boolean}} opts
 */
function authorizeRequest({ isPublic = () => false } = {}) {
  return async (req, res, next) => {
    try {
      if (req.method === 'OPTIONS' || isPublic(req)) return next();
      if (!req.userId) throw new UnauthorizedError('Authentication required');

      const access = await loadAccess(req.userId);
      if (!access || !access.isActive) {
        clearAccessCache(req.userId);
        throw new UnauthorizedError('Account is disabled or no longer exists');
      }
      // Keep req.user consistent with the database for downstream handlers
      req.user = { ...req.user, role: access.role, permissions: access.permissions };

      const path = routePath(req);
      const decision = evaluate({ method: req.method, path, user: access });
      if (!decision.allowed) {
        logger.warn('Access denied', { user: req.user.username, role: access.role, method: req.method, path, reason: decision.reason });
        throw new ForbiddenError(decision.reason);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { authorizeRequest, evaluate, clearAccessCache, RULES, READ_ONLY_POSTS, EXECUTE_PATHS };
