#!/usr/bin/env node
/**
 * Report whether the Salesforce CLI and Vlocity Build tool are installed.
 * Never fails the install – it only prints guidance. Works on Windows,
 * macOS and Linux (cross-spawn resolves .cmd shims without a shell).
 */
const spawn = require('cross-spawn');

function version(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 30000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : null);
    });
  });
}

(async () => {
  const sf = await version('sf', ['--version']);
  const vlocity = await version('vlocity', ['--version']);
  console.log(`Salesforce CLI : ${sf || 'NOT FOUND  ->  npm install -g @salesforce/cli'}`);
  console.log(`Vlocity Build  : ${vlocity || 'NOT FOUND  ->  npm install -g vlocity'}`);
  if (!sf || !vlocity) {
    console.log('Missing CLI tools are only needed for export/deploy features. Run "npm run install-cli-tools" to install both.');
  }
})();
