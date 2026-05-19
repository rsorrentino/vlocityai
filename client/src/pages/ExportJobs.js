import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  ExpandLess,
  ExpandMore,
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

const ExportJobs = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [jobs, setJobs] = useState([]);
  const [templates, setTemplates] = useState([]);
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
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Refs for values that must be readable inside callbacks/intervals without
  // causing those callbacks/effects to be recreated on every state change.
  const runningJobsRef = useRef(new Set());
  const wsRef = useRef(null);
  useEffect(() => { runningJobsRef.current = runningJobs; }, [runningJobs]);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: null,
  });

  // Preflight check state
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightResult, setPreflightResult] = useState({ errors: [], warnings: [], passedChecks: {} });

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({});

  // Loading states for actions
  const [creatingJob, setCreatingJob] = useState(false);
  const [runningJob, setRunningJob] = useState(false);

  // Bulk operations state
  const [selectedJobs, setSelectedJobs] = useState(new Set());

  const [newJob, setNewJob] = useState({
    name: '',
    projectPath: './export',
    cliType: 'vlocity', // Default to vlocity
    exportCommand: 'packExport', // Default export command: packExport, packExportSingle, packExportAllDefault
    queries: [
      {
        VlocityDataPackType: 'SObject',
        query: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
      }
    ],
    defaultMaxParallel: 10,
    exportPacksMaxSize: 5000,
    removeInvalidMatchingKeyFields: true,
    maxDepth: 10,
  });

  const [runJob, setRunJob] = useState({
    username: '',
    jobFilePath: '',
    cliType: 'vlocity', // Default to vlocity
    exportCommand: 'packExport', // Default export command
    enableRecovery: true,        // on by default — dependency errors are the main failure mode
    maxRecoveryIterations: 10,
    useDependencyOrder: true,    // sort DataPack types by tier before exporting
  });

  const fetchData = useCallback(async (pageNum = 0, append = false) => {
    try {
      if (!append) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      
      // Fetch jobs, templates, and orgs in parallel
      const [jobsResponse, templatesResponse, orgsResponse] = await Promise.all([
        axios.get('/api/exports/jobs', {
          params: {
            page: pageNum + 1,
            limit: rowsPerPage
          }
        }),
        axios.get('/api/exports/templates'),
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
      setTemplates(templatesResponse.data.templates || []);
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
        // Fetch the job details - use the full job name as it appears in the API
        const jobIdentifier = job.name || job.id;
        const response = await axios.get(`/api/exports/jobs/${encodeURIComponent(jobIdentifier)}`);
        const jobDetails = response.data;
        jobConfig = jobDetails.config || jobDetails.configuration;
      }
      
      // Set the job data for editing
      setNewJob({
        ...jobConfig,
        name: (job.name || job.id || '').replace('.yaml', ''),
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
    if (!newJob.name.trim()) {
      setError('Job name is required');
      return;
    }

    setCreatingJob(true);
    try {
      const payload = {
        ...newJob,
        cliType: newJob.cliType || 'vlocity',
        queries: (newJob.queries || []).map(({ query, ...rest }) =>
          query && query.trim() ? { ...rest, query: query.trim() } : rest
        ),
      };
      await axios.post('/api/exports/create-job', payload);
      setCreateDialogOpen(false);
      setNewJob({
        name: '',
        projectPath: './export',
        cliType: 'vlocity',
        queries: [
          {
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
          }
        ],
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
      });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setCreatingJob(false);
    }
  };

  const handlePreflightThenRun = async () => {
    if (!selectedJob) return;
    setPreflightLoading(true);
    setPreflightOpen(true);
    try {
      const jobConfig = selectedJob.configuration || {};
      const response = await axios.post('/api/exports/preflight', { jobConfig });
      const { passed, errors = [], warnings = [], passedChecks = {} } = response.data;
      setPreflightResult({ errors, warnings, passedChecks });
      setPreflightLoading(false);
      // If all passed with no warnings, skip the dialog and run immediately
      if (passed && warnings.length === 0) {
        setPreflightOpen(false);
        handleRunJob();
      }
    } catch (_err) {
      // If preflight API fails, just proceed with the run
      setPreflightOpen(false);
      setPreflightLoading(false);
      handleRunJob();
    }
  };

  const handleRunJob = async () => {
    setRunningJob(true);
    try {
      const jobKey = selectedJob.id || selectedJob.name;
      setRunningJobs(prev => new Set([...prev, jobKey]));

      // Update job status to show it's starting
      setJobStatuses(prev => {
        const newMap = new Map(prev);
        newMap.set(jobKey, {
          ...selectedJob,
          status: 'pending',
          progress: 0,
          currentOperation: 'Initializing export job...',
          startTime: new Date().toISOString(),
        });
        return newMap;
      });

      // Start the export job asynchronously
      // Get CLI type from job configuration or use default
      const jobCliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || 'vlocity';

      // Get export command from job configuration or run dialog
      const exportCommand = runJob.exportCommand || selectedJob?.configuration?.exportCommand || 'packExport';

      axios.post('/api/exports/run', {
        username: runJob.username,
        jobFilePath: selectedJob.path,
        cliType: jobCliType,
        exportCommand: exportCommand,
        enableRecovery: runJob.enableRecovery,
        maxRecoveryIterations: runJob.maxRecoveryIterations,
        useDependencyOrder: jobCliType === 'vlocity' ? runJob.useDependencyOrder : false,
      }).then(response => {
        // Job started successfully - update status
        if (response.data.jobId) {
          setJobStatuses(prev => {
            const newMap = new Map(prev);
            newMap.set(jobKey, {
              ...selectedJob,
              id: response.data.jobId,
              status: 'running',
              progress: 5,
              currentOperation: 'Job started, connecting to Salesforce...',
              startTime: new Date().toISOString(),
            });
            return newMap;
          });
        }
      }).catch(err => {
        // Handle errors in the background
        const errorMessage = err.response?.data?.error?.message || err.message || 'Failed to start export job';
        setError(errorMessage);
        // Remove from running jobs on error
        setRunningJobs(prev => {
          const newSet = new Set(prev);
          newSet.delete(jobKey);
          return newSet;
        });
        // Update job status to failed
        setJobStatuses(prev => {
          const newMap = new Map(prev);
          newMap.set(jobKey, {
            ...selectedJob,
            status: 'failed',
            currentOperation: `Error: ${errorMessage}`,
          });
          return newMap;
        });
      });
      
      // Immediately close the dialog and reset state
      setRunDialogOpen(false);
      setRunJob({ username: '', jobFilePath: '', cliType: 'vlocity', exportCommand: 'packExport', enableRecovery: true, maxRecoveryIterations: 10, useDependencyOrder: true });
      setSelectedJob(null);
      
      // Show success message with helpful information
      setError(null);
      setSuccess(`Export job "${selectedJob.name}" is starting! Monitor progress in real-time below. The job will export data from ${runJob.username}.`);
      
      // Auto-clear success message after 8 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 8000);

    } catch (err) {
      const errorMessage = err.response?.data?.error?.message || err.message || 'Failed to start export job. Please check your configuration and try again.';
      setError(errorMessage);
      // Remove from running jobs on error
      const jobKey = selectedJob?.id || selectedJob?.name;
      if (jobKey) {
        setRunningJobs(prev => {
          const newSet = new Set(prev);
          newSet.delete(jobKey);
          return newSet;
        });
      }
    } finally {
      setRunningJob(false);
    }
  };

  const handleDeleteJob = (job) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Export Job',
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
          setConfirmDialog({ open: false, title: '', message: '', onConfirm: null });
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
      setSelectedJobs(new Set(jobs.map(job => job.id || job.name)));
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
          setConfirmDialog({ open: false, title: '', message: '', onConfirm: null });
        }
      },
    });
  };

  const handleClearSelection = () => {
    setSelectedJobs(new Set());
  };

  const handleUpdateJob = async () => {
    try {
      const updatePayload = {
        ...newJob,
        queries: (newJob.queries || []).map(({ query, ...rest }) =>
          query && query.trim() ? { ...rest, query: query.trim() } : rest
        ),
      };
      await axios.put(`/api/exports/jobs/${encodeURIComponent(selectedJob.name)}`, updatePayload);
      setEditDialogOpen(false);
      setNewJob({
        name: '',
        projectPath: './export',
        queries: [
          {
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
          }
        ],
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
      });
      setSelectedJob(null);
      fetchData();
      if (location.state?.returnPath) {
        navigate(location.state.returnPath);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUseTemplate = (template) => {
    setNewJob({
      ...template.config,
      // Explicitly preserve cliType so it isn't lost when template.config lacks the field
      cliType: template.config?.cliType || 'vlocity',
      name: `${template.name} - ${new Date().toLocaleString()}`,
    });
    setCreateDialogOpen(true); // Open the create dialog after applying template
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
    if (newJob.queries.length > 1) {
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
    navigate(`/jobs/export/${job.id || job.name}`);
  };

  const handleAbortJob = (job) => {
    setConfirmDialog({
      open: true,
      title: 'Abort Export Job',
      message: `Are you sure you want to abort the job "${job.name}"? The job will stop immediately.`,
      severity: 'warning',
      onConfirm: async () => {
        try {
          await axios.post(`/api/exports/jobs/${encodeURIComponent(job.name)}/abort`, {
            reason: 'Job aborted by user from export jobs page'
          });
          setSuccess(`Job "${job.name}" aborted successfully`);
          setTimeout(() => setSuccess(null), 3000);
          fetchData();
        } catch (err) {
          setError(err.response?.data?.error?.message || err.message);
        } finally {
          setConfirmDialog({ open: false, title: '', message: '', onConfirm: null });
        }
      },
    });
  };

  // ─── Template grouping ────────────────────────────────────────────────────
  const TEMPLATE_GROUPS = [
    { label: 'Full Catalog Export',   names: ['Full Catalog Export'] },
    { label: 'Catalog & Pricing',     names: ['Product Catalog Export','Pricing Complete Export','PriceList Filtered Export','PriceList Unfiltered Export'] },
    { label: 'Configuration & Rules', names: ['Attributes & Categories Export','Calculation Matrix & Procedures Export','Rules & Object Configuration Export'] },
    { label: 'UI & Content',          names: ['OmniScript Export','FlexCard & Templates Export','Document Templates & Clauses Export'] },
    { label: 'Process & Integration', names: ['DataRaptor Export','Orchestration Export'] },
    { label: 'Custom Objects',        names: ['Custom Objects Export'] },
  ];

  // ─── Job status helpers ────────────────────────────────────────────────────
  const statusColor = s => {
    switch (s) {
      case 'completed': case 'success':     return 'success';
      case 'failed':    case 'error':       return 'error';
      case 'running':   case 'in_progress': return 'info';
      case 'aborted':   case 'pending':     return 'warning';
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

  // ─── Derived filtered job list ─────────────────────────────────────────────
  const filteredJobs = jobs.filter(job => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!job.name?.toLowerCase().includes(q) &&
          !job.projectPath?.toLowerCase().includes(q) &&
          !job.username?.toLowerCase().includes(q)) return false;
    }
    const effectiveStatus = (jobStatuses.get(job.id || job.name)?.status || job.status);
    if (filters.status && effectiveStatus !== filters.status) return false;
    if (filters.cliType && job.cliType !== filters.cliType) return false;
    return true;
  });

  if (loading) {
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading export jobs...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Export Jobs</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Export Job
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

      {/* Templates — compact collapsible grouped list */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ pb: '8px !important', pt: 1.5 }}>
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setTemplatesOpen(o => !o)}
          >
            <Typography variant="subtitle1" fontWeight={500}>
              Templates ({templates.length})
            </Typography>
            <IconButton size="small">
              {templatesOpen ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>
          <Collapse in={templatesOpen}>
            <Box sx={{ mt: 1.5 }}>
              {TEMPLATE_GROUPS.map(group => {
                const groupTpls = templates.filter(t => group.names.includes(t.name));
                if (!groupTpls.length) return null;
                return (
                  <Accordion key={group.label} disableGutters elevation={0} sx={{
                    border: '1px solid', borderColor: 'divider', mb: 0.5,
                    '&:before': { display: 'none' },
                  }}>
                    <AccordionSummary expandIcon={<ExpandMore />} sx={{
                      minHeight: 40,
                      '& .MuiAccordionSummary-content': { my: 0.5 },
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={500}>{group.label}</Typography>
                        <Chip size="small" label={groupTpls.length} sx={{ height: 18, fontSize: 11 }} />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0, px: 1.5 }}>
                      {groupTpls.map(t => (
                        <Box key={t.name} sx={{
                          display: 'flex', alignItems: 'center', py: 0.75, gap: 1,
                          borderBottom: '1px solid', borderColor: 'divider',
                          '&:last-child': { borderBottom: 0 },
                        }}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={500} noWrap>{t.name}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap
                              sx={{ display: 'block' }}>
                              {t.description}
                            </Typography>
                          </Box>
                          <Chip size="small"
                            label={t.config?.cliType === 'sf' ? 'SF CLI' : 'Vlocity'}
                            color={t.config?.cliType === 'sf' ? 'primary' : 'secondary'}
                            variant="outlined" sx={{ flexShrink: 0 }} />
                          <Button size="small" variant="outlined" sx={{ flexShrink: 0 }}
                            onClick={() => handleUseTemplate(t)}>
                            Use
                          </Button>
                        </Box>
                      ))}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          </Collapse>
        </CardContent>
      </Card>

      {/* Jobs List */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Export Jobs</Typography>
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
                <Button variant="outlined" color="error" size="small" startIcon={<Delete />}
                  onClick={handleBulkDelete}>
                  Delete Selected
                </Button>
                <Button variant="text" size="small" onClick={handleClearSelection}>
                  Clear Selection
                </Button>
              </Stack>
            </Box>
          )}

          {/* Jobs table */}
          {jobs.length === 0 ? (
            <Alert severity="info">No export jobs found. Create your first job to get started.</Alert>
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
                    <TableCell sx={{ width: 180 }}>Org</TableCell>
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
                        {/* Summary row */}
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
                              {jobStatus.username || job.username || '—'}
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
        <DialogTitle>Create Export Job</DialogTitle>
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
                helperText={!newJob.name.trim() ? 'Job name is required' : 'Enter a unique name for this export job'}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                size="small"
                label="Project Path *"
                value={newJob.projectPath}
                onChange={(e) => setNewJob({ ...newJob, projectPath: e.target.value })}
                error={!newJob.projectPath.trim()}
                helperText={!newJob.projectPath.trim() ? 'Project path is required' : 'Path where exported DataPacks will be saved (e.g., ./export)'}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                label="Max Parallel"
                type="number"
                value={newJob.defaultMaxParallel}
                onChange={(e) => setNewJob({ ...newJob, defaultMaxParallel: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                label="Export Packs Max Size"
                type="number"
                value={newJob.exportPacksMaxSize}
                onChange={(e) => setNewJob({ ...newJob, exportPacksMaxSize: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography variant="subtitle2" component="span">
                    SOQL Queries ({newJob.queries.length})
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    Optional
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<Add />}
                  onClick={addQuery}
                  variant="outlined"
                >
                  Add Query
                </Button>
              </Box>
              {newJob.queries.length === 0 && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  <Typography variant="body2">
                    Queries are optional. You can create an export job without queries or add queries to export specific records.
                    Click "Add Query" to add one.
                  </Typography>
                </Alert>
              )}
              {newJob.queries.map((query, index) => {
                const queryText = query.query || query.soql_query || '';
                const baseType = query.VlocityDataPackType || query.name || null;
                const fromMatch = queryText && /\bFROM\s+(\S+)/i.exec(queryText);
                const typeLabel = baseType === 'SObject' && fromMatch
                  ? `SObject: ${fromMatch[1]}`
                  : baseType || null;
                return (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ flex: 1, mr: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1 }}>
                        {typeLabel
                          ? <Chip label={typeLabel} size="small" color="primary" variant="outlined" />
                          : <Chip label={`Query ${index + 1}`} size="small" variant="outlined" />}
                      </Box>
                      <TextField
                        fullWidth
                        multiline
                        size="small"
                        rows={2}
                        placeholder="Using default query — add a WHERE clause to filter (optional)"
                        value={queryText}
                        onChange={(e) => {
                          updateQuery(index, 'query', e.target.value);
                        }}
                        helperText="Leave blank to use the default query, or enter a full SOQL statement"
                      />
                    </Box>
                    <IconButton
                      color="error"
                      onClick={() => removeQuery(index)}
                      sx={{ mt: 3.5 }}
                    >
                      <Remove />
                    </IconButton>
                  </Box>
                );
              })}
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
            disabled={!newJob.name.trim() || !newJob.projectPath.trim() || creatingJob}
            startIcon={creatingJob ? <CircularProgress size={20} /> : <Add />}
          >
            {creatingJob ? 'Creating...' : 'Create Job'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Run Job Dialog */}
      <Dialog open={runDialogOpen} onClose={() => setRunDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Run Export Job</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <FormControl fullWidth required size="small" sx={{ mb: 3 }}>
              <InputLabel>Select Org *</InputLabel>
              <Select
                value={runJob.username}
                label="Select Org *"
                onChange={(e) => setRunJob({ ...runJob, username: e.target.value })}
                error={!runJob.username}
              >
                {Array.isArray(orgs) && orgs.map((org) => (
                  <MenuItem key={org.id || org.username} value={org.username}>
                    {org.alias || org.username} ({org.username})
                  </MenuItem>
                ))}
              </Select>
              {!runJob.username && (
                <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                  Organization selection is required
                </Typography>
              )}
            </FormControl>
            
            {selectedJob && (
              <FormControl fullWidth size="small" sx={{ mb: 3 }}>
                <InputLabel>CLI Type</InputLabel>
                <Select
                  value={selectedJob?.configuration?.cliType || selectedJob?.cliType || 'vlocity'}
                  label="CLI Type"
                  disabled
                >
                  <MenuItem value="vlocity">Vlocity CLI</MenuItem>
                  <MenuItem value="sf">Salesforce CLI</MenuItem>
                </Select>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                  CLI type is determined by the job configuration
                </Typography>
              </FormControl>
            )}
            
            <FormControl fullWidth size="small" sx={{ mb: 3 }}>
              <InputLabel>Export Command</InputLabel>
              <Select
                value={runJob.exportCommand || selectedJob?.configuration?.exportCommand || 'packExport'}
                label="Export Command"
                onChange={(e) => setRunJob({ ...runJob, exportCommand: e.target.value })}
                disabled={(() => {
                  const cliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || runJob.cliType || 'vlocity';
                  return cliType === 'sf';
                })()}
              >
                <MenuItem value="packExport">
                  <Box>
                    <Typography variant="body1">packExport</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Export from a Salesforce org into a DataPack Directory (standard export with queries)
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="packExportSingle">
                  <Box>
                    <Typography variant="body1">packExportSingle</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Export a Single DataPack by Id with optional dependencies
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="packExportAllDefault">
                  <Box>
                    <Typography variant="body1">packExportAllDefault</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Export All Default DataPacks as listed in Supported Types Table
                    </Typography>
                  </Box>
                </MenuItem>
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                {(() => {
                  const cliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || runJob.cliType || 'vlocity';
                  return cliType === 'sf' 
                    ? 'Export commands are only available for Vlocity CLI jobs'
                    : 'Choose the export command type based on your needs';
                })()}
              </Typography>
            </FormControl>
            
            {runJob.exportCommand === 'packExportSingle' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>packExportSingle</strong> requires a DataPack Type and Salesforce ID.
                  Make sure your job configuration includes these fields, or use the Vlocity Commands page for single exports.
                </Typography>
              </Alert>
            )}
            
            {runJob.exportCommand === 'packExportAllDefault' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>packExportAllDefault</strong> exports all default DataPacks. 
                  This may take longer and export more data than a targeted export.
                </Typography>
              </Alert>
            )}
            
            {(() => {
              const cliType = selectedJob?.configuration?.cliType || selectedJob?.cliType || runJob.cliType || 'vlocity';
              return cliType === 'vlocity' ? (
                <Box sx={{ mb: 2 }}>
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
                    Sorts DataPack types by known dependency tier before exporting (e.g. Product2 before PriceList) to reduce reference errors on subsequent deploys
                  </Typography>
                </Box>
              ) : null;
            })()}

            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={runJob.enableRecovery}
                    onChange={(e) => setRunJob({ ...runJob, enableRecovery: e.target.checked })}
                    color="primary"
                  />
                }
                label="Enable Missing Dependencies Recovery"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                Automatically detects and exports missing Salesforce records referenced in error logs (recommended — on by default)
              </Typography>
            </Box>
            
            {runJob.enableRecovery && (
              <TextField
                fullWidth
                size="small"
                label="Max Recovery Iterations"
                type="number"
                value={runJob.maxRecoveryIterations}
                onChange={(e) => setRunJob({ ...runJob, maxRecoveryIterations: parseInt(e.target.value) || 10 })}
                inputProps={{ min: 1, max: 20 }}
                helperText="Maximum number of recovery attempts (1-20). Default: 10"
                sx={{ mb: 2 }}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRunDialogOpen(false)} disabled={runningJob}>
            Cancel
          </Button>
          <Box sx={{ flexGrow: 1 }}>
            <Button
              onClick={handlePreflightThenRun}
              variant="contained"
              color="primary"
              disabled={!runJob.username || runningJob}
              startIcon={runningJob ? <CircularProgress size={20} /> : <PlayArrow />}
              fullWidth
            >
              {runningJob ? 'Starting...' : 'Start Export Job'}
            </Button>
            {!runJob.username && (
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <strong>Action Required:</strong> Please select a source Salesforce organization to export data from.
                </Typography>
              </Alert>
            )}
            {runJob.username && (
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <strong>What will happen:</strong> This will export data from <strong>{runJob.username}</strong> based on the job configuration. 
                  The export process may take several minutes depending on the amount of data. You can monitor progress in real-time.
                </Typography>
              </Alert>
            )}
          </Box>
        </DialogActions>
      </Dialog>

      {/* Edit Job Dialog */}
      <Dialog open={editDialogOpen} onClose={() => { setEditDialogOpen(false); if (location.state?.returnPath) navigate(location.state.returnPath); }} maxWidth="md" fullWidth>
        <DialogTitle>Edit Export Job</DialogTitle>
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
              <TextField
                fullWidth
                size="small"
                label="Project Path"
                value={newJob.projectPath}
                onChange={(e) => setNewJob({ ...newJob, projectPath: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                label="Max Parallel"
                type="number"
                value={newJob.defaultMaxParallel}
                onChange={(e) => setNewJob({ ...newJob, defaultMaxParallel: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                label="Export Packs Max Size"
                type="number"
                value={newJob.exportPacksMaxSize}
                onChange={(e) => setNewJob({ ...newJob, exportPacksMaxSize: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle2">
                  SOQL Queries ({newJob.queries.length})
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
              {newJob.queries.map((query, index) => {
                const queryText = query.query || query.soql_query || '';
                const baseType = query.VlocityDataPackType || query.name || null;
                const fromMatch = queryText && /\bFROM\s+(\S+)/i.exec(queryText);
                const typeLabel = baseType === 'SObject' && fromMatch
                  ? `SObject: ${fromMatch[1]}`
                  : baseType || null;
                return (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ flex: 1, mr: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1 }}>
                        {typeLabel
                          ? <Chip label={typeLabel} size="small" color="primary" variant="outlined" />
                          : <Chip label={`Query ${index + 1}`} size="small" variant="outlined" />}
                      </Box>
                      <TextField
                        fullWidth
                        multiline
                        size="small"
                        rows={2}
                        placeholder="Using default query — add a WHERE clause to filter (optional)"
                        value={queryText}
                        onChange={(e) => {
                          updateQuery(index, 'query', e.target.value);
                        }}
                        helperText="Leave blank to use the default query, or enter a full SOQL statement"
                      />
                    </Box>
                    <IconButton
                      color="error"
                      onClick={() => removeQuery(index)}
                      disabled={newJob.queries.length === 1}
                      sx={{ mt: 3.5 }}
                    >
                      <Remove />
                    </IconButton>
                  </Box>
                );
              })}
            </Grid>
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
        severity={confirmDialog.severity || 'warning'}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ open: false, title: '', message: '', onConfirm: null })}
      />

      {/* Preflight Check Dialog */}
      <PreflightCheckDialog
        open={preflightOpen}
        loading={preflightLoading}
        errors={preflightResult.errors}
        warnings={preflightResult.warnings}
        passedChecks={preflightResult.passedChecks}
        onProceed={() => { setPreflightOpen(false); handleRunJob(); }}
        onCancel={() => setPreflightOpen(false)}
      />
    </Box>
  );
};

export default ExportJobs;
