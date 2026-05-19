import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute = ({ children, requiredRole, requiredPermission }) => {
  const { user, isAuthenticated, loading, hasPermission, hasRole } = useAuth();

  if (loading) {
    return (
      <Box 
        display="flex" 
        flexDirection="column" 
        alignItems="center" 
        justifyContent="center" 
        minHeight="50vh"
      >
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Loading...
        </Typography>
      </Box>
    );
  }

  // Redirect to login if not authenticated or user object is missing
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: window.location.pathname }} />;
  }

  // Check role requirement
  if (requiredRole && !hasRole(requiredRole)) {
    return (
      <Box 
        display="flex" 
        flexDirection="column" 
        alignItems="center" 
        justifyContent="center" 
        minHeight="50vh"
      >
        <Typography variant="h4" color="error" gutterBottom>
          Access Denied
        </Typography>
        <Typography variant="body1" color="text.secondary">
          You don't have permission to access this page.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Required role: {Array.isArray(requiredRole) ? requiredRole.join(' or ') : requiredRole}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your role: {user?.role}
        </Typography>
      </Box>
    );
  }

  // Check permission requirement
  if (requiredPermission && !hasPermission(requiredPermission.resource, requiredPermission.action)) {
    return (
      <Box 
        display="flex" 
        flexDirection="column" 
        alignItems="center" 
        justifyContent="center" 
        minHeight="50vh"
      >
        <Typography variant="h4" color="error" gutterBottom>
          Access Denied
        </Typography>
        <Typography variant="body1" color="text.secondary">
          You don't have permission to access this page.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Required permission: {requiredPermission.action} on {requiredPermission.resource}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your role: {user?.role}
        </Typography>
      </Box>
    );
  }

  return children;
};

export default ProtectedRoute;
