import React from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
} from '@mui/material';
import {
  CloudUpload,
  CloudDownload,
  AccountTree,
  History,
  Settings,
  Build,
  Code,
  Monitor,
  Science,
  Dashboard as DashboardIcon,
  AdminPanelSettings,
  Description,
  Assessment,
  CompareArrows,
  Inventory2,
  MoveDown,
  HealthAndSafety,
  Chat as ChatIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const DRAWER_WIDTH = 240;

const navigationGroups = [
  {
    label: 'AI',
    items: [
      { label: 'Chat', path: '/chat', icon: <ChatIcon fontSize="small" /> },
    ],
  },
  {
    label: 'Jobs',
    items: [
      { label: 'Dashboard',    path: '/',        icon: <DashboardIcon fontSize="small" /> },
      { label: 'Export Jobs',  path: '/exports', icon: <CloudDownload fontSize="small" /> },
      { label: 'Deploy Jobs',  path: '/deploys', icon: <CloudUpload fontSize="small" /> },
      { label: 'Job History',  path: '/history', icon: <History fontSize="small" /> },
      { label: 'Job Monitor',  path: '/monitor', icon: <Monitor fontSize="small" /> },
    ],
  },
  {
    label: 'Management',
    items: [
      { label: 'Org Management',   path: '/orgs',              icon: <AccountTree fontSize="small" /> },
      { label: 'Vlocity Commands', path: '/vlocity-commands',  icon: <Code fontSize="small" /> },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { label: 'Catalog Manager',  path: '/catalog',          icon: <Inventory2 fontSize="small" /> },
      { label: 'Service Creation', path: '/service-creation', icon: <Build fontSize="small" /> },
      { label: 'Env Comparison',   path: '/env-comparison',   icon: <CompareArrows fontSize="small" /> },
      { label: 'Data Migration',   path: '/sfdmu',            icon: <MoveDown fontSize="small" /> },
    ],
  },
  {
    label: 'Quality',
    items: [
      { label: 'Validation',    path: '/validation',   icon: <Assessment fontSize="small" /> },
      { label: 'Export Health', path: '/export-health', icon: <HealthAndSafety fontSize="small" /> },
      { label: 'Config Tester', path: '/tester',        icon: <Science fontSize="small" /> },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { label: 'YAML Configs', path: '/yaml',     icon: <Code fontSize="small" /> },
      { label: 'Pipelines',    path: '/pipeline', icon: <AccountTree fontSize="small" /> },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings',        path: '/settings', icon: <Settings fontSize="small" /> },
      { label: 'User Management', path: '/users',    icon: <AdminPanelSettings fontSize="small" /> },
      { label: 'Audit Logs',      path: '/audit',    icon: <Description fontSize="small" /> },
      { label: 'API Docs',        path: '/api-docs', icon: <Description fontSize="small" />, external: true },
    ],
  },
];

const permissionFilter = (item, hasPermission) => {
  switch (item.path) {
    case '/chat':
      return true;
    case '/settings':
    case '/users':
    case '/audit':
      return hasPermission('users', 'read');
    case '/vlocity-commands':
    case '/tester':
      return hasPermission('system', 'read');
    case '/exports':
    case '/deploys':
    case '/history':
    case '/monitor':
      return hasPermission('jobs', 'read');
    case '/orgs':
      return hasPermission('orgs', 'read');
    case '/yaml':
    case '/catalog':
    case '/sfdmu':
    case '/validation':
    case '/env-comparison':
    case '/export-health':
    case '/pipeline':
    case '/service-creation':
      return hasPermission('configs', 'read');
    default:
      return true;
  }
};

const Sidebar = ({ open, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = useAuth();

  const filteredGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => permissionFilter(item, hasPermission)),
    }))
    .filter((group) => group.items.length > 0);

  const handleNavigate = (item) => {
    if (item.external) {
      window.open(item.path, '_blank', 'noopener,noreferrer');
    } else {
      navigate(item.path);
    }
    onClose();
  };

  const drawerContent = (
    <Box sx={{ overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Spacer so content sits below the AppBar */}
      <Toolbar sx={{ minHeight: { xs: 56, sm: 64 } }} />

      <Box sx={{ flexGrow: 1, pb: 2 }}>
        {filteredGroups.map((group, index) => (
          <React.Fragment key={group.label}>
            {index > 0 && <Divider sx={{ my: 0.5, mx: 1 }} />}
            <Typography
              variant="caption"
              sx={{
                px: 2,
                pt: index === 0 ? 1.5 : 1,
                pb: 0.5,
                display: 'block',
                color: 'text.disabled',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontSize: '0.65rem',
              }}
            >
              {group.label}
            </Typography>

            <List dense disablePadding>
              {group.items.map((item) => {
                const isActive =
                  !item.external &&
                  (item.path === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.path));

                return (
                  <ListItem key={item.path} disablePadding>
                    <ListItemButton
                      selected={isActive}
                      onClick={() => handleNavigate(item)}
                      sx={{
                        px: 2,
                        py: 0.65,
                        mx: 0.5,
                        borderRadius: 1,
                        '&.Mui-selected': {
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                          '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                          '&:hover': { bgcolor: 'primary.dark' },
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 30, color: 'text.secondary' }}>
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{ fontSize: '0.85rem' }}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );

  const paperSx = {
    boxSizing: 'border-box',
    width: DRAWER_WIDTH,
    backgroundColor: 'background.paper',
    borderRight: '1px solid',
    borderColor: 'divider',
  };

  return (
    <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
      {/* Mobile — temporary, toggled by hamburger */}
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': paperSx,
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop — permanent, always visible */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': paperSx,
        }}
        open
      >
        {drawerContent}
      </Drawer>
    </Box>
  );
};

export default Sidebar;
