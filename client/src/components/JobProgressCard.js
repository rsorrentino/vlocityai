import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  LinearProgress,
  Chip,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  PlayArrow,
  CheckCircle,
  Error,
  Schedule,
  Info,
  Visibility,
  Edit,
  Stop,
  Delete,
} from '@mui/icons-material';


/**
 * Enhanced Job Progress Card Component
 * Shows real-time progress, current operation, and estimated time
 */
const JobProgressCard = ({ job, onViewLogs, onAbort, onEdit, onDelete, isRunning }) => {
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'running':     case 'in_progress': return 'info';
      case 'completed':   case 'success':     return 'success';
      case 'failed':      case 'error':       return 'error';
      case 'pending':     case 'aborted':     return 'warning';
      default: return 'default';
    }
  };

  const getStatusIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'running': return <PlayArrow />;
      case 'completed': return <CheckCircle />;
      case 'failed': return <Error />;
      default: return <Schedule />;
    }
  };

  const getStatusDescription = (status) => {
    switch (status?.toLowerCase()) {
      case 'running': return 'Job is currently executing';
      case 'completed': return 'Job completed successfully';
      case 'failed': return 'Job encountered an error';
      case 'pending': return 'Job is queued and waiting to start';
      case 'aborted': return 'Job was cancelled by user';
      default: return 'Unknown status';
    }
  };

  const formatDuration = (startTime, endTime) => {
    if (!startTime) return 'N/A';
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const diff = Math.floor((end - start) / 1000);
    
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
    return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  };

  const estimateTimeRemaining = (progress, startTime) => {
    if (!progress || progress === 0 || !startTime) return null;
    if (progress >= 100) return 'Almost done';
    
    const elapsed = (new Date() - new Date(startTime)) / 1000; // seconds
    const rate = progress / elapsed; // % per second
    if (rate === 0) return null;
    
    const remaining = (100 - progress) / rate; // seconds
    if (remaining < 60) return `~${Math.ceil(remaining)}s remaining`;
    if (remaining < 3600) return `~${Math.ceil(remaining / 60)}m remaining`;
    return `~${Math.ceil(remaining / 3600)}h remaining`;
  };

  const currentOperation = job.currentOperation || job.statusMessage || 
    (job.status === 'running' ? 'Processing...' : null);

  return (
    <Card variant="outlined" sx={{
      position: 'relative',
      overflow: 'hidden',
      border: isRunning ? '2px solid' : '1px solid',
      borderColor: isRunning ? 'primary.main' : 'divider',
      boxShadow: isRunning ? 3 : 1,
      transition: 'all 0.3s ease',
      // Sweeping shimmer bar along the top edge when running
      ...(isRunning && {
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: '-60%',
          width: '60%',
          height: '3px',
          background: 'linear-gradient(90deg, transparent, #1976d2 40%, #42a5f5 60%, transparent)',
          [`@keyframes shimmerBar`]: {
            '0%':   { left: '-60%' },
            '100%': { left: '110%' },
          },
          animation: 'shimmerBar 1.8s ease-in-out infinite',
        },
      }),
    }}>
      <CardContent>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, mb: 0.5 }}>
              {job.name}
            </Typography>
            {job.cliType && (
              <Chip
                label={job.cliType === 'sf' ? 'SF CLI' : 'Vlocity CLI'}
                size="small"
                variant="outlined"
                sx={{ mr: 1, mb: 1 }}
              />
            )}
          </Box>
          <Tooltip title={getStatusDescription(job.status)} arrow>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 1 }}>
              {isRunning && (
                <Box sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  flexShrink: 0,
                  [`@keyframes liveDot`]: {
                    '0%,100%': { opacity: 1 },
                    '50%':     { opacity: 0.25 },
                  },
                  animation: 'liveDot 1.2s ease-in-out infinite',
                }} />
              )}
              <Chip
                icon={!isRunning ? getStatusIcon(job.status) : undefined}
                label={job.status?.toUpperCase() || 'UNKNOWN'}
                size="small"
                color={getStatusColor(job.status)}
              />
            </Box>
          </Tooltip>
        </Box>

        {/* Current Operation */}
        {currentOperation && (
          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Info fontSize="small" color="primary" />
              <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                <strong>Current:</strong> {currentOperation}
              </Typography>
            </Box>
          </Box>
        )}

        {/* Progress Bar */}
        {isRunning && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Progress
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {job.progress || 0}%
              </Typography>
            </Box>
            <LinearProgress
              variant={isRunning && (!job.progress || job.progress === 0) ? 'indeterminate' : 'determinate'}
              value={job.progress || 0}
              sx={{ height: 8, borderRadius: 4 }}
              color={job.progress >= 90 ? 'success' : 'primary'}
            />
            {job.startTime && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Elapsed: {formatDuration(job.startTime, job.endTime)}
                </Typography>
                {estimateTimeRemaining(job.progress, job.startTime) && (
                  <Typography variant="caption" color="primary.main" fontWeight="medium">
                    {estimateTimeRemaining(job.progress, job.startTime)}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Job Info */}
        <Box sx={{ mb: 2 }}>
          {job.username && (
            <Typography variant="caption" color="text.secondary" display="block">
              Org: {job.username}
            </Typography>
          )}
          {job.createdAt && (
            <Typography variant="caption" color="text.secondary" display="block">
              Created: {new Date(job.createdAt).toLocaleDateString()}
            </Typography>
          )}
          {job.updatedAt && job.updatedAt !== job.createdAt && (
            <Typography variant="caption" color="text.secondary" display="block">
              Updated: {new Date(job.updatedAt).toLocaleDateString()}
            </Typography>
          )}
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {onViewLogs && (
            <Tooltip title="View detailed logs and progress">
              <IconButton
                size="small"
                color="primary"
                onClick={() => onViewLogs(job)}
              >
                <Visibility />
              </IconButton>
            </Tooltip>
          )}
          {onEdit && (
            <Tooltip title="Edit job configuration">
              <IconButton
                size="small"
                onClick={() => onEdit(job)}
              >
                <Edit />
              </IconButton>
            </Tooltip>
          )}
          {isRunning && onAbort && (
            <Tooltip title="Stop this job">
              <IconButton
                size="small"
                color="error"
                onClick={() => onAbort(job)}
              >
                <Stop />
              </IconButton>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip title="Delete this job">
              <IconButton
                size="small"
                color="error"
                onClick={() => onDelete(job)}
              >
                <Delete />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default JobProgressCard;

