import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  Delete,
  Edit,
  KeyboardArrowDown,
  KeyboardArrowRight,
  PlayArrow,
  Refresh,
  Remove,
  Search,
  Stop,
  Visibility,
} from '@mui/icons-material';
import axios from 'axios';
import JobProgressCard from '../components/JobProgressCard';
import ConfirmDialog from '../components/ConfirmDialog';
import PreflightCheckDialog from '../components/PreflightCheckDialog';

const DeployJobs = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [jobs, setJobs] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalJobs, setTotalJobs] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [runningJobs, setRunningJobs] = useState(new Set());
  const [jobStatuses, setJobStatuses] = useState(new Map()); // Track job statuses with details
  const [wsConnected, setWsConnected] = useState(false);
  const [wsReconnectTick, setWsReconnectTick] = useState(0);
  const runningJobsRef = useRef(new Set());
  const wsRef = useRef(null);

  // Keep refs in sync with state
  useEffect(() => { runningJobsRef.current = runningJobs; }, [runningJobs]);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    severity: 'warning',
    onConfirm: null,
  });

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({});

  // Loading states for actions
  const [creatingJob, setCreatingJob] = useState(false);
  const [runningJob, setRunningJob] = useState(false);

  // Preflight state (D3)
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightResult, setPreflightResult] = useState(null);

  // Post-deploy validation toggle (D4)
  const [runPostValidation, setRunPostValidation] = useState(false);

  // Sequential deployment toggle
  const [useSequentialDeploy, setUseSequentialDeploy] = useState(false);

  // Bulk operations state
  const [selectedJobs, setSelectedJobs] = useState(new Set());
  const [expandedJobId, setExpandedJobId] = useState(null);

  const [newJob, setNewJob] = useState({
    name: '',
    projectPath: './export',
    cliType: 'vlocity', // Default to vlocity
    queries: [],
    sourceUsername: '',
    targetUsername: '',
    attempts: 3,
    prealignSettings: false,
    deployFromExportFolder: false,
  });
  const [discoveredFolders, setDiscoveredFolders] = useState([]);
  const [discoveringFolders, setDiscoveringFolders] = useState(false);

  const [runJob, setRunJob] = useState({
    targetUsername: '',
    jobFilePath: '',
    cliType: 'vlocity', // Default to vlocity
    deployCommand: 'packDeploy', // Default deploy command: packDeploy, packContinue, packRetry
    attempts: 3,         // kept for backward compat
    maxRetries: 10,      // max packContinue iterations in smart retry
    prealignSettings: false,
    useDependencyOrder: true,
    stopOnNoProgress: true,
  });

  const fetchData = useCallback(async (pageNum = 0, append = false) => {
    try {
      if (!append) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      
      const [jobsResponse, orgsResponse] = await Promise.all([
        axios.get('/api/deploys/jobs', {
          params: {
            page: pageNum + 1,
            limit: rowsPerPage
          }
        }),
        axios.get('/api/orgs/list'),
      ]);

      const fetchedJobs = jobsResponse.data.jobs || [];
      const total = jobsResponse.data.total || fetchedJobs.length;
      const hasMoreData = jobsResponse.data.hasMore || false;
      
      if (append) {
        setJobs(prev => [...prev, ...fetchedJobs]);
      } else {
        setJobs(fetchedJobs);
      }
      
      setTotalJobs(total);
      setHasMore(hasMoreData);
      setOrgs(orgsResponse.data.orgs || []);

      // Update job statuses map with latest data
      setJobStatuses(prev => {
        const newMap = new Map(prev);
        fetchedJobs.forEach(job => {
          if (job.id || job.name) {
            const key = job.id || job.name;
            newMap.set(key, {
              ...job,
              progress: job.progress || (job.status === 'running' ? 0 : (job.status === 'completed' ? 100 : null)),
              currentOperation: job.currentOperation || job.statusMessage,
            });
          }
        });
        return newMap;
      });

      // Check if any running jobs have completed and remove them from running state
      if (runningJobsRef.current.size > 0) {
        setRunningJobs(prev => {
          const newSet = new Set(prev);
          // Remove jobs that are no longer running
          for (const jobName of prev) {
            const job = fetchedJobs.find(j => (j.name || j.id) === jobName);
            if (!job || (job.status !== 'running' && job.status !== 'pending')) {
              newSet.delete(jobName);
            }
          }
          return newSet;
        });
      }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [rowsPerPage]);
  
  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchData(nextPage, true);
    }
  }, [page, hasMore, loadingMore, fetchData]);
  
  const handlePageChange = useCallback((event, newPage) => {
    setPage(newPage);
    fetchData(newPage, false);
  }, [fetchData]);
  
  const handleRowsPerPageChange = useCallback((event) => {
    const newRowsPerPage = parseInt(event.target.value, 10);
    setRowsPerPage(newRowsPerPage);
    setPage(0);
    fetchData(0, false);
  }, [fetchData]);

  const handleEditJob = useCallback(async (job) => {
    try {
      // If job comes from navigation state, it might already have the config
      // Otherwise, fetch it from the API
      let jobConfig = job.configuration || job.config;
      
      if (!jobConfig) {
        // Fetch the job details
        const jobIdentifier = job.name || job.id;
        const response = await axios.get(`/api/deploys/jobs/${encodeURIComponent(jobIdentifier)}`);
        const jobDetails = response.data;
        jobConfig = jobDetails.config || jobDetails.configuration;
      }
      
      // Ensure cliType is set from job configuration or default to vlocity
      const jobCliType = job.cliType || jobConfig?.cliType || 'vlocity';
      
      // Set the job data for editing
      setNewJob({
        ...jobConfig,
        name: (job.name || job.id || '').replace('.yaml', ''),
        cliType: jobCliType, // Ensure cliType is set
      });
      
      setSelectedJob(job);
      setEditDialogOpen(true);
    } catch (err) {
      console.error('Error in handleEditJob:', err);
      setError(err.response?.data?.error?.message || err.message);
    }
  }, []);

  const handleReconnectWebSocket = useCallback(() => {
    setError(null);
    setWsConnected(false);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    wsRef.current = null;
    setWsReconnectTick(prev => prev + 1);
  }, []);

  // WebSocket connection for real-time job updates
  useEffect(() => {
    let isMounted = true;
    let websocket = null;
    
    const connectWebSocket = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/jobs`;
        
        websocket = new WebSocket(wsUrl);
        
        websocket.onopen = () => {
          if (isMounted) {
            setWsConnected(true);
          }
        };
        
        websocket.onmessage = (event) => {
          if (!isMounted) return;
          
          try {
            const data = JSON.parse(event.data);
            
            // Handle job updates
            if (data.type === 'job_update' || data.type === 'job_progress' || data.type === 'job_log') {
              const jobId = data.jobId || data.data?.id || data.data?.jobId;
              const jobName = data.data?.name || data.data?.jobName;
              
              if (jobId || jobName) {
                setJobStatuses(prev => {
                  const newMap = new Map(prev);
                  const key = jobId || jobName;
                  const existing = newMap.get(key) || {};
                  
                  newMap.set(key, {
                    ...existing,
                    ...data.data,
                    progress: data.data?.progress !== undefined ? data.data.progress : existing.progress,
                    currentOperation: data.data?.currentOperation || data.data?.statusMessage || existing.currentOperation,
                    status: data.data?.status || existing.status,
                  });
                  
                  return newMap;
                });
                
                // Update running jobs set
                if (data.data?.status === 'running' || data.data?.status === 'pending') {
                  setRunningJobs(prev => new Set([...prev, jobId || jobName]));
                } else if (data.data?.status === 'completed' || data.data?.status === 'failed' || data.data?.status === 'aborted') {
                  setRunningJobs(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(jobId || jobName);
                    return newSet;
                  });
                }
              }
            }
          } catch (error) {
            // Silently handle parse errors
          }
        };
        
        websocket.onerror = () => {
          // Silently handle errors - will fall back to polling
          if (isMounted) {
            setWsConnected(false);
          }
        };
        
        websocket.onclose = () => {
          if (isMounted) {
            setWsConnected(false);
          }
          wsRef.current = null;
          if (isMounted) {
            // Attempt to reconnect after delay
            setTimeout(() => {
              if (isMounted) {
                connectWebSocket();
              }
            }, 3000);
          }
        };
        
        wsRef.current = websocket;
      } catch (error) {
        // Silently handle connection errors - will fall back to polling
      }
    };
    
    connectWebSocket();
    
    return () => {
      isMounted = false;
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, [wsReconnectTick]);
  
  useEffect(() => {
    let isMounted = true;
    let abortController = new AbortController();
    
    // Fetch data with abort controller
    const fetchDataSafely = async () => {
      try {
        await fetchData();
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          // Silently handle errors
        }
      }
    };
    
    fetchDataSafely();
    
    // Check if we're navigating from JobDetails with an editJob in state
    if (location.state?.editJob) {
      const editJob = location.state.editJob;
      // Use the job from navigation state to open edit dialog
      handleEditJob(editJob).catch(err => {
        if (isMounted) {
          setError('Failed to load job for editing: ' + err.message);
        }
      });
      // Clear the state to avoid re-triggering
      navigate(location.pathname, { replace: true, state: {} });
    }
    
    // Fallback polling for job status updates when there are running jobs (if WebSocket fails)
    const pollInterval = setInterval(() => {
      if (isMounted && runningJobsRef.current.size > 0 && !wsRef.current) {
        fetchDataSafely(); // Refresh job list to check for completed jobs
      }
    }, 10000); // Poll every 10 seconds (less frequent since WebSocket handles real-time)
    
    return () => {
      isMounted = false;
      abortController.abort();
      clearInterval(pollInterval);
    };
  }, [location.state, location.pathname, navigate, handleEditJob, fetchData]);

  const handleCreateJob = async () => {
    setCreatingJob(true);
    try {
      // Prepare job config - if deploying from export folder, queries will be auto-discovered
      const jobConfig = {
        ...newJob,
        cliType: newJob.cliType || 'vlocity',
        // If deploying from export folder, send empty queries or omit queries
        queries: newJob.deployFromExportFolder ? [] : newJob.queries,
      };
      await axios.post('/api/deploys/create-job', jobConfig);
      setCreateDialogOpen(false);
      setNewJob({
        name: '',
        projectPath: './export',
        cliType: 'vlocity',
        queries: [],
        sourceUsername: '',
        targetUsername: '',
        attempts: 3,
        prealignSettings: false,
        deployFromExportFolder: false,
      });
      setDiscoveredFolders([]);
      fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingJob(false);
    }
  };

  const handleRunJob = async () => {
    setRunningJob(true);
    try {
      setRunningJobs(prev => new Set([...prev, selectedJob.name]));

      // Start the deploy job asynchronously
      // Get CLI type from job configuration or use default
      const jobCliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || 'vlocity';

      // Ensure jobConfig includes cliType
      const jobConfigWithCliType = {
        ...selectedJob?.configuration,
        cliType: jobCliType
      };

      // ── Sequential deployment (strict 27-step order) ──────────────────────
      if (useSequentialDeploy) {
        const projectPath = selectedJob?.configuration?.projectPath || selectedJob?.projectPath;
        axios.post('/api/deploys/sequential', {
          targetUsername: runJob.targetUsername,
          projectPath,
          baseJobConfig: { ...jobConfigWithCliType },
          continueOnError: true,
        }).catch(err => {
          console.error('Sequential deploy failed:', err);
          setError(err.response?.data?.error?.message || err.message);
          setRunningJobs(prev => { const s = new Set(prev); s.delete(selectedJob.name); return s; });
        });
      } else {
        // ── Standard deployment ──────────────────────────────────────────────
        axios.post('/api/deploys/run', {
          targetUsername: runJob.targetUsername,
          jobFilePath: selectedJob.path,
          jobConfig: { ...jobConfigWithCliType, runPostValidation },
          cliType: jobCliType,
          deployCommand: jobCliType === 'vlocity' ? (runJob.deployCommand || selectedJob?.configuration?.deployCommand || 'packDeploy') : null,
          attempts: runJob.maxRetries,  // backward compat alias
          maxRetries: runJob.maxRetries,
          prealignSettings: runJob.prealignSettings,
          useDependencyOrder: jobCliType === 'vlocity' ? runJob.useDependencyOrder : false,
          stopOnNoProgress: runJob.stopOnNoProgress,
          runPostValidation,
        }).catch(err => {
          // Handle errors in the background
          console.error('Deploy job failed:', err);
          setError(err.response?.data?.error?.message || err.message);
          // Remove from running jobs on error
          setRunningJobs(prev => {
            const newSet = new Set(prev);
            newSet.delete(selectedJob.name);
            return newSet;
          });
        });
      }
      
      // Immediately close the dialog and reset state
      setRunDialogOpen(false);
      setRunJob({ targetUsername: '', jobFilePath: '', cliType: 'vlocity', deployCommand: 'packDeploy', attempts: 3, maxRetries: 10, prealignSettings: false, useDependencyOrder: true, stopOnNoProgress: true });
      setUseSequentialDeploy(false);
      setSelectedJob(null);
      
      // Show success message
      setError(null);
      setSuccess(`Deploy job "${selectedJob.name}" started successfully! You can monitor its progress below.`);
      
      // Auto-clear success message after 5 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 5000);

    } catch (err) {
      setError(err.message);
      // Remove from running jobs on error
      setRunningJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedJob.name);
        return newSet;
      });
    } finally {
      setRunningJob(false);
    }
  };

  // D3: Run preflight checks before starting deploy
  const handlePreflightThenRun = async () => {
    if (!selectedJob) return;
    setPreflightLoading(true);
    setPreflightOpen(true);
    setPreflightResult(null);
    try {
      const jobCliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || 'vlocity';
      const config = {
        ...selectedJob?.configuration,
        cliType: jobCliType,
        targetUsername: runJob.targetUsername,
      };
      const res = await axios.post('/api/deploys/preflight', { jobConfig: config });
      const { errors, warnings, passedChecks } = res.data.data;
      if (errors.length === 0 && warnings.length === 0) {
        setPreflightOpen(false);
        handleRunJob();
      } else {
        setPreflightResult({ errors, warnings, passedChecks });
      }
    } catch (err) {
      // Preflight service unavailable — proceed anyway
      setPreflightOpen(false);
      handleRunJob();
    } finally {
      setPreflightLoading(false);
    }
  };

  const handleDeleteJob = (job) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Deploy Job',
      message: `Are you sure you want to delete the job "${job.name}"? This action cannot be undone.`,
      severity: 'error',
      onConfirm: async () => {
        try {
          // Use job ID for database-stored jobs
          await axios.delete(`/api/jobs/${job.id}`);
          setSuccess(`Job "${job.name}" deleted successfully`);
          setTimeout(() => setSuccess(null), 3000);
          fetchData();
        } catch (err) {
          setError(err.response?.data?.error?.message || err.message);
          setTimeout(() => setError(null), 5000);
        } finally {
          setConfirmDialog({ open: false, title: '', message: '', severity: 'warning', onConfirm: null });
        }
      },
    });
  };

  // Bulk operations handlers
  const handleSelectJob = (jobId) => {
    setSelectedJobs(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(jobId)) {
        newSelected.delete(jobId);
      } else {
        newSelected.add(jobId);
      }
      return newSelected;
    });
  };

  const handleSelectAll = (selectAll) => {
    if (selectAll) {
      // Filter inline to avoid closure-over-const issue (filteredJobs is defined later in render)
      const visible = jobs.filter(job => {
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          if (!(job.name?.toLowerCase().includes(q) || job.targetUsername?.toLowerCase().includes(q) || job.sourceUsername?.toLowerCase().includes(q))) return false;
        }
        if (filters.status && job.status !== filters.status) return false;
        if (filters.cliType && job.cliType !== filters.cliType) return false;
        return true;
      });
      setSelectedJobs(new Set(visible.map(job => job.id || job.name)));
    } else {
      setSelectedJobs(new Set());
    }
  };

  const handleBulkDelete = () => {
    setConfirmDialog({
      open: true,
      title: 'Delete Multiple Jobs',
      message: `Are you sure you want to delete ${selectedJobs.size} selected job(s)? This action cannot be undone.`,
      severity: 'error',
      onConfirm: async () => {
        try {
          // Delete all selected jobs
          await Promise.all(
            Array.from(selectedJobs).map(jobId =>
              axios.delete(`/api/jobs/${jobId}`)
            )
          );
          setSuccess(`Successfully deleted ${selectedJobs.size} job(s)`);
          setTimeout(() => setSuccess(null), 3000);
          setSelectedJobs(new Set());
          fetchData();
        } catch (err) {
          setError(err.response?.data?.error?.message || err.message);
          setTimeout(() => setError(null), 5000);
        } finally {
          setConfirmDialog({ open: false, title: '', message: '', severity: 'warning', onConfirm: null });
        }
      },
    });
  };

  const handleClearSelection = () => {
    setSelectedJobs(new Set());
  };

  const handleUpdateJob = async () => {
    try {
      await axios.put(`/api/deploys/jobs/${encodeURIComponent(selectedJob.name)}`, newJob);
      setEditDialogOpen(false);
      setNewJob({
        name: '',
        projectPath: './export',
        cliType: 'vlocity',
        queries: [],
        sourceUsername: '',
        targetUsername: '',
        attempts: 3,
        prealignSettings: false,
        deployFromExportFolder: false,
      });
      setSelectedJob(null);
      setDiscoveredFolders([]);
      fetchData();
      if (location.state?.returnPath) {
        navigate(location.state.returnPath);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const discoverExportFolders = async (exportPath) => {
    if (!exportPath) return;
    setDiscoveringFolders(true);
    try {
      const response = await axios.get('/api/deploys/export-statistics', {
        params: { exportPath }
      });
      if (response.data.success && response.data.statistics.exists) {
        setDiscoveredFolders(response.data.statistics.dataPackFolders || []);
      } else {
        setDiscoveredFolders([]);
      }
    } catch (err) {
      console.error('Error discovering folders:', err);
      setDiscoveredFolders([]);
    } finally {
      setDiscoveringFolders(false);
    }
  };

  const addQuery = () => {
    setNewJob({
      ...newJob,
      queries: [
        ...newJob.queries,
        {
          VlocityDataPackType: 'SObject',
          query: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
        }
      ]
    });
  };

  const removeQuery = (index) => {
    if (newJob.queries.length > 0) {
      const updatedQueries = newJob.queries.filter((_, i) => i !== index);
      setNewJob({
        ...newJob,
        queries: updatedQueries
      });
    }
  };

  const updateQuery = (index, field, value) => {
    const updatedQueries = [...newJob.queries];
    updatedQueries[index] = { ...updatedQueries[index], [field]: value };
    setNewJob({ ...newJob, queries: updatedQueries });
  };

  const handleViewLogs = (job) => {
    // Navigate to the job details page using job ID from database
    navigate(`/jobs/deploy/${job.id || job.name}`);
  };

  const handleAbortJob = (job) => {
    setConfirmDialog({
      open: true,
      title: 'Abort Deploy Job',
      message: `Are you sure you want to abort the job "${job.name}"? The job will stop immediately.`,
      severity: 'warning',
      onConfirm: async () => {
        try {
          await axios.post(`/api/deploys/jobs/${encodeURIComponent(job.name)}/abort`, {
            reason: 'Job aborted by user from deploy jobs page'
          });

          setSuccess(`Job "${job.name}" aborted successfully`);
          setTimeout(() => setSuccess(null), 3000);
          fetchData(); // Refresh the job list
        } catch (err) {
          setError(err.response?.data?.error?.message || err.message);
        } finally {
          setConfirmDialog({ open: false, title: '', message: '', severity: 'warning', onConfirm: null });
        }
      },
    });
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const statusColor = s => {
    switch (s) {
      case 'completed': case 'success':     return 'success';
      case 'failed':    case 'error':       return 'error';
      case 'running':   case 'in_progress': return 'info';
      case 'pending':                       return 'warning';
      default:                              return 'default';
    }
  };

  const formatRelative = iso => {
    if (!iso) return '—';
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const filteredJobs = jobs.filter(job => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(job.name?.toLowerCase().includes(q) ||
            job.projectPath?.toLowerCase().includes(q) ||
            job.targetUsername?.toLowerCase().includes(q) ||
            job.sourceUsername?.toLowerCase().includes(q))) return false;
    }
    if (filters.status && job.status !== filters.status) return false;
    if (filters.cliType && job.cliType !== filters.cliType) return false;
    return true;
  });

  if (loading) {
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading deploy jobs...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Deploy Jobs</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Deploy Job
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Jobs List */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Deploy Jobs</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                size="small"
                label={wsConnected ? 'LIVE' : 'OFFLINE'}
                color={wsConnected ? 'success' : 'warning'}
                variant={wsConnected ? 'filled' : 'outlined'}
              />
              {!wsConnected && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Refresh />}
                  onClick={handleReconnectWebSocket}
                >
                  Reconnect
                </Button>
              )}
              <Tooltip title="Refresh jobs">
                <IconButton onClick={fetchData}>
                  <Refresh />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Search + status filter chips */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Search jobs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ fontSize: 18 }} />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 220 }}
            />
            {['all', 'running', 'completed', 'failed', 'pending'].map(s => (
              <Chip
                key={s}
                size="small"
                label={s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                variant={(filters.status === s || (s === 'all' && !filters.status)) ? 'filled' : 'outlined'}
                color={s === 'all' ? 'default' : statusColor(s)}
                onClick={() => setFilters(f => ({ ...f, status: s === 'all' ? undefined : s }))}
              />
            ))}
          </Box>

          {/* Bulk Actions Toolbar */}
          {selectedJobs.size > 0 && (
            <Box sx={{ position: 'sticky', top: 0, bgcolor: 'info.light', p: 1.5, mb: 1.5, borderRadius: 1, zIndex: 10 }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" fontWeight={500}>
                  {selectedJobs.size} job(s) selected
                </Typography>
                <Button variant="outlined" color="error" size="small" startIcon={<Delete />} onClick={handleBulkDelete}>
                  Delete Selected
                </Button>
                <Button variant="text" size="small" onClick={handleClearSelection}>
                  Clear Selection
                </Button>
              </Stack>
            </Box>
          )}

          {jobs.length === 0 ? (
            <Alert severity="info">No deploy jobs found. Create your first job to get started.</Alert>
          ) : filteredJobs.length === 0 ? (
            <Alert severity="info">No jobs match your search criteria. Try adjusting your filters.</Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedJobs.size === filteredJobs.length && filteredJobs.length > 0}
                        indeterminate={selectedJobs.size > 0 && selectedJobs.size < filteredJobs.length}
                        onChange={e => handleSelectAll(e.target.checked)}
                      />
                    </TableCell>
                    <TableCell sx={{ width: 110 }}>Status</TableCell>
                    <TableCell>Job Name</TableCell>
                    <TableCell sx={{ width: 200 }}>Target Org</TableCell>
                    <TableCell sx={{ width: 64 }}>CLI</TableCell>
                    <TableCell sx={{ width: 90 }}>Created</TableCell>
                    <TableCell align="right" sx={{ width: 170 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredJobs.map(job => {
                    const jobKey = job.id || job.name;
                    const jobStatus = jobStatuses.get(jobKey) || job;
                    const isRunning = runningJobs.has(jobKey) || jobStatus.status === 'running';
                    const isExpanded = expandedJobId === jobKey;
                    return (
                      <React.Fragment key={jobKey}>
                        <TableRow
                          hover
                          sx={{ cursor: 'pointer', '& > *': { borderBottom: isExpanded ? 0 : undefined } }}
                          onClick={() => setExpandedJobId(isExpanded ? null : jobKey)}
                        >
                          <TableCell padding="checkbox" onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedJobs.has(jobKey)}
                              onChange={() => handleSelectJob(jobKey)}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={jobStatus.status || job.status || 'unknown'}
                              color={statusColor(jobStatus.status || job.status)}
                            />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              {isExpanded
                                ? <KeyboardArrowDown sx={{ fontSize: 16, color: 'text.secondary' }} />
                                : <KeyboardArrowRight sx={{ fontSize: 16, color: 'text.secondary' }} />}
                              <Typography variant="body2" fontWeight={500}>{job.name}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {jobStatus.targetUsername || job.targetUsername || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={(jobStatus.cliType || job.cliType) === 'sf' ? 'SF' : 'VLC'}
                              color={(jobStatus.cliType || job.cliType) === 'sf' ? 'primary' : 'secondary'}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption">{formatRelative(job.createdAt)}</Typography>
                          </TableCell>
                          <TableCell align="right" onClick={e => e.stopPropagation()}>
                            {!isRunning && (
                              <Tooltip title="Run">
                                <IconButton size="small" onClick={() => { setSelectedJob(job); setRunDialogOpen(true); }}>
                                  <PlayArrow fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="View Logs">
                              <IconButton size="small" onClick={() => handleViewLogs(job)}>
                                <Visibility fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Edit">
                              <IconButton size="small" onClick={() => handleEditJob(job)}>
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {isRunning && (
                              <Tooltip title="Abort">
                                <IconButton size="small" color="error" onClick={() => handleAbortJob(job)}>
                                  <Stop fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="Delete">
                              <IconButton size="small" color="error" onClick={() => handleDeleteJob(job)}>
                                <Delete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                        {/* Expandable detail row */}
                        <TableRow>
                          <TableCell colSpan={7} sx={{ py: 0, border: isExpanded ? undefined : 0 }}>
                            <Collapse in={isExpanded} unmountOnExit>
                              <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
                                <JobProgressCard
                                  job={{
                                    ...job,
                                    ...jobStatus,
                                    name: job.name,
                                    status: jobStatus.status || job.status,
                                    startTime: jobStatus.startTime || jobStatus.startedAt,
                                    endTime: jobStatus.endTime || jobStatus.completedAt,
                                  }}
                                  isRunning={isRunning}
                                  onViewLogs={handleViewLogs}
                                  onEdit={handleEditJob}
                                  onDelete={handleDeleteJob}
                                  onAbort={isRunning ? handleAbortJob : null}
                                />
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          
          {/* Pagination */}
          {jobs.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 3, gap: 2 }}>
              <TablePagination
                component="div"
                count={totalJobs}
                page={page}
                onPageChange={handlePageChange}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={handleRowsPerPageChange}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="Jobs per page:"
              />
              
              {/* Load More Button */}
              {hasMore && (
                <Button
                  variant="outlined"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  sx={{ mt: 1 }}
                >
                  {loadingMore ? 'Loading...' : 'Load More Jobs'}
                </Button>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Create Job Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create Deploy Job</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              Fields marked with <Typography component="span" color="error" fontWeight="bold">*</Typography> are required.
            </Typography>
          </Alert>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                size="small"
                label="Job Name *"
                value={newJob.name}
                onChange={(e) => setNewJob({ ...newJob, name: e.target.value })}
                error={!newJob.name.trim()}
                helperText={!newJob.name.trim() ? 'Job name is required' : 'Enter a unique name for this deploy job'}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>CLI Type</InputLabel>
                <Select
                  value={newJob.cliType || 'vlocity'}
                  label="CLI Type"
                  onChange={(e) => setNewJob({ ...newJob, cliType: e.target.value })}
                >
                  <MenuItem value="vlocity">Vlocity CLI (for Vlocity DataPacks)</MenuItem>
                  <MenuItem value="sf">Salesforce CLI (for Custom Objects like GT_ProductSKU, GT_RateCode, etc.)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                size="small"
                label="Project Path (Export Folder) *"
                value={newJob.projectPath}
                onChange={(e) => {
                  const newPath = e.target.value;
                  setNewJob({ ...newJob, projectPath: newPath });
                  // Auto-discover folders if deploying from export folder (only for Vlocity)
                  if (newJob.deployFromExportFolder && newPath && newJob.cliType === 'vlocity') {
                    discoverExportFolders(newPath);
                  }
                }}
                error={!newJob.projectPath.trim()}
                helperText={!newJob.projectPath.trim() ? 'Project path is required' : 'Path to the export folder containing DataPack folders (e.g., ./export)'}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={newJob.deployFromExportFolder}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setNewJob({ ...newJob, deployFromExportFolder: enabled, queries: enabled ? [] : newJob.queries });
                      if (enabled && newJob.projectPath) {
                        discoverExportFolders(newJob.projectPath);
                      }
                    }}
                  />
                }
                label="Deploy from Export Folder (Auto-discover DataPack folders)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: 0.5 }}>
                When enabled, automatically discovers DataPack folders from the export directory. No need to specify queries manually.
              </Typography>
            </Grid>
            {newJob.deployFromExportFolder && (
              <Grid item xs={12}>
                <Box sx={{ p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                  {discoveringFolders ? (
                    <Typography variant="body2">Discovering DataPack folders...</Typography>
                  ) : discoveredFolders.length > 0 ? (
                    <>
                      <Typography variant="subtitle2" gutterBottom>
                        Found {discoveredFolders.length} DataPack folder{discoveredFolders.length !== 1 ? 's' : ''}:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                        {discoveredFolders.map((folder) => (
                          <Chip key={folder} label={folder} size="small" />
                        ))}
                      </Box>
                    </>
                  ) : (
                    <Typography variant="body2" color="warning.main">
                      No DataPack folders found in {newJob.projectPath}. Make sure the export folder exists and contains exported DataPacks.
                    </Typography>
                  )}
                </Box>
              </Grid>
            )}
            <Grid item xs={6}>
              <FormControl fullWidth required size="small">
                <InputLabel>Source Org *</InputLabel>
                <Select
                  value={newJob.sourceUsername}
                  label="Source Org *"
                  onChange={(e) => setNewJob({ ...newJob, sourceUsername: e.target.value })}
                  error={!newJob.sourceUsername}
                >
                  {Array.isArray(orgs) && orgs.map((org) => (
                    <MenuItem key={org.username} value={org.username}>
                      {org.alias || org.username} ({org.username})
                    </MenuItem>
                  ))}
                </Select>
                {!newJob.sourceUsername && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                    Source organization is required
                  </Typography>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth required size="small">
                <InputLabel>Target Org *</InputLabel>
                <Select
                  value={newJob.targetUsername}
                  label="Target Org *"
                  onChange={(e) => setNewJob({ ...newJob, targetUsername: e.target.value })}
                  error={!newJob.targetUsername}
                >
                  {Array.isArray(orgs) && orgs.map((org) => (
                    <MenuItem key={org.username} value={org.username}>
                      {org.alias || org.username} ({org.username})
                    </MenuItem>
                  ))}
                </Select>
                {!newJob.targetUsername && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                    Target organization is required
                  </Typography>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                label="Max Attempts"
                type="number"
                value={newJob.attempts}
                onChange={(e) => setNewJob({ ...newJob, attempts: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={newJob.prealignSettings}
                    onChange={(e) => setNewJob({ ...newJob, prealignSettings: e.target.checked })}
                  />
                }
                label="Pre-align Settings"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)} disabled={creatingJob}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateJob}
            variant="contained"
            disabled={!newJob.name.trim() || !newJob.projectPath.trim() || !newJob.sourceUsername || !newJob.targetUsername || creatingJob}
            startIcon={creatingJob ? <CircularProgress size={20} /> : <Add />}
          >
            {creatingJob ? 'Creating...' : 'Create Job'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Run Job Dialog */}
      <Dialog open={runDialogOpen} onClose={() => setRunDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Deploy Job</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
            <Typography variant="body2">
              Fields marked with <Typography component="span" color="error" fontWeight="bold">*</Typography> are required.
            </Typography>
          </Alert>
          <FormControl fullWidth required size="small" sx={{ mt: 2 }}>
            <InputLabel>Target Org *</InputLabel>
            <Select
              value={runJob.targetUsername}
              label="Target Org *"
              onChange={(e) => setRunJob({ ...runJob, targetUsername: e.target.value })}
              error={!runJob.targetUsername}
            >
              {Array.isArray(orgs) && orgs.map((org) => (
                <MenuItem key={org.username} value={org.username}>
                  {org.alias || org.username} ({org.username})
                </MenuItem>
              ))}
            </Select>
            {!runJob.targetUsername && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                Target organization is required
              </Typography>
            )}
          </FormControl>
          
          {selectedJob && (
            <FormControl fullWidth size="small" sx={{ mt: 2 }}>
              <InputLabel>CLI Type</InputLabel>
              <Select
                value={selectedJob?.configuration?.cliType || selectedJob?.cliType || 'vlocity'}
                label="CLI Type"
                disabled
              >
                <MenuItem value="vlocity">Vlocity CLI (for Vlocity DataPacks)</MenuItem>
                <MenuItem value="sf">Salesforce CLI (for Custom Objects like GT_ProductSKU, GT_RateCode, etc.)</MenuItem>
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                CLI type is determined by the job configuration. Edit the job to change it.
              </Typography>
            </FormControl>
          )}
          
          <FormControl fullWidth size="small" sx={{ mt: 2 }}>
            <InputLabel>Deploy Command</InputLabel>
            <Select
              value={runJob.deployCommand || selectedJob?.configuration?.deployCommand || 'packDeploy'}
              label="Deploy Command"
              onChange={(e) => setRunJob({ ...runJob, deployCommand: e.target.value })}
              disabled={(() => {
                const cliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || runJob.cliType || 'vlocity';
                return cliType === 'sf';
              })()}
            >
                <MenuItem value="packDeploy">
                  <Box>
                    <Typography variant="body1">packDeploy</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Deploy all contents of a DataPacks Directory (standard deploy)
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="packContinue">
                  <Box>
                    <Typography variant="body1">packContinue</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Continue a job that failed due to an error
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="packRetry">
                  <Box>
                    <Typography variant="body1">packRetry</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Retry failed jobs with error reset
                    </Typography>
                  </Box>
                </MenuItem>
              </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              {(() => {
                const cliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || runJob.cliType || 'vlocity';
                return cliType === 'sf' 
                  ? 'Deploy commands are only available for Vlocity CLI jobs'
                  : 'Choose the deploy command type based on your needs';
              })()}
            </Typography>
          </FormControl>
          
          {runJob.deployCommand === 'packContinue' && (
            <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
              <Typography variant="body2">
                <strong>packContinue</strong> continues a previously failed deployment job.
                Make sure you're running this on a job that has failed and can be continued.
              </Typography>
            </Alert>
          )}
          
          {runJob.deployCommand === 'packRetry' && (
            <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
              <Typography variant="body2">
                <strong>packRetry</strong> retries a failed deployment with error reset.
                This will reset previous errors and attempt the deployment again.
              </Typography>
            </Alert>
          )}
          
          <TextField
            fullWidth
            size="small"
            label="Max Retries"
            type="number"
            value={runJob.maxRetries}
            onChange={(e) => setRunJob({ ...runJob, maxRetries: parseInt(e.target.value) || 10 })}
            helperText="Max packContinue iterations before packRetry (smart retry strategy)"
            sx={{ mt: 2 }}
          />

          {(() => {
            const cliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || runJob.cliType || 'vlocity';
            return cliType === 'vlocity' ? (
              <Box sx={{ mt: 2 }}>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={runJob.useDependencyOrder}
                      onChange={(e) => setRunJob({ ...runJob, useDependencyOrder: e.target.checked })}
                      color="primary"
                    />
                  }
                  label="Use dependency ordering"
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                  Sorts DataPack types by known dependency tier (e.g. Product2 before PriceList) to reduce reference errors
                </Typography>
              </Box>
            ) : null;
          })()}

          <Box sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={runJob.stopOnNoProgress}
                  onChange={(e) => setRunJob({ ...runJob, stopOnNoProgress: e.target.checked })}
                  color="primary"
                />
              }
              label="Stop when no progress"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
              Stops the packContinue retry loop early if 0 DataPacks were deployed in the last iteration
            </Typography>
          </Box>

          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={runJob.prealignSettings}
                  onChange={(e) => setRunJob({ ...runJob, prealignSettings: e.target.checked })}
                  color="primary"
                />
              }
              label="Pre-align Vlocity Settings"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
              Synchronizes Vlocity DataPack settings on target org before deploying to prevent settings mismatch errors
            </Typography>
          </Box>

          <Box sx={{ mt: 2, p: 1.5, bgcolor: 'warning.light', borderRadius: 1, border: '1px solid', borderColor: 'warning.main' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={useSequentialDeploy}
                  onChange={(e) => setUseSequentialDeploy(e.target.checked)}
                  color="warning"
                />
              }
              label={<Typography variant="subtitle2" fontWeight="bold">Use Standard Sequential Deployment Order</Typography>}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
              Deploys all 27 object types in the strict dependency sequence (ObjectClass → ObjectLayout → Attributes → Context → Rules → Pricing → Products → Promotions → GT objects → Catalogs → Strings). Prevents cross-reference errors in complex org migrations.
            </Typography>
            {useSequentialDeploy && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Sequential mode ignores the standard deploy command settings above. Progress streams via WebSocket for all 27 steps.
              </Alert>
            )}
          </Box>

          <Box sx={{ mt: 2, p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              🎯 Automatic Features Enabled:
            </Typography>
            <Typography variant="caption" component="div" sx={{ ml: 2 }}>
              • Smart 3-phase retry: packDeploy → packContinue loop → packRetry
            </Typography>
            <Typography variant="caption" component="div" sx={{ ml: 2 }}>
              • Auto-detects and syncs settings mismatches
            </Typography>
            <Typography variant="caption" component="div" sx={{ ml: 2 }}>
              • Comprehensive error analysis and logging
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, px: 3, pb: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={runPostValidation}
                onChange={e => setRunPostValidation(e.target.checked)}
                size="small"
              />
            }
            label="Run post-deploy validation after completion"
            sx={{ alignSelf: 'flex-start', mb: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button onClick={() => setRunDialogOpen(false)} disabled={runningJob}>
              Cancel
            </Button>
            <Button
              onClick={handlePreflightThenRun}
              variant="contained"
              disabled={!runJob.targetUsername || runningJob}
              startIcon={runningJob ? <CircularProgress size={20} /> : <PlayArrow />}
            >
              {runningJob ? 'Starting...' : 'Start Deploy Job'}
            </Button>
          </Box>
          <Box>
            {!runJob.targetUsername && (
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <strong>Action Required:</strong> Please select a target Salesforce organization to deploy data to.
                </Typography>
              </Alert>
            )}
            {runJob.targetUsername && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <strong>Important:</strong> This will deploy data to <strong>{runJob.targetUsername}</strong>. 
                  Make sure this is the correct target org. The deployment may modify existing data.
                </Typography>
              </Alert>
            )}
          </Box>
        </DialogActions>
      </Dialog>

      {/* Edit Job Dialog */}
      <Dialog open={editDialogOpen} onClose={() => { setEditDialogOpen(false); if (location.state?.returnPath) navigate(location.state.returnPath); }} maxWidth="md" fullWidth>
        <DialogTitle>Edit Deploy Job</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Job Name"
                value={newJob.name}
                onChange={(e) => setNewJob({ ...newJob, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>CLI Type</InputLabel>
                <Select
                  value={newJob.cliType || 'vlocity'}
                  label="CLI Type"
                  onChange={(e) => setNewJob({ ...newJob, cliType: e.target.value })}
                >
                  <MenuItem value="vlocity">Vlocity CLI (for Vlocity DataPacks)</MenuItem>
                  <MenuItem value="sf">Salesforce CLI (for Custom Objects like GT_ProductSKU, GT_RateCode, etc.)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Project Path"
                value={newJob.projectPath}
                onChange={(e) => setNewJob({ ...newJob, projectPath: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Source Username</InputLabel>
                <Select
                  value={newJob.sourceUsername}
                  label="Source Username"
                  onChange={(e) => setNewJob({ ...newJob, sourceUsername: e.target.value })}
                >
                  {Array.isArray(orgs) && orgs.map((org) => (
                    <MenuItem key={org.username} value={org.username}>
                      {org.alias || org.username} ({org.username})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Target Username</InputLabel>
                <Select
                  value={newJob.targetUsername}
                  label="Target Username"
                  onChange={(e) => setNewJob({ ...newJob, targetUsername: e.target.value })}
                >
                  {Array.isArray(orgs) && orgs.map((org) => (
                    <MenuItem key={org.username} value={org.username}>
                      {org.alias || org.username} ({org.username})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                label="Attempts"
                type="number"
                value={newJob.attempts}
                onChange={(e) => setNewJob({ ...newJob, attempts: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={newJob.prealignSettings}
                    onChange={(e) => setNewJob({ ...newJob, prealignSettings: e.target.checked })}
                  />
                }
                label="Pre-align Settings"
              />
            </Grid>
            {!newJob.deployFromExportFolder && (
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle2">
                    SOQL Queries ({newJob.queries.length})
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mr: 2 }}>
                    Note: For deploying from export folders, use "Deploy from Export Folder" option above instead.
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<Add />}
                    onClick={addQuery}
                    variant="outlined"
                  >
                    Add Query
                  </Button>
                </Box>
                {newJob.queries.map((query, index) => (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                    <TextField
                      fullWidth
                      multiline
                      size="small"
                      rows={2}
                      label={`Query ${index + 1}`}
                      value={query.query}
                      onChange={(e) => updateQuery(index, 'query', e.target.value)}
                      sx={{ mr: 1 }}
                    />
                    <IconButton
                      color="error"
                      onClick={() => removeQuery(index)}
                      sx={{ mt: 1 }}
                    >
                      <Remove />
                    </IconButton>
                  </Box>
                ))}
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditDialogOpen(false); if (location.state?.returnPath) navigate(location.state.returnPath); }}>Cancel</Button>
          <Button 
            onClick={handleUpdateJob} 
            variant="contained"
            color="primary"
          >
            Update Job
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        severity={confirmDialog.severity}
        confirmText={confirmDialog.severity === 'error' ? 'Delete' : 'Confirm'}
        cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ open: false, title: '', message: '', severity: 'warning', onConfirm: null })}
      />

      {/* D3: Preflight Check Dialog */}
      <PreflightCheckDialog
        open={preflightOpen}
        loading={preflightLoading}
        errors={preflightResult?.errors || []}
        warnings={preflightResult?.warnings || []}
        passedChecks={preflightResult?.passedChecks || {}}
        onProceed={() => { setPreflightOpen(false); handleRunJob(); }}
        onCancel={() => setPreflightOpen(false)}
      />
    </Box>
  );
};

export default DeployJobs;
