import React, { useState, useEffect, useCallback } from 'react';
import {
  Badge, IconButton, Popover, Box, Typography, List, ListItem,
  ListItemText, Button, Divider, Chip, Tooltip, CircularProgress
} from '@mui/material';
import { Notifications, NotificationsNone, FiberManualRecord, OpenInNew } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const typeColor = (type) => {
  if (type.includes('failed')) return 'error';
  if (type.includes('warning')) return 'warning';
  if (type.includes('awaiting_approval')) return 'warning';
  if (type.includes('completed')) return 'success';
  return 'info';
};

const NotificationCenter = ({ ws }) => {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/notifications');
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (_) {
      // Silently ignore — backend may not have notifications yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Listen for real-time notification events from the shared WebSocket
  useEffect(() => {
    if (!ws) return;
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'notification' && msg.data) {
          setNotifications(prev => [msg.data, ...prev].slice(0, 50));
          setUnreadCount(prev => prev + 1);
        }
      } catch (_) {}
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws]);

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
    fetchNotifications();
  };

  const handleClose = () => setAnchorEl(null);

  const handleMarkAllRead = async () => {
    try {
      await axios.put('/api/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (_) {}
  };

  const handleNotificationClick = async (notification) => {
    // Mark as read
    if (!notification.read) {
      try {
        await axios.put(`/api/notifications/${notification.id}/read`);
        setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (_) {}
    }
    // Navigate to related resource
    if (notification.relatedUrl) {
      handleClose();
      navigate(notification.relatedUrl);
    }
  };

  const open = Boolean(anchorEl);

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={handleOpen} color="inherit">
          <Badge badgeContent={unreadCount} color="error" max={99}>
            {unreadCount > 0 ? <Notifications /> : <NotificationsNone />}
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 380, maxHeight: 520 } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle1" fontWeight="bold">Notifications</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {loading && <CircularProgress size={16} />}
            {unreadCount > 0 && (
              <Button size="small" onClick={handleMarkAllRead}>Mark all read</Button>
            )}
          </Box>
        </Box>
        <Divider />

        {notifications.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <NotificationsNone sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">No notifications</Typography>
          </Box>
        ) : (
          <List dense sx={{ overflow: 'auto', maxHeight: 400, p: 0 }}>
            {notifications.map((n, i) => (
              <React.Fragment key={n.id}>
                <ListItem
                  alignItems="flex-start"
                  sx={{
                    cursor: n.relatedUrl ? 'pointer' : 'default',
                    bgcolor: n.read ? 'transparent' : 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' }
                  }}
                  onClick={() => handleNotificationClick(n)}
                >
                  <Box sx={{ mr: 1, mt: 0.5 }}>
                    <FiberManualRecord
                      fontSize="small"
                      sx={{ color: n.read ? 'transparent' : `${typeColor(n.type)}.main`, fontSize: 10 }}
                    />
                  </Box>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" fontWeight={n.read ? 'normal' : 'bold'} flex={1}>
                          {n.title}
                        </Typography>
                        {n.relatedUrl && <OpenInNew fontSize="small" sx={{ color: 'text.secondary', fontSize: 14 }} />}
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {n.message}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          <Chip
                            label={n.type.replace(/_/g, ' ')}
                            size="small"
                            color={typeColor(n.type)}
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem' }}
                          />
                          <Typography variant="caption" color="text.disabled">
                            {n.createdAt ? new Date(n.createdAt).toLocaleTimeString() : ''}
                          </Typography>
                        </Box>
                      </Box>
                    }
                  />
                </ListItem>
                {i < notifications.length - 1 && <Divider component="li" />}
              </React.Fragment>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
};

export default NotificationCenter;
