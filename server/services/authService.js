const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { Op } = require('sequelize');
const { ValidationError, UnauthorizedError, NotFoundError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getJwtSecret, getDataDir } = require('../utils/secrets');

class AuthService {
  constructor() {
    // JWT_SECRET is mandatory in production; in development a random secret is
    // generated once and persisted under DATA_DIR (see utils/secrets.js).
    this.jwtSecret = getJwtSecret();
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
    this.bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    this.MAX_LOGIN_ATTEMPTS = 5;
    this.LOCK_TIME = 2 * 60 * 60 * 1000; // 2 hours
  }

  /**
   * Authenticate user login
   */
  async login(credentials) {
    try {
      const { username, password } = credentials;
      if (!username || !password) {
        throw new ValidationError('Username and password are required');
      }

      // Find user by username or email
      const { Op } = require('sequelize');
      const user = await User.findOne({
        where: {
          [Op.or]: [
            { username: username },
            { email: username }
          ],
          isActive: true
        }
      });

      if (!user) {
        throw new UnauthorizedError('Invalid credentials');
      }

      if (user.isLocked) {
        throw new UnauthorizedError(`Account locked. Please try again in ${Math.ceil((user.lockUntil - Date.now()) / (1000 * 60))} minutes.`);
      }

      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        await user.incLoginAttempts();
        logger.warn('Failed login attempt', { username: user.username, attempts: user.loginAttempts });
        if (user.loginAttempts >= this.MAX_LOGIN_ATTEMPTS) {
          throw new UnauthorizedError('Invalid credentials. Account locked due to too many failed attempts.');
        }
        throw new UnauthorizedError('Invalid credentials');
      }

      // Reset login attempts on successful login
      await user.resetLoginAttempts();

      user.lastLogin = new Date();
      await user.save();

      const token = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          permissions: user.permissions
        },
        this.jwtSecret,
        { expiresIn: this.jwtExpiresIn }
      );

      logger.logOperation('User login', { username: user.username, role: user.role });

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          lastLogin: user.lastLogin,
          permissions: user.permissions
        },
        token,
        expiresIn: this.jwtExpiresIn
      };
    } catch (error) {
      logger.logError(error, { operation: 'login', username: credentials.username });
      throw error;
    }
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      return decoded;
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedError('Invalid token');
      } else if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Token expired');
      }
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    try {
      const user = await User.findByPk(userId, {
        attributes: { exclude: ['password'] }
      });
      
      if (!user) {
        throw new NotFoundError('User not found');
      }

      return user;
    } catch (error) {
      logger.logError(error, { operation: 'getUserById', userId });
      throw error;
    }
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    try {
      const users = await User.findAll({
        attributes: { exclude: ['password'] },
        order: [['createdAt', 'DESC']]
      });
      return users;
    } catch (error) {
      logger.logError(error, { operation: 'getAllUsers' });
      throw error;
    }
  }

  /**
   * Create a new user (admin only)
   */
  async createUser(userData) {
    try {
      const requiredFields = ['username', 'email', 'password', 'firstName', 'lastName'];
      for (const field of requiredFields) {
        if (!userData[field]) {
          throw new ValidationError(`${field} is required`);
        }
      }

      const existingUser = await User.findOne({
        where: {
          [Op.or]: [
            { username: userData.username },
            { email: userData.email }
          ]
        }
      });

      if (existingUser) {
        throw new ValidationError('User with this username or email already exists');
      }

      const hashedPassword = await bcrypt.hash(userData.password, this.bcryptRounds);

      const user = await User.create({
        username: userData.username,
        email: userData.email,
        password: hashedPassword,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role || 'functional',
        isActive: userData.isActive !== undefined ? userData.isActive : true,
        permissions: userData.permissions || this.getRolePermissions(userData.role || 'functional')
      });

      logger.logOperation('User created', { userId: user.id, username: user.username, role: user.role });
      return this.sanitizeUser(user);
    } catch (error) {
      logger.logError(error, { operation: 'createUser', userData });
      throw error;
    }
  }

  /**
   * Update user (admin or self)
   */
  /**
   * @param {string} userId
   * @param {object} updateData
   * @param {{privileged?: boolean}} [opts] privileged=true (admin user management)
   *   may change role/isActive; self-service profile updates may not.
   */
  async updateUser(userId, updateData, { privileged = false } = {}) {
    try {
      const allowedFields = privileged
        ? ['firstName', 'lastName', 'email', 'role', 'isActive', 'preferences']
        : ['firstName', 'lastName', 'email', 'preferences'];
      const filteredData = {};

      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
          filteredData[key] = updateData[key];
        }
      });

      if (filteredData.email) {
        const existingEmail = await User.findOne({
          where: {
            email: filteredData.email,
            id: { [Op.ne]: userId }
          }
        });
        if (existingEmail) {
          throw new ValidationError('Email is already in use by another user');
        }
      }

      const user = await User.findByPk(userId);
      if (!user) {
        throw new ValidationError('User not found');
      }

      const losesAdmin = user.role === 'admin' && user.isActive !== false
        && ((filteredData.role && filteredData.role !== 'admin') || filteredData.isActive === false);
      if (losesAdmin && await this.countActiveAdmins() <= 1) {
        throw new ValidationError('Cannot remove the last active administrator');
      }

      Object.assign(user, filteredData);

      if (filteredData.role && !updateData.permissions) {
        user.permissions = this.getRolePermissions(filteredData.role);
      }

      await user.save();
      require('../middleware/accessPolicy').clearAccessCache(user.id);

      logger.logOperation('User updated', { userId: user.id, username: user.username, updatedFields: Object.keys(filteredData) });
      return this.sanitizeUser(user);
    } catch (error) {
      logger.logError(error, { operation: 'updateUser', userId, fields: Object.keys(updateData || {}) });
      throw error;
    }
  }

  /**
   * Change password
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new ValidationError('User not found');
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        throw new UnauthorizedError('Current password is incorrect');
      }

      user.password = await bcrypt.hash(newPassword, this.bcryptRounds);
      await user.save();

      logger.logOperation('Password changed', { userId: user.id, username: user.username });
    } catch (error) {
      logger.logError(error, { operation: 'changePassword', userId });
      throw error;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new ValidationError('User not found');
      }

      if (user.role === 'admin' && user.isActive !== false && await this.countActiveAdmins() <= 1) {
        throw new ValidationError('Cannot delete the last active administrator');
      }
      await user.destroy();
      require('../middleware/accessPolicy').clearAccessCache(user.id);
      logger.logOperation('User deleted', { userId, username: user.username });
    } catch (error) {
      logger.logError(error, { operation: 'deleteUser', userId });
      throw error;
    }
  }

  /**
   * Reset password (admin)
   */
  async resetPassword(userId, newPassword) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new ValidationError('User not found');
      }

      user.password = await bcrypt.hash(newPassword, this.bcryptRounds);
      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      logger.logOperation('Password reset', { userId: user.id, username: user.username });
    } catch (error) {
      logger.logError(error, { operation: 'resetPassword', userId });
      throw error;
    }
  }

  async countActiveAdmins() {
    return User.count({ where: { role: 'admin', isActive: true } });
  }

  /**
   * Get role permissions map
   */
  getRolePermissions(role = 'functional') {
    const rolePermissions = {
      admin: [
        { resource: 'users', actions: ['read', 'write', 'delete'] },
        { resource: 'jobs', actions: ['read', 'write', 'delete', 'execute'] },
        { resource: 'orgs', actions: ['read', 'write', 'delete'] },
        { resource: 'configs', actions: ['read', 'write', 'delete'] },
        { resource: 'pricing', actions: ['read', 'write', 'delete'] },
        { resource: 'promotions', actions: ['read', 'write', 'delete', 'execute'] },
        { resource: 'system', actions: ['read', 'write'] },
        { resource: 'logs', actions: ['read', 'write', 'delete'] },
        { resource: 'analytics', actions: ['read', 'write'] }
      ],
      developer: [
        { resource: 'jobs', actions: ['read', 'write', 'execute'] },
        { resource: 'orgs', actions: ['read', 'write'] },
        { resource: 'configs', actions: ['read', 'write'] },
        { resource: 'pricing', actions: ['read', 'write'] },
        { resource: 'promotions', actions: ['read', 'write', 'execute'] },
        { resource: 'system', actions: ['read'] },
        { resource: 'logs', actions: ['read'] },
        { resource: 'analytics', actions: ['read'] }
      ],
      functional: [
        { resource: 'jobs', actions: ['read', 'execute'] },
        { resource: 'orgs', actions: ['read'] },
        { resource: 'configs', actions: ['read'] },
        { resource: 'pricing', actions: ['read', 'write'] },
        { resource: 'promotions', actions: ['read', 'write', 'execute'] },
        { resource: 'analytics', actions: ['read'] }
      ]
    };

    return rolePermissions[role] || rolePermissions.functional;
  }

  sanitizeUser(user) {
    if (!user) return null;
    const plain = user.toJSON ? user.toJSON() : { ...user };
    delete plain.password;
    return plain;
  }

  /**
   * Check if user has permission
   */
  async checkPermission(userId, resource, action) {
    try {
      const user = await User.findByPk(userId);
      
      if (!user || !user.isActive) {
        return false;
      }

      return user.hasPermission(resource, action);
    } catch (error) {
      logger.logError(error, { operation: 'checkPermission', userId, resource, action });
      return false;
    }
  }

  /**
   * Create default users if they don't exist
   */
  /**
   * Make sure an administrator exists.
   *
   * On a fresh database a single admin account is created from
   * ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD. When ADMIN_PASSWORD is not
   * set, a random password is generated and written to
   * <DATA_DIR>/initial-admin-password.txt (and printed once in development).
   * No well-known passwords are ever created.
   */
  async ensureAdminUser() {
    const userCount = await User.count();
    if (userCount > 0) {
      await this.warnOnLegacyDefaultPasswords();
      return { created: false };
    }

    const username = process.env.ADMIN_USERNAME || 'admin';
    const email = process.env.ADMIN_EMAIL || 'admin@example.com';
    let password = process.env.ADMIN_PASSWORD;
    let generated = false;

    if (password) {
      const problems = this.validatePasswordStrength(password);
      if (problems.length) {
        throw new Error(`ADMIN_PASSWORD is too weak: ${problems.join(', ')}`);
      }
    } else {
      password = this.generatePassword();
      generated = true;
    }

    const hashedPassword = await bcrypt.hash(password, this.bcryptRounds);
    await User.create({
      username,
      email,
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'admin',
    });

    if (generated) {
      const dir = getDataDir();
      const file = path.join(dir, 'initial-admin-password.txt');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        file,
        `username: ${username}\npassword: ${password}\n\nChange this password after the first login and delete this file.\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
      logger.warn(`Created initial admin user "${username}". Generated password saved to ${file}`);
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log(`\n  Initial admin credentials  ->  ${username} / ${password}\n  (also saved to ${file})\n`);
      }
    } else {
      logger.info(`Created initial admin user "${username}" from ADMIN_PASSWORD`);
    }

    return { created: true, username, generated };
  }

  /**
   * Older versions seeded admin/developer/functional with published passwords.
   * Log a loud warning if any of them is still in use.
   */
  async warnOnLegacyDefaultPasswords() {
    const legacy = { admin: 'Admin123!', developer: 'Dev123!', functional: 'Func123!' };
    try {
      const users = await User.findAll({ where: { username: Object.keys(legacy) } });
      for (const u of users) {
        if (u.password && await bcrypt.compare(legacy[u.username], u.password)) {
          logger.warn(`SECURITY: user "${u.username}" still uses the old published default password. Change it now.`);
        }
      }
    } catch (error) {
      logger.debug ? logger.debug('Legacy password check skipped', { error: error.message }) : null;
    }
  }

  validatePasswordStrength(password) {
    const problems = [];
    if (!password || password.length < 12) problems.push('at least 12 characters');
    if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
    if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
    if (!/[0-9]/.test(password)) problems.push('a digit');
    return problems;
  }

  generatePassword() {
    // 18 random bytes -> 24 base64url chars; append fixed classes to satisfy policy
    return `${crypto.randomBytes(18).toString('base64url')}Aa1`;
  }

  /** @deprecated kept for backwards compatibility – use ensureAdminUser() */
  async createDefaultUsers() {
    return this.ensureAdminUser();
  }
}

module.exports = new AuthService();
