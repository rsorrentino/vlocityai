import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
  Tooltip,
  Button,
  TablePagination,
} from '@mui/material';
import {
  Refresh,
  CloudDownload,
  CloudUpload,
  OpenInNew,
} from '@mui/icons-material';
import axios from 'axios';

const JobHistory = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalJobs, setTotalJobs] = useState(0);
  const [now, setNow] = useState(Date.now());

  const fetchJobHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.append('type', filter);
      }
      params.append('limit', rowsPerPage.toString());
      params.append('offset', (page * rowsPerPage).toString());
      
      const response = await axios.get(`/api/jobs/history?${params.toString()}`);
      setJobs(response.data.jobs || []);
      setTotalJobs(response.data.total || 0);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, page, rowsPerPage]);

  useEffect(() => {
    fetchJobHistory();
  }, [fetchJobHistory]);

  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'running' || j.status === 'in_progress');
    if (!hasRunning) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [jobs]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
      case 'success':
        return 'success';
      case 'failed':
      case 'error':
        return 'error';
      case 'running':
      case 'in_progress':
        return 'info';
      case 'aborted':
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getJobTypeIcon = (type) => {
    switch (type) {
      case 'export':
        return <CloudDownload />;
      case 'deploy':
        return <CloudUpload />;
      default:
        return <CloudDownload />;
    }
  };

  const formatDuration = (startTime, endTime, status) => {
    if (!startTime) return 'N/A';

    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : (status === 'running' || status === 'in_progress' ? new Date(now) : null);
    if (!end) return 'N/A';

    const duration = end - start;

    if (duration < 1000) return '< 1s';
    const totalSecs = Math.floor(duration / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  const handleViewJobDetails = (job) => {
    // Navigate to the job details page
    // For job history, we have UUID-based jobs, so use the id
    // For export/deploy jobs, we have name-based jobs
    const jobIdentifier = job.id || job.name || job.jobName;
    navigate(`/jobs/${job.type}/${jobIdentifier}`);
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Job History
        </Typography>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading job history...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Job History
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Filter</InputLabel>
            <Select
              value={filter}
              label="Filter"
              onChange={(e) => setFilter(e.target.value)}
            >
              <MenuItem value="all">All Jobs</MenuItem>
              <MenuItem value="export">Export Jobs</MenuItem>
              <MenuItem value="deploy">Deploy Jobs</MenuItem>
            </Select>
          </FormControl>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchJobHistory}>
              <Refresh />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {jobs.length === 0 ? (
        <Card>
          <CardContent>
            <Alert severity="info">
              No job history found. Jobs will appear here after you run export or deploy operations.
            </Alert>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Recent Jobs ({jobs.length})
            </Typography>
            <TableContainer component={Paper} variant="outlined">
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
                  {jobs.map((job) => (
                    <TableRow key={job.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {job.name || job.jobName || 'Unnamed Job'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getJobTypeIcon(job.type)}
                          <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                            {job.type || 'Unknown'}
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
                            label={job.status || 'Unknown'}
                            color={getStatusColor(job.status)}
                            size="small"
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
                          {formatTimestamp(job.timestamp || job.startedAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDuration(job.startedAt, job.completedAt, job.status)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Tooltip title="View Job Details">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<OpenInNew />}
                              onClick={() => handleViewJobDetails(job)}
                            >
                              View Details
                            </Button>
                          </Tooltip>
                          {job.message && (
                            <Tooltip title={job.message}>
                              <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {job.message}
                              </Typography>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                rowsPerPageOptions={[10, 25, 50, 100]}
                component="div"
                count={totalJobs}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
                labelRowsPerPage="Jobs per page:"
                labelDisplayedRows={({ from, to, count }) => 
                  `${from}-${to} of ${count !== -1 ? count : `more than ${to}`}`
                }
              />
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default JobHistory;
