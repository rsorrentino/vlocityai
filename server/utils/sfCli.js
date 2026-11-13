/**
 * Salesforce CLI resolution helpers (shared by every service that shells out
 * to `sf` / `sfdx`). Detection is cached because spawning the CLI just to
 * print its version costs 1-3 seconds, especially on Windows.
 */
const { commandAvailable } = require('./processRunner');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = null; // { cli: 'sf'|'sfdx'|null, at: number }
let inflight = null;

/**
 * Resolve the available Salesforce CLI executable.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<'sf'|'sfdx'|null>}
 */
async function resolveSfCli(opts = {}) {
  const { force = false } = opts;
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.cli;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    let cli = null;
    if (process.env.SF_CLI_COMMAND) {
      cli = process.env.SF_CLI_COMMAND;
    } else if (await commandAvailable('sf', ['--version'])) {
      cli = 'sf';
    } else if (await commandAvailable('sfdx', ['--version'])) {
      cli = 'sfdx';
    }
    cached = { cli, at: Date.now() };
    return cli;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Clear the cached detection (used by tests and after CLI installation). */
function resetSfCliCache() {
  cached = null;
  inflight = null;
}

module.exports = { resolveSfCli, resetSfCliCache };
