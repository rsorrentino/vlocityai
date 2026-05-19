const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { Op } = require('sequelize');
const { ValidationError, UnauthorizedError, NotFoundError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

class AuthService {
  constructor() {
    // Require JWT_SECRET in production - fail fast if not set
    if (!process.env.JWT_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('CRITICAL: JWT_SECRET environment variable must be set in production');
      }
      logger.warn('WARNING: Using fallback JWT secret - NOT SAFE FOR PRODUCTION');
    }
    this.jwtSecret = process.env.JWT_SECRET || 'fallback-dev-secret-DO-NOT-USE-IN-PRODUCTION';
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
  async updateUser(userId, updateData) {
    try {
      const allowedFields = ['firstName', 'lastName', 'email', 'role', 'isActive', 'preferences'];
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

      Object.assign(user, filteredData);

      if (filteredData.role && !updateData.permissions) {
        user.permissions = this.getRolePermissions(filteredData.role);
      }

      await user.save();

      logger.logOperation('User updated', { userId: user.id, username: user.username, updatedFields: Object.keys(filteredData) });
      return this.sanitizeUser(user);
    } catch (error) {
      logger.logError(error, { operation: 'updateUser', userId, updateData });
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

      await user.destroy();
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
  async createDefaultUsers() {
    try {
      const defaultUsers = [
        {
          username: 'admin',
          email: 'admin@amplifon.com',
          password: 'Admin123!',
          firstName: 'System',
          lastName: 'Administrator',
          role: 'admin'
        },
        {
          username: 'developer',
          email: 'developer@amplifon.com',
          password: 'Dev123!',
          firstName: 'John',
          lastName: 'Developer',
          role: 'developer'
        },
        {
          username: 'functional',
          email: 'functional@amplifon.com',
          password: 'Func123!',
          firstName: 'Jane',
          lastName: 'Functional',
          role: 'functional'
        }
      ];

      for (const userData of defaultUsers) {
        const existingUser = await User.findOne({
          where: { username: userData.username }
        });

        if (!existingUser) {
          const hashedPassword = await bcrypt.hash(userData.password, this.bcryptRounds);
          await User.create({
            ...userData,
            password: hashedPassword
          });
          logger.info(`Created default user: ${userData.username}`);
        }
      }

      logger.info('✅ Default users created/verified');
    } catch (error) {
      logger.logError(error, { operation: 'createDefaultUsers' });
      throw error;
    }
  }
}

module.exports = new AuthService();
