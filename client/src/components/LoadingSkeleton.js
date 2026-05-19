import React from 'react';
import { Box, Skeleton, Card, CardContent, Grid } from '@mui/material';

export const TableSkeleton = ({ rows = 5, columns = 4 }) => (
  <Box>
    <Skeleton variant="rectangular" height={56} sx={{ mb: 1 }} />
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} variant="rectangular" height={52} sx={{ mb: 1 }} />
    ))}
  </Box>
);

export const CardSkeleton = ({ count = 3 }) => (
  <Grid container spacing={2}>
    {Array.from({ length: count }).map((_, i) => (
      <Grid item xs={12} sm={6} md={4} key={i}>
        <Card>
          <CardContent>
            <Skeleton variant="text" width="60%" height={32} />
            <Skeleton variant="text" width="40%" height={24} sx={{ mt: 1 }} />
            <Skeleton variant="rectangular" height={100} sx={{ mt: 2 }} />
          </CardContent>
        </Card>
      </Grid>
    ))}
  </Grid>
);

export const ListSkeleton = ({ items = 5 }) => (
  <Box>
    {Array.from({ length: items }).map((_, i) => (
      <Box key={i} sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Skeleton variant="circular" width={40} height={40} sx={{ mr: 2 }} />
        <Box sx={{ flexGrow: 1 }}>
          <Skeleton variant="text" width="60%" height={24} />
          <Skeleton variant="text" width="40%" height={20} />
        </Box>
      </Box>
    ))}
  </Box>
);

export default {
  TableSkeleton,
  CardSkeleton,
  ListSkeleton,
};

