/**
 * Cross-platform, shell-free process runner.
 *
 * Every external CLI call (sf, sfdx, vlocity, npm, npx, pg_dump, ...) must go
 * through this module instead of `child_process.spawn(..., { shell: true })`.
 *
 * Why:
 *  - `shell: true` concatenates arguments into a single shell string, so any
 *    user-controlled value (org alias, username, file name) becomes a command
 *    injection vector.
 *  - On Windows the Salesforce / Vlocity / npm CLIs are `.cmd` shims, which
 *    Node refuses to spawn without a shell (CVE-2024-27980). `cross-spawn`
 *    resolves the shim through PATH/PATHEXT and escapes every argument for
 *    cmd.exe, so the same call works on Windows, Linux and macOS without
 *    exposing a shell.
 */
const crossSpawn = require('cross-spawn');

const isWindows = process.platform === 'win32';

/**
 * Spawn a process without a shell.
 * Accepts the same options as child_process.spawn, except `shell`, which is
 * always forced to false.
 *
 * @param {string} command  executable name or path (e.g. 'sf', 'vlocity')
 * @param {string[]} args   argument vector – never pre-quoted
 * @param {object} options  child_process.spawn options
 * @returns {import('child_process').ChildProcess}
 */
function spawnSafe(command, args = [], options = {}) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new TypeError('spawnSafe: command must be a non-empty string');
  }
  if (!Array.isArray(args)) {
    throw new TypeError('spawnSafe: args must be an array');
  }
  const safeArgs = args
    .filter((a) => a !== undefined && a !== null)
    .map((a) => String(a));

  // eslint-disable-next-line no-unused-vars
  const { shell, ...rest } = options;
  return crossSpawn(command, safeArgs, { windowsHide: true, ...rest, shell: false });
}

/**
 * Run a command to completion and collect its output.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {number} [options.timeout]        kill the process after N ms
 * @param {string} [options.input]          data written to stdin
 * @param {boolean} [options.rejectOnError] reject on non-zero exit (default false)
 * @returns {Promise<{code:number|null, stdout:string, stderr:string, timedOut:boolean}>}
 */
function runCommand(command, args = [], options = {}) {
  const { timeout, input, rejectOnError = false, ...spawnOptions } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnSafe(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...spawnOptions });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer = null;

    if (timeout && timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeout);
      if (timer.unref) timer.unref();
    }

    child.stdout && child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr && child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const result = { code, stdout, stderr, timedOut };
      if (rejectOnError && (code !== 0 || timedOut)) {
        const err = new Error(
          timedOut
            ? `${command} timed out after ${timeout}ms`
            : `${command} exited with code ${code}: ${stderr.trim() || stdout.trim()}`.slice(0, 2000)
        );
        Object.assign(err, result);
        reject(err);
        return;
      }
      resolve(result);
    });

    if (child.stdin) {
      if (input !== undefined) child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/**
 * Check whether a command can be executed (exit code 0 for `<cmd> --version`).
 * @param {string} command
 * @param {string[]} [args]
 * @param {number} [timeout]
 * @returns {Promise<boolean>}
 */
async function commandAvailable(command, args = ['--version'], timeout = 15000) {
  try {
    const { code } = await runCommand(command, args, { timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Kill a process and (on Windows) its whole process tree.
 * @param {import('child_process').ChildProcess} child
 * @param {string} [signal]
 */
function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.killed) return;
  if (isWindows && child.pid) {
    try {
      // taskkill is a real .exe – safe to spawn directly without a shell.
      require('child_process').spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return;
    } catch {
      /* fall through to child.kill */
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
}

/**
 * Format a command for logging/display only. NEVER pass the result to a shell.
 * @param {string} command
 * @param {string[]} args
 */
function formatCommand(command, args = []) {
  return [command, ...args]
    .map((a) => {
      const s = String(a);
      return /[\s"'`$&|;<>()]/.test(s) ? JSON.stringify(s) : s;
    })
    .join(' ');
}

module.exports = {
  spawnSafe,
  runCommand,
  commandAvailable,
  killTree,
  formatCommand,
  isWindows,
};
