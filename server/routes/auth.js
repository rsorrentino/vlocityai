const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { authenticate, adminOnly, requirePermission } = require('../middleware/auth');
const authService = require('../services/authService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     operationId: login
 *     summary: Login user
 *     description: Authenticate user with username and password. Sets an httpOnly auth_token cookie.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Admin123!
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       description: JWT token
 *       400:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw new ValidationError('Username and password are required');
  }

  const result = await authService.login({ username, password });

  // Set JWT in an httpOnly cookie so it is not accessible via JavaScript
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('auth_token', result.token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours in ms
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: { user: result.user, expiresIn: result.expiresIn },
  });
}));

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     operationId: getAuthMe
 *     summary: Get current user
 *     description: Returns the authenticated user's profile information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.userId);
  
  res.json({
    success: true,
    data: user
  });
}));

/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     operationId: changePassword
 *     summary: Change password
 *     description: Change the authenticated user's password
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Password changed successfully
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ValidationError('Current password and new password are required');
  }

  await authService.changePassword(req.userId, currentPassword, newPassword);
  
  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

/**
 * @swagger
 * /api/auth/profile:
 *   put:
 *     operationId: updateProfile
 *     summary: Update profile
 *     description: Update the authenticated user's profile fields
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/profile', authenticate, asyncHandler(async (req, res) => {
  const user = await authService.updateUser(req.userId, req.body);
  
  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: user
  });
}));

/**
 * @swagger
 * /api/auth/users:
 *   get:
 *     operationId: getAllUsers
 *     summary: List all users
 *     description: Returns all users in the system. Admin only.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/users', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const users = await authService.getAllUsers();
  
  res.json({
    success: true,
    data: users
  });
}));

/**
 * @swagger
 * /api/auth/users:
 *   post:
 *     operationId: createUser
 *     summary: Create user
 *     description: Create a new application user. Admin only.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, developer, functional]
 *                 default: functional
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/users', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { username, email, password, firstName, lastName, role } = req.body;

  if (!username || !email || !password || !firstName || !lastName) {
    throw new ValidationError('Username, email, password, first name, and last name are required');
  }

  const user = await authService.createUser({
    username,
    email,
    password,
    firstName,
    lastName,
    role: role || 'functional'
  });
  
  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: user
  });
}));

/**
 * @swagger
 * /api/auth/users/{userId}:
 *   put:
 *     operationId: updateUser
 *     summary: Update user
 *     description: Update an existing user's details. Admin only.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [admin, developer, functional]
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/users/:userId', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const user = await authService.updateUser(userId, req.body);
  
  res.json({
    success: true,
    message: 'User updated successfully',
    data: user
  });
}));

/**
 * @swagger
 * /api/auth/users/{userId}:
 *   delete:
 *     operationId: deleteUser
 *     summary: Delete user
 *     description: Permanently delete a user. Admin only.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/users/:userId', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  await authService.deleteUser(userId);
  
  res.json({
    success: true,
    message: 'User deleted successfully'
  });
}));

/**
 * @swagger
 * /api/auth/users/{userId}/reset-password:
 *   post:
 *     operationId: resetUserPassword
 *     summary: Reset user password
 *     description: Admin resets another user's password.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/users/:userId/reset-password', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    throw new ValidationError('New password is required');
  }

  await authService.resetPassword(userId, newPassword);
  
  res.json({
    success: true,
    message: 'Password reset successfully'
  });
}));

/**
 * @swagger
 * /api/auth/permissions:
 *   get:
 *     operationId: getPermissions
 *     summary: Get user permissions
 *     description: Returns the permission set for the authenticated user's role
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User role and permissions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                     permissions:
 *                       type: object
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/permissions', authenticate, asyncHandler(async (req, res) => {
  const permissions = authService.getRolePermissions(req.user.role);
  
  res.json({
    success: true,
    data: {
      role: req.user.role,
      permissions
    }
  });
}));

/**
 * @swagger
 * /api/auth/check-permission/{resource}/{action}:
 *   get:
 *     operationId: checkPermission
 *     summary: Check permission
 *     description: Check whether the authenticated user has a specific permission
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: resource
 *         required: true
 *         schema:
 *           type: string
 *         description: Resource name (e.g. jobs, users)
 *       - in: path
 *         name: action
 *         required: true
 *         schema:
 *           type: string
 *         description: Action name (e.g. read, write, delete)
 *     responses:
 *       200:
 *         description: Permission check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     resource:
 *                       type: string
 *                     action:
 *                       type: string
 *                     hasPermission:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/check-permission/:resource/:action', authenticate, asyncHandler(async (req, res) => {
  const { resource, action } = req.params;
  const hasPermission = await authService.checkPermission(req.userId, resource, action);
  
  res.json({
    success: true,
    data: {
      resource,
      action,
      hasPermission
    }
  });
}));

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     operationId: logout
 *     summary: Logout
 *     description: Clears the auth_token cookie and ends the session
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Logout successful
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  logger.logOperation('User logout', { userId: req.userId, username: req.user.username });

  res.clearCookie('auth_token', { httpOnly: true, sameSite: 'strict' });

  res.json({
    success: true,
    message: 'Logout successful'
  });
}));

/**
 * @swagger
 * /api/auth/status:
 *   get:
 *     operationId: getAuthStatus
 *     summary: Authentication status
 *     description: Returns the current state of the authentication system (public endpoint)
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200:
 *         description: Auth system status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     authenticated:
 *                       type: boolean
 *                     message:
 *                       type: string
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     roles:
 *                       type: array
 *                       items:
 *                         type: string
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/status', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      authenticated: false,
      message: 'Authentication system is active',
      timestamp: new Date().toISOString(),
      roles: ['admin', 'developer', 'functional']
    }
  });
}));

module.exports = router;