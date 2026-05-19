import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Chip,
  Avatar,
  Divider,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Logout,
  Lock,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import NotificationCenter from './NotificationCenter';

const Navbar = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const [userMenuAnchor, setUserMenuAnchor] = React.useState(null);

  const handleUserMenuOpen = (event) => setUserMenuAnchor(event.currentTarget);
  const handleUserMenuClose = () => setUserMenuAnchor(null);

  const handleLogout = () => {
    logout();
    handleUserMenuClose();
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'admin':      return 'error';
      case 'developer':  return 'warning';
      case 'functional': return 'info';
      default:           return 'default';
    }
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: 'background.paper',
        color: 'primary.main',
        top: 0,
        zIndex: (theme) => theme.zIndex.drawer + 1,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Toolbar
        sx={{
          px: { xs: 2, sm: 2.5, md: 2 },
          minHeight: { xs: 56, sm: 64 },
        }}
      >
        {/* Hamburger — mobile/tablet only, toggles the sidebar drawer */}
        <IconButton
          size="large"
          edge="start"
          aria-label="open navigation"
          onClick={onToggleSidebar}
          color="primary"
          sx={{ mr: 1, display: { xs: 'flex', md: 'none' } }}
        >
          <MenuIcon />
        </IconButton>

        {/* Logo + app name */}
        <Box
          component={RouterLink}
          to="/"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            cursor: 'pointer',
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          <Lock sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography
            variant="h6"
            sx={{
              color: 'primary.main',
              fontWeight: 600,
              display: { xs: 'none', sm: 'block' },
              lineHeight: 1,
            }}
          >
            Vlocity DataPack Manager
          </Typography>
        </Box>

        {/* Spacer */}
        <Box sx={{ flexGrow: 1 }} />

        {/* Notifications */}
        <NotificationCenter />

        {/* Role chip */}
        <Chip
          label={user?.role?.toUpperCase()}
          color={getRoleColor(user?.role)}
          size="small"
          variant="outlined"
          sx={{ ml: 1.5 }}
        />

        {/* Profile avatar + dropdown */}
        <IconButton onClick={handleUserMenuOpen} sx={{ p: 0, ml: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 13 }}>
            {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
          </Avatar>
        </IconButton>

        <Menu
          anchorEl={userMenuAnchor}
          open={Boolean(userMenuAnchor)}
          onClose={handleUserMenuClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem disabled>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <Typography variant="subtitle2" fontWeight="bold">
                {user?.firstName} {user?.lastName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user?.email}
              </Typography>
            </Box>
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout}>
            <Logout sx={{ mr: 1 }} />
            Logout
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;
