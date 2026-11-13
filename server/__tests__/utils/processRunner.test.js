const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCommand, spawnSafe, commandAvailable, formatCommand } = require('../../utils/processRunner');

const isWindows = process.platform === 'win32';

// Arguments that would be dangerous if they ever reached a shell.
const NASTY_ARGS = [
  'plain',
  'with space',
  'semi; echo INJECTED',
  'amp & echo INJECTED',
  'pipe | echo INJECTED',
  '$(echo INJECTED)',
  '`echo INJECTED`',
  '%PATH%',
  '"double" \'single\'',
  "SELECT Id, Name FROM Product2 WHERE Name = 'A, B' AND Code != null",
  '<redirect> >out',
  '^caret!bang',
];

describe('processRunner', () => {
  let tmpDir;
  let echoScript;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
    echoScript = path.join(tmpDir, 'echo-args.js');
    fs.writeFileSync(echoScript, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes every argument verbatim to an executable (no shell)', async () => {
    const { code, stdout } = await runCommand(process.execPath, [echoScript, ...NASTY_ARGS]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(NASTY_ARGS);
  });

  it('passes arguments verbatim through a CLI shim (.cmd on Windows, sh script elsewhere)', async () => {
    // npm-installed CLIs (sf, sfdx, vlocity) are .cmd shims on Windows – the
    // case where naive spawning needs shell:true and becomes injectable.
    let shim;
    if (isWindows) {
      shim = path.join(tmpDir, 'echo-shim.cmd');
      fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${echoScript}" %*\r\n`);
    } else {
      shim = path.join(tmpDir, 'echo-shim');
      fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${echoScript}" "$@"\n`, { mode: 0o755 });
    }
    // Windows cmd.exe cannot carry %VAR% or ^/! unescaped through a .cmd
    // file; cross-spawn escapes them. Skip only the entries cmd.exe itself
    // rewrites inside batch files (%PATH% expansion is a cmd.exe feature).
    const args = isWindows ? NASTY_ARGS.filter((a) => !a.includes('%')) : NASTY_ARGS;
    const { code, stdout, stderr } = await runCommand(shim, args);
    expect(stderr).not.toMatch(/INJECTED/);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(args);
    expect(stdout).not.toMatch(/^INJECTED/m);
  });

  it('ignores a caller-supplied shell option', () => {
    const child = spawnSafe(process.execPath, ['-e', ''], { shell: true, stdio: 'ignore' });
    expect(child.spawnargs[0]).not.toMatch(/(^|[\\/])(sh|bash|cmd(\.exe)?)$/i);
    return new Promise((resolve) => child.on('close', resolve));
  });

  it('rejects non-array args and empty commands', () => {
    expect(() => spawnSafe('', [])).toThrow(TypeError);
    expect(() => spawnSafe('node', 'a b')).toThrow(TypeError);
  });

  it('reports a missing executable as an error, not a crash', async () => {
    await expect(runCommand('definitely-not-a-real-binary-xyz', [])).rejects.toThrow();
    await expect(commandAvailable('definitely-not-a-real-binary-xyz')).resolves.toBe(false);
  });

  it('detects an available command', async () => {
    await expect(commandAvailable(process.execPath, ['--version'])).resolves.toBe(true);
  });

  it('times out long-running commands', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { timeout: 300 });
    expect(result.timedOut).toBe(true);
  });

  it('rejectOnError rejects on non-zero exit', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'process.stderr.write("bad"); process.exit(3)'], { rejectOnError: true })
    ).rejects.toThrow(/exited with code 3: bad/);
  });

  it('writes stdin input', async () => {
    const { stdout } = await runCommand(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hello' });
    expect(stdout).toBe('hello');
  });

  it('formats commands for display only', () => {
    expect(formatCommand('sf', ['data', 'query', '--query', 'SELECT Id FROM A'])).toBe('sf data query --query "SELECT Id FROM A"');
  });
});
