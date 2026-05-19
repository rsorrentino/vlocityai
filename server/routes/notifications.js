const express = require('express');
const router = express.Router();
const { asyncHandler, NotFoundError } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     operationId: getNotifications
 *     summary: Get notifications for the current user
 *     description: Returns the most recent notifications for the authenticated user along with the total unread count. The result list is limited by the optional `limit` query parameter.
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 50
 *         description: Maximum number of notifications to return
 *         example: 50
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 notifications:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Notification'
 *                 unreadCount:
 *                   type: integer
 *                   description: Total number of unread notifications for this user
 *                   example: 3
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
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const limit = parseInt(req.query.limit) || 50;
  const notifications = notificationService.getForUser(userId, limit);
  const unreadCount = notificationService.getUnreadCount(userId);
  res.json({ success: true, notifications, unreadCount });
}));

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   put:
 *     operationId: markNotificationRead
 *     summary: Mark a single notification as read
 *     description: Marks the specified notification as read. The notification must belong to the authenticated user.
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification ID
 *         example: notif_xyz789
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Notification not found
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
router.put('/:id/read', asyncHandler(async (req, res) => {
  const found = notificationService.markRead(req.params.id);
  if (!found) throw new NotFoundError('Notification not found');
  res.json({ success: true });
}));

/**
 * @swagger
 * /api/notifications/read-all:
 *   put:
 *     operationId: markAllNotificationsRead
 *     summary: Mark all notifications as read
 *     description: Marks every unread notification belonging to the authenticated user as read in a single operation.
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
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
router.put('/read-all', asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  notificationService.markAllRead(userId);
  res.json({ success: true });
}));

module.exports = router;
