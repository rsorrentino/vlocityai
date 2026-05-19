import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  Button,
  Grid,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  Divider,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Badge,
} from '@mui/material';
import {
  PlayArrow,
  Refresh,
  Visibility,
  ExpandMore,
  CheckCircle,
  Error,
  Warning,
  Info,
  Schedule,
} from '@mui/icons-material';

const RealTimeJobMonitor = () => {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activeJobs, setActiveJobs] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [error, setError] = useState(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const wsRef = useRef(null);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
      setWs(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectWebSocket = React.useCallback(() => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        setWs(null);
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/jobs`;

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          // Silently handle parse errors
        }
      };

      websocket.onclose = () => {
        setConnected(false);
        setWs(null);

        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);

          reconnectTimeoutRef.current = setTimeout(() => {
            if (reconnectTimeoutRef.current) {
              connectWebSocket();
            }
          }, delay);
        } else {
          setError('Unable to connect to job monitoring service. Please refresh the page.');
        }
      };

      websocket.onerror = () => {
        setError('Connection error. Attempting to reconnect...');
      };

      setWs(websocket);
      wsRef.current = websocket;
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setError('Failed to connect to job monitoring service');
    }
  }, [ws]);

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'initial_status':
        setActiveJobs(data.data.activeJobs || []);
        setRecentJobs(data.data.recentJobs || []);
        break;
      case 'job_started':
        setActiveJobs(prev => [data.data, ...prev]);
        break;
      case 'job_progress':
        setActiveJobs(prev =>
          prev.map(job =>
            job.id === data.jobId
              ? { ...job, progress: data.data.progress, logs: [...job.logs, ...data.data.logs] }
              : job
          )
        );
        break;
      case 'job_log':
        setActiveJobs(prev =>
          prev.map(job =>
            job.id === data.jobId
              ? { ...job, logs: [...job.logs, data.data] }
              : job
          )
        );
        break;
      case 'job_error':
        setActiveJobs(prev =>
          prev.map(job =>
            job.id === data.jobId
              ? { ...job, errors: [...job.errors, data.data], logs: [...job.logs, data.data] }
              : job
          )
        );
        break;
      case 'job_completed':
        setActiveJobs(prev => prev.filter(job => job.id !== data.data.id));
        setRecentJobs(prev => [data.data, ...prev.slice(0, 9)]);
        break;
      case 'job_added_to_history':
        setRecentJobs(prev => [data.data, ...prev.slice(0, 9)]);
        break;
      default:
        break;
    }
  };

  const subscribeToJob = (jobId) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe_job', jobId }));
    }
  };

  const unsubscribeFromJob = (jobId) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe_job', jobId }));
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'running':  return <PlayArrow color="primary" />;
      case 'completed': return <CheckCircle color="success" />;
      case 'failed':   return <Error color="error" />;
      case 'pending':  return <Schedule color="warning" />;
      default:         return <Info color="info" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'running':   return 'primary';
      case 'completed': return 'success';
      case 'failed':    return 'error';
      case 'pending':   return 'warning';
      default:          return 'default';
    }
  };

  const formatDuration = (startTime, endTime) => {
    if (!startTime) return 'N/A';
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const duration = end - start;
    if (duration < 1000) return '< 1s';
    if (duration < 60000) return `${Math.round(duration / 1000)}s`;
    if (duration < 3600000) return `${Math.round(duration / 60000)}m`;
    return `${Math.round(duration / 3600000)}h`;
  };

  const openJobDetails = (job) => {
    setSelectedJob(job);
    setViewDialog(true);
    subscribeToJob(job.id);
  };

  const closeJobDetails = () => {
    if (selectedJob) unsubscribeFromJob(selectedJob.id);
    setViewDialog(false);
    setSelectedJob(null);
  };

  const getLogIcon = (level) => {
    switch (level) {
      case 'error': return <Error color="error" />;
      case 'warn':  return <Warning color="warning" />;
      default:      return <Info color="info" />;
    }
  };

  // Shared live-dot keyframes object
  const liveDotSx = (color = 'primary.main') => ({
    width: 8, height: 8, borderRadius: '50%',
    bgcolor: color, flexShrink: 0,
    [`@keyframes liveDot`]: {
      '0%,100%': { opacity: 1 },
      '50%':     { opacity: 0.2 },
    },
    animation: 'liveDot 1.2s ease-in-out infinite',
  });

  // Shimmer bar via ::before
  const shimmerCardSx = {
    position: 'relative',
    overflow: 'hidden',
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0, left: '-60%',
      width: '60%', height: '3px',
      background: 'linear-gradient(90deg, transparent, #1976d2 40%, #42a5f5 60%, transparent)',
      [`@keyframes shimmerBar`]: {
        '0%':   { left: '-60%' },
        '100%': { left: '110%' },
      },
      animation: 'shimmerBar 1.8s ease-in-out infinite',
    },
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Real-time Job Monitor</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {/* Live dot next to connected chip */}
          {connected && <Box sx={liveDotSx('success.main')} />}
          <Chip
            label={connected ? 'Connected' : 'Disconnected'}
            color={connected ? 'success' : 'error'}
            icon={connected ? <CheckCircle /> : <Error />}
          />
          <Tooltip title="Reconnect">
            <span>
              <IconButton onClick={connectWebSocket} disabled={connected}>
                <Refresh />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Active Jobs */}
        <Grid item xs={12} md={6}>
          <Card sx={activeJobs.length > 0 ? shimmerCardSx : {}}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                {activeJobs.length > 0 && <Box sx={liveDotSx()} />}
                <Badge badgeContent={activeJobs.length} color="primary">
                  <Typography variant="h6">Active Jobs</Typography>
                </Badge>
              </Box>

              {activeJobs.length === 0 ? (
                <Alert severity="info">
                  No active jobs. Jobs will appear here when they start running.
                </Alert>
              ) : (
                <List disablePadding>
                  {activeJobs.map((job) => (
                    <React.Fragment key={job.id}>
                      <ListItem
                        sx={{
                          borderLeft: '3px solid',
                          borderColor: 'primary.main',
                          pl: 1.5,
                          mb: 0.5,
                          borderRadius: '0 4px 4px 0',
                          bgcolor: 'action.hover',
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          {getStatusIcon(job.status)}
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <Box sx={liveDotSx()} />
                              <Typography variant="body2" fontWeight={600} noWrap>
                                {job.name}
                              </Typography>
                            </Box>
                          }
                          secondary={
                            <Box sx={{ mt: 0.5 }}>
                              <Typography variant="caption" color="text.secondary">
                                {job.type} • {job.username} • {formatDuration(job.startTime)}
                              </Typography>
                              <LinearProgress
                                variant={!job.progress || job.progress === 0 ? 'indeterminate' : 'determinate'}
                                value={job.progress || 0}
                                sx={{ mt: 0.75, mb: 0.5, height: 6, borderRadius: 3 }}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {job.progress || 0}% complete
                              </Typography>
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          <Tooltip title="View Details">
                            <IconButton size="small" onClick={() => openJobDetails(job)}>
                              <Visibility fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </ListItemSecondaryAction>
                      </ListItem>
                      <Divider sx={{ my: 0.5 }} />
                    </React.Fragment>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Jobs */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Jobs
              </Typography>

              {recentJobs.length === 0 ? (
                <Alert severity="info">
                  No recent jobs. Completed jobs will appear here.
                </Alert>
              ) : (
                <List disablePadding>
                  {recentJobs.map((job) => (
                    <React.Fragment key={job.id}>
                      <ListItem sx={{ pl: 0 }}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          {getStatusIcon(job.status)}
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Typography variant="body2" fontWeight={600} noWrap>
                              {job.name}
                            </Typography>
                          }
                          secondary={
                            <Box sx={{ mt: 0.5 }}>
                              <Typography variant="caption" color="text.secondary" display="block">
                                {job.type} • {job.username} • {formatDuration(job.startTime, job.endTime)}
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.5 }}>
                                {(job.status === 'running' || job.status === 'in_progress') && (
                                  <Box sx={liveDotSx('primary.main')} />
                                )}
                                <Chip
                                  label={job.status}
                                  color={getStatusColor(job.status)}
                                  size="small"
                                />
                              </Box>
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          <Tooltip title="View Details">
                            <IconButton size="small" onClick={() => openJobDetails(job)}>
                              <Visibility fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </ListItemSecondaryAction>
                      </ListItem>
                      <Divider sx={{ my: 0.5 }} />
                    </React.Fragment>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Job Details Dialog */}
      <Dialog open={viewDialog} onClose={closeJobDetails} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ flexGrow: 1 }}>Job Details: {selectedJob?.name}</Box>
          {selectedJob?.status === 'running' && <Box sx={liveDotSx()} />}
          <Chip
            label={selectedJob?.status}
            color={getStatusColor(selectedJob?.status)}
            size="small"
          />
        </DialogTitle>
        <DialogContent>
          {selectedJob && (
            <Box>
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Type</Typography>
                  <Typography variant="body1">{selectedJob.type}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Username</Typography>
                  <Typography variant="body1">{selectedJob.username}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Started</Typography>
                  <Typography variant="body1">
                    {new Date(selectedJob.startTime).toLocaleString()}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Duration</Typography>
                  <Typography variant="body1">
                    {formatDuration(selectedJob.startTime, selectedJob.endTime)}
                  </Typography>
                </Grid>
              </Grid>

              {selectedJob.status === 'running' && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" gutterBottom>Progress</Typography>
                  <LinearProgress
                    variant={!selectedJob.progress || selectedJob.progress === 0 ? 'indeterminate' : 'determinate'}
                    value={selectedJob.progress || 0}
                    sx={{ mb: 1, height: 8, borderRadius: 4 }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {selectedJob.progress || 0}% complete
                  </Typography>
                </Box>
              )}

              {selectedJob.logs && selectedJob.logs.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="h6">Logs ({selectedJob.logs.length})</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Paper variant="outlined" sx={{ maxHeight: 300, overflow: 'auto' }}>
                      <List dense>
                        {selectedJob.logs.map((log, index) => (
                          <ListItem key={index}>
                            <ListItemIcon>{getLogIcon(log.level)}</ListItemIcon>
                            <ListItemText
                              primary={log.message}
                              secondary={new Date(log.timestamp).toLocaleString()}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Paper>
                  </AccordionDetails>
                </Accordion>
              )}

              {selectedJob.errors && selectedJob.errors.length > 0 && (
                <Accordion sx={{ mt: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="h6" color="error">
                      Errors ({selectedJob.errors.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Paper variant="outlined" sx={{ maxHeight: 300, overflow: 'auto' }}>
                      <List dense>
                        {selectedJob.errors.map((error, index) => (
                          <ListItem key={index}>
                            <ListItemIcon><Error color="error" /></ListItemIcon>
                            <ListItemText
                              primary={error.message}
                              secondary={new Date(error.timestamp).toLocaleString()}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Paper>
                  </AccordionDetails>
                </Accordion>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeJobDetails}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RealTimeJobMonitor;
