import React from 'react';
import { Breadcrumbs as MuiBreadcrumbs, Link, Typography, Box } from '@mui/material';
import { NavigateNext, Home } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Auto-generated breadcrumb navigation component
 * Shows current location in app hierarchy
 */
export default function Breadcrumbs() {
  const navigate = useNavigate();
  const location = useLocation();

  // Parse pathname into segments
  const pathnames = location.pathname.split('/').filter(x => x);

  // Don't show breadcrumbs on home page
  if (pathnames.length === 0) {
    return null;
  }

  // Format path segment for display
  const formatSegment = (segment) => {
    // Remove hyphens and capitalize
    return segment
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <Box sx={{ mb: 2 }}>
      <MuiBreadcrumbs
        separator={<NavigateNext fontSize="small" />}
        aria-label="breadcrumb"
        sx={{ fontSize: '0.875rem' }}
      >
        {/* Home link */}
        <Link
          underline="hover"
          color="inherit"
          onClick={() => navigate('/')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            '&:hover': {
              color: 'primary.main',
            },
          }}
        >
          <Home sx={{ mr: 0.5 }} fontSize="small" />
          Dashboard
        </Link>

        {/* Path segments */}
        {pathnames.map((value, index) => {
          const to = `/${pathnames.slice(0, index + 1).join('/')}`;
          const isLast = index === pathnames.length - 1;

          return isLast ? (
            <Typography
              key={to}
              color="text.primary"
              sx={{ fontSize: '0.875rem', fontWeight: 500 }}
            >
              {formatSegment(value)}
            </Typography>
          ) : (
            <Link
              key={to}
              underline="hover"
              color="inherit"
              onClick={() => navigate(to)}
              sx={{
                cursor: 'pointer',
                fontSize: '0.875rem',
                '&:hover': {
                  color: 'primary.main',
                },
              }}
            >
              {formatSegment(value)}
            </Link>
          );
        })}
      </MuiBreadcrumbs>
    </Box>
  );
}
