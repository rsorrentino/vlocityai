import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Chip,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  PlayArrow,
  CheckCircle,
  Error,
  TrendingUp,
  Refresh,
  OpenInNew,
  CloudDownload,
  CloudUpload,
  HourglassEmpty,
  Speed,
} from '@mui/icons-material';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const getStatusColor = (status) => {
  switch (status) {
    case 'completed': case 'success': return 'success';
    case 'failed':    case 'error':   return 'error';
    case 'running':   case 'in_progress': return 'info';
    case 'aborted':   return 'warning';
    default:          return 'default';
  }
};

const getJobTypeIcon = (type) => {
  switch (type) {
    case 'export': return <CloudDownload fontSize="small" />;
    case 'deploy': return <CloudUpload fontSize="small" />;
    default:       return <CloudDownload fontSize="small" />;
  }
};

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    totalJobs: 0,
    runningJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    pendingJobs: 0,
    successRate: 0,
    avgDuration: 0,
  });
  const [recentJobs, setRecentJobs] = useState([]);
  const [orgStats, setOrgStats] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [executionStats, setExecutionStats] = useState(null);

  // Tick every second while any job is running so duration column auto-updates
  useEffect(() => {
    const hasRunning = recentJobs.some(j => j.status === 'running' || j.status === 'in_progress');
    if (!hasRunning) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [recentJobs]);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [exportJobsRes, deployJobsRes, orgsRes, execStatsRes] = await Promise.all([
        axios.get('/api/exports/jobs', { params: { limit: 100 } }),
        axios.get('/api/deploys/jobs', { params: { limit: 100 } }),
        axios.get('/api/orgs/list'),
        axios.get('/api/jobs/execution/status').catch(() => null),
      ]);

      if (execStatsRes?.data) {
        setExecutionStats(execStatsRes.data);
      }

      const exportJobs = (exportJobsRes.data.jobs || []).map(j => ({ ...j, type: j.type || 'export' }));
      const deployJobs = (deployJobsRes.data.jobs || []).map(j => ({ ...j, type: j.type || 'deploy' }));
      const allJobs = [...exportJobs, ...deployJobs];

      const running = allJobs.filter(j => j.status === 'running' || j.status === 'in_progress');
      const completed = allJobs.filter(j => j.status === 'completed');
      const failed = allJobs.filter(j => j.status === 'failed');
      const pending = allJobs.filter(j => j.status === 'pending');

      const successRate = allJobs.length > 0
        ? ((completed.length / (completed.length + failed.length)) * 100).toFixed(1)
        : 0;

      const durations = completed
        .filter(j => j.duration)
        .map(j => j.duration);
      const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

      setStats({
        totalJobs: allJobs.length,
        runningJobs: running.length,
        completedJobs: completed.length,
        failedJobs: failed.length,
        pendingJobs: pending.length,
        successRate: parseFloat(successRate),
        avgDuration,
      });

      // Recent jobs (last 10)
      const recent = allJobs
        .sort((a, b) => {
          const dateA = new Date(a.createdAt || a.modifiedAt || 0);
          const dateB = new Date(b.createdAt || b.modifiedAt || 0);
          return dateB - dateA;
        })
        .slice(0, 10);
      setRecentJobs(recent);

      // Org stats
      const orgs = orgsRes.data.orgs || [];
      const orgStatsData = orgs.map(org => {
        const orgJobs = allJobs.filter(j => j.username === org.username);
        return {
          username: org.username,
          alias: org.alias || org.username,
          totalJobs: orgJobs.length,
          runningJobs: orgJobs.filter(j => j.status === 'running').length,
          completedJobs: orgJobs.filter(j => j.status === 'completed').length,
        };
      });
      setOrgStats(orgStatsData);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, subtitle, icon: Icon, color = 'primary', onClick, pulse }) => (
    <Card
      sx={{
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': onClick ? { transform: 'translateY(-4px)', boxShadow: 4 } : {},
        ...(pulse && {
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
      }}
      onClick={onClick}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box>
            <Typography variant="h4" fontWeight="bold" color={`${color}.main`}>
              {value}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {title}
            </Typography>
            {subtitle && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.25 }}>
                {pulse && (
                  <Box sx={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    flexShrink: 0,
                    [`@keyframes liveDot`]: {
                      '0%,100%': { opacity: 1 },
                      '50%':     { opacity: 0.2 },
                    },
                    animation: 'liveDot 1.2s ease-in-out infinite',
                  }} />
                )}
                <Typography variant="caption" color={pulse ? 'primary.main' : 'text.secondary'} fontWeight={pulse ? 600 : 400}>
                  {subtitle}
                </Typography>
              </Box>
            )}
          </Box>
          {Icon && (
            <Icon sx={{ fontSize: 40, color: `${color}.main`, opacity: 0.3 }} />
          )}
        </Box>
      </CardContent>
    </Card>
  );

  if (loading && stats.totalJobs === 0) {
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <LinearProgress />
        <Typography sx={{ mt: 2, textAlign: 'center' }}>Loading dashboard...</Typography>
      </Box>
    );
  }

  return (
    <Box>
<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Dashboard</Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={fetchDashboardData}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Execution Queue Status */}
      {executionStats && (
        <Card sx={{ mb: 3, border: executionStats.activeCount > 0 ? '1px solid' : undefined, borderColor: 'info.light' }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Speed color={executionStats.activeCount > 0 ? 'info' : 'disabled'} />
                <Typography variant="h6">Execution Queue</Typography>
              </Box>
              <Chip
                size="small"
                label={executionStats.activeCount > 0 ? 'ACTIVE' : 'IDLE'}
                color={executionStats.activeCount > 0 ? 'info' : 'default'}
                variant={executionStats.activeCount > 0 ? 'filled' : 'outlined'}
              />
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Workers</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h5" fontWeight="bold" color="info.main">
                    {executionStats.activeCount}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    / {executionStats.maxConcurrentExecutions} max
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={executionStats.maxConcurrentExecutions > 0
                    ? (executionStats.activeCount / executionStats.maxConcurrentExecutions) * 100
                    : 0}
                  color="info"
                  sx={{ mt: 1, borderRadius: 1, height: 6 }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Queued</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HourglassEmpty color={executionStats.queuedCount > 0 ? 'warning' : 'disabled'} fontSize="small" />
                  <Typography variant="h5" fontWeight="bold" color={executionStats.queuedCount > 0 ? 'warning.main' : 'text.secondary'}>
                    {executionStats.queuedCount}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">waiting</Typography>
                </Box>
              </Grid>
              {(executionStats.activeJobIds?.length > 0 || executionStats.queuedJobIds?.length > 0) && (
                <Grid item xs={12} sm={4}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>Job IDs</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {executionStats.activeJobIds?.map((id) => (
                      <Chip
                        key={id}
                        label={id.slice(0, 8)}
                        size="small"
                        color="info"
                        variant="outlined"
                        title={id}
                        onClick={() => navigate(`/jobs/export/${id}`)}
                        sx={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
                      />
                    ))}
                    {executionStats.queuedJobIds?.map((id) => (
                      <Chip
                        key={id}
                        label={id.slice(0, 8)}
                        size="small"
                        color="warning"
                        variant="outlined"
                        title={id}
                        onClick={() => navigate(`/jobs/export/${id}`)}
                        sx={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
                      />
                    ))}
                  </Box>
                </Grid>
              )}
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Jobs"
            value={stats.totalJobs}
            subtitle={`${stats.runningJobs} running`}
            icon={PlayArrow}
            color="primary"
            onClick={() => navigate('/history')}
            pulse={stats.runningJobs > 0}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Completed"
            value={stats.completedJobs}
            subtitle={`${stats.successRate}% success rate`}
            icon={CheckCircle}
            color="success"
            onClick={() => navigate('/history')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Failed"
            value={stats.failedJobs}
            subtitle="Requires attention"
            icon={Error}
            color="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Avg Duration"
            value={stats.avgDuration > 0 ? `${Math.round(stats.avgDuration / 60)}m` : 'N/A'}
            subtitle="Per job"
            icon={TrendingUp}
            color="info"
          />
        </Grid>
      </Grid>

      {/* Recent Jobs */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent Jobs
          </Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Job Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Org</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recentJobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="text.secondary">No jobs found</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  recentJobs.map((job) => (
                    <TableRow key={job.id || job.name} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {job.name || 'Unnamed Job'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getJobTypeIcon(job.type)}
                          <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                            {job.type || 'export'}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                          {(job.status === 'running' || job.status === 'in_progress') && (
                            <Box sx={{
                              width: 7, height: 7, borderRadius: '50%',
                              bgcolor: 'info.main', flexShrink: 0,
                              [`@keyframes liveDot`]: {
                                '0%,100%': { opacity: 1 },
                                '50%':     { opacity: 0.2 },
                              },
                              animation: 'liveDot 1.2s ease-in-out infinite',
                            }} />
                          )}
                          <Chip
                            label={job.status || 'unknown'}
                            size="small"
                            color={getStatusColor(job.status)}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {job.type === 'deploy'
                            ? job.targetUsername || job.username || 'N/A'
                            : job.sourceUsername || job.username || 'N/A'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {job.startedAt || job.createdAt
                            ? new Date(job.startedAt || job.createdAt).toLocaleString()
                            : 'N/A'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {(() => {
                            const start = job.startedAt || job.createdAt;
                            const isRunning = job.status === 'running' || job.status === 'in_progress';
                            // Use Math.max(now, Date.now()) so stale `now` state never produces negative elapsed time
                            const endMs = job.completedAt
                              ? new Date(job.completedAt).getTime()
                              : isRunning ? Math.max(now, Date.now()) : null;
                            if (!start || endMs === null) return 'N/A';
                            const ms = endMs - new Date(start).getTime();
                            if (ms < 1000) return '< 1s';
                            const totalSecs = Math.floor(ms / 1000);
                            const h = Math.floor(totalSecs / 3600);
                            const m = Math.floor((totalSecs % 3600) / 60);
                            const s = totalSecs % 60;
                            if (h > 0) return `${h}h ${m}m`;
                            if (m > 0) return `${m}m ${s}s`;
                            return `${s}s`;
                          })()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Tooltip title="View job details">
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<OpenInNew />}
                            onClick={() => navigate(`/jobs/${job.type || 'export'}/${job.id || job.name}`)}
                          >
                            View Details
                          </Button>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Organization Stats */}
      {orgStats.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Organization Statistics
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Organization</TableCell>
                    <TableCell align="right">Total Jobs</TableCell>
                    <TableCell align="right">Running</TableCell>
                    <TableCell align="right">Completed</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {orgStats.map((org) => (
                    <TableRow key={org.username} hover>
                      <TableCell>{org.alias}</TableCell>
                      <TableCell align="right">{org.totalJobs}</TableCell>
                      <TableCell align="right">
                        <Chip
                          label={org.runningJobs}
                          size="small"
                          color="info"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Chip
                          label={org.completedJobs}
                          size="small"
                          color="success"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

export default Dashboard;
