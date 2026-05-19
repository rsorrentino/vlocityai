const net = require('net');
const { spawn } = require('child_process');

const NPM_CMD = 'npm';
const DEFAULT_BACKEND_PORT = parseInt(process.env.PORT, 10) || 3001;
const DEFAULT_FRONTEND_PORT = parseInt(process.env.CLIENT_PORT, 10) || 3000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const canConnect = (port, host) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (isOpen) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(isOpen);
    };

    socket.setTimeout(250);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));

    socket.connect(port, host);
  });
};

const isPortInUseOnLocalhost = async (port) => {
  const [ipv4Open, ipv6Open] = await Promise.all([
    canConnect(port, '127.0.0.1'),
    canConnect(port, '::1'),
  ]);

  return ipv4Open || ipv6Open;
};

const isPortAvailable = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '0.0.0.0');
  });
};

const findFreePort = async (startPort, reservedPorts = new Set()) => {
  let port = Number(startPort);

  while (port < 65535) {
    if (!reservedPorts.has(port)) {
      if (await isPortInUseOnLocalhost(port)) {
        port += 1;
        continue;
      }

      // Retry quickly to reduce transient race conditions.
      if (await isPortAvailable(port)) {
        await wait(10);
        if (await isPortAvailable(port)) {
          return port;
        }
      }
    }
    port += 1;
  }

  throw new Error(`Unable to find a free port starting from ${startPort}`);
};

const spawnProcess = (args, env, cwd = process.cwd()) => {
  return spawn(NPM_CMD, args, {
    cwd,
    stdio: 'inherit',
    env,
    // In Git Bash/WSL-hosted terminals on Windows, direct spawn of npm.cmd can fail with EINVAL.
    // shell:true delegates command resolution to the active shell and avoids that portability issue.
    shell: true,
  });
};

const run = async () => {
  const backendPort = await findFreePort(DEFAULT_BACKEND_PORT);
  const frontendPort = await findFreePort(DEFAULT_FRONTEND_PORT, new Set([backendPort]));

  console.log(`Using backend port ${backendPort} and frontend port ${frontendPort}`);
  console.log(`Frontend URL: http://localhost:${frontendPort}`);
  console.log(`Backend URL: http://localhost:${backendPort}`);

  const backendEnv = {
    ...process.env,
    PORT: String(backendPort),
    CLIENT_PORT: String(frontendPort),
  };

  const frontendEnv = {
    ...process.env,
    PORT: String(frontendPort),
    REACT_APP_API_PORT: String(backendPort),
    REACT_APP_WS_PORT: String(backendPort),
    REACT_APP_API_URL: `http://localhost:${backendPort}`,
    WDS_SOCKET_HOST: 'localhost',
    WDS_SOCKET_PORT: String(frontendPort),
    WDS_SOCKET_PATH: '/ws',
  };

  const backend = spawnProcess(['run', 'dev'], backendEnv, process.cwd());
  const frontend = spawnProcess(['start'], frontendEnv, require('path').join(process.cwd(), 'client'));

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (backend && !backend.killed) {
      backend.kill(signal);
    }
    if (frontend && !frontend.killed) {
      frontend.kill(signal);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  backend.on('exit', (code) => {
    if (shuttingDown) {
      process.exit(code || 0);
      return;
    }

    shutdown('SIGTERM');
    process.exit(code || 1);
  });

  frontend.on('exit', (code) => {
    if (shuttingDown) {
      process.exit(code || 0);
      return;
    }

    shutdown('SIGTERM');
    process.exit(code || 1);
  });
};

run().catch((error) => {
  console.error('Failed to start development mode with auto ports:', error.message);
  process.exit(1);
});
