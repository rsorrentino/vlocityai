const redis = require('redis');
const { exec } = require('child_process');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this._startAttempted = false;
  }

  // Best-effort: try to start Redis via system service.
  // Uses `sudo -n` (non-interactive) so it fails fast if password is required
  // instead of hanging waiting for input.
  _tryStartRedis() {
    if (this._startAttempted) return Promise.resolve();
    this._startAttempted = true;

    return new Promise(resolve => {
      // Try without sudo first, then with sudo -n (non-interactive, fails fast if pw needed)
      const cmd = 'service redis-server start 2>/dev/null || sudo -n service redis-server start 2>/dev/null';
      exec(cmd, { timeout: 4000 }, (error) => {
        if (error) {
          logger.warn(
            'Redis auto-start skipped — run manually: sudo service redis-server start\n' +
            '  Tip: for passwordless auto-start add to sudoers:\n' +
            '       <user> ALL=(ALL) NOPASSWD: /usr/sbin/service redis-server start'
          );
        } else {
          logger.info('Redis started automatically via service');
        }
        resolve();
      });
    });
  }

  async connect() {
    // Best-effort: try to bring Redis up before connecting
    await this._tryStartRedis();

    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          // redis@4.x reconnect API (replaces the v3 retry_strategy option)
          // Keeps retrying indefinitely with exponential backoff up to 30 s.
          // This means when the user starts Redis, the app reconnects automatically.
          reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 2000, 30000);
            if (retries === 1) {
              logger.warn('Redis not available — caching disabled. App will reconnect automatically when Redis is up.');
            } else if (retries % 10 === 0) {
              logger.warn(`Redis: still reconnecting (attempt ${retries})...`);
            }
            return delay;
          },
        },
      });

      this.client.on('error', (error) => {
        // ECONNREFUSED is expected when Redis is not running — downgrade to warn
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
          // Only log once per connect cycle to avoid log spam
          if (this.isConnected) {
            logger.warn('Redis connection lost — caching disabled until reconnected', { code: error.code });
          }
        } else {
          logger.warn('Redis error', { message: error.message, code: error.code });
        }
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis connected');
        this._startAttempted = false; // reset so auto-start can be tried again if needed
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        logger.info('Redis ready — caching enabled');
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
        // logged by reconnectStrategy already
      });

      this.client.on('end', () => {
        logger.warn('Redis connection ended');
        this.isConnected = false;
      });

      await this.client.connect();

    } catch (error) {
      // Initial connect failed — the reconnectStrategy will keep retrying automatically.
      logger.warn('Redis initial connection failed — caching disabled (will retry in background)', {
        hint: 'Start Redis with: sudo service redis-server start',
      });
      this.isConnected = false;
      // Do NOT throw — Redis is optional, the app works without it
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
        this.isConnected = false;
        logger.info('Redis disconnected');
      }
    } catch (error) {
      logger.warn('Redis disconnect error', { error: error.message });
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.warn('Redis get failed', { key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttl = 3600) {
    if (!this.isConnected) return false;
    try {
      const serialized = JSON.stringify(value);
      if (ttl > 0) {
        await this.client.setEx(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.warn('Redis set failed', { key, error: error.message });
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.warn('Redis delete failed', { key, error: error.message });
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.warn('Redis exists failed', { key, error: error.message });
      return false;
    }
  }

  async flush() {
    if (!this.isConnected) return false;
    try {
      await this.client.flushAll();
      return true;
    } catch (error) {
      logger.warn('Redis flush failed', { error: error.message });
      return false;
    }
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      ready: this.client?.isReady || false,
    };
  }
}

module.exports = new CacheService();
