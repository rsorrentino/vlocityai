import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  Chip,
  Alert,
  LinearProgress,
  IconButton,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  ArrowBack,
  Refresh,
  PlayArrow,
  Stop,
  CheckCircle,
  Error,
  Info,
  Schedule,
  Timer,
  ExpandMore,
  Visibility,
  Edit,
  Delete,
  Download,
  Assessment,
  Search,
  Clear,
  KeyboardArrowDown,
  BarChart,
  Build,
  Code,
  ContentCopy,
} from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog';
import BuildLogAnalyzer from '../components/BuildLogAnalyzer';

const formatDuration = (ms) => {
  if (!ms || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
};

const JobDetails = () => {
  const { jobId, jobType } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [connected, setConnected] = useState(false);
  const logsEndRef = useRef(null);
  const wsRef = useRef(null); // Ref to track WebSocket for cleanup
  const reconnectingRef = useRef(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [useSequentialDeploy, setUseSequentialDeploy] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState('all');
  const [visibleLogCount, setVisibleLogCount] = useState(1000);
  const logsContainerRef = useRef(null);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: null,
  });

  // D5: Rollback state
  const [rollbackStatus, setRollbackStatus] = useState(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const [rollbackInProgress, setRollbackInProgress] = useState(false);
  const rollbackJobId = job?.id;
  const rollbackJobType = job?.type;
  const rollbackJobStatus = job?.status;

  // Memoized filtered logs for performance
  const filteredLogs = useMemo(() => {
    let filtered = logs;
    
    // Filter by level
    if (logLevelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === logLevelFilter);
    }
    
    // Filter by search text
    if (logFilter.trim()) {
      const searchLower = logFilter.toLowerCase();
      filtered = filtered.filter(log => {
        const message = log.message ? log.message.toLowerCase() : '';
        return message.includes(searchLower);
      });
    }
    
    return filtered;
  }, [logs, logFilter, logLevelFilter]);

  // Get displayed logs (limit for performance)
  const displayedLogs = useMemo(() => {
    // For very large logs, show the most recent entries
    if (filteredLogs.length > visibleLogCount) {
      return filteredLogs.slice(-visibleLogCount);
    }
    return filteredLogs;
  }, [filteredLogs, visibleLogCount]);

  // Generate unique key for each log entry
  const getLogKey = useCallback((log, index) => {
    if (log.timestamp && log.message) {
      // Use timestamp + first 20 chars of message as key for stability
      return `${log.timestamp}-${log.message.substring(0, 20)}-${index}`;
    }
    return `log-${index}`;
  }, []);

  const fetchJobDetails = useCallback(async () => {
    try {
      setLoading(true);
      
      // Check if jobId looks like a UUID (for job history jobs)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);
      
      if (isUUID) {
        // Try to get job details from the general jobs API using job ID (UUID)
        try {
          const response = await axios.get(`/api/jobs/${jobId}`);
          const jobData = response.data.job || response.data;
          setJob(jobData);
          
          // Fetch logs from file storage (not database)
          try {
            // Request more logs for large files
            const logsResponse = await axios.get(`/api/jobs/${jobId}/logs?tail=5000`);
            const fetchedLogs = logsResponse.data.logs || [];
            setLogs(fetchedLogs);
            // Set initial visible count based on total logs
            if (fetchedLogs.length > 1000) {
              setVisibleLogCount(1000);
            }
          } catch (logsError) {
            console.warn('Failed to fetch logs from file:', logsError);
            setLogs([]);
          }
          
          return;
        } catch (jobApiError) {
          // If UUID-based job not found, show error instead of trying export/deploy endpoints
          setError(`Job with ID ${jobId} not found`);
          return;
        }
      }
      
      // For name-based jobs (export/deploy), try the specific endpoints
      const endpoint = jobType === 'export' ? '/api/exports/jobs' : '/api/deploys/jobs';
      const response = await axios.get(`${endpoint}/${jobId}`);
      const jobData = response.data;
      setJob(jobData);
      
      // Fetch logs if job has a UUID id (for running/completed jobs)
      if (jobData.id) {
        try {
          const logsResponse = await axios.get(`/api/jobs/${jobData.id}/logs?tail=5000`);
          const fetchedLogs = logsResponse.data.logs || [];
          setLogs(fetchedLogs);
          // Set initial visible count based on total logs
          if (fetchedLogs.length > 1000) {
            setVisibleLogCount(1000);
          }
        } catch (logsError) {
          console.warn('Failed to fetch logs for name-based job:', logsError);
          // Don't set logs to empty array - might be a running job that hasn't generated logs yet
        }
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [jobId, jobType]);

  // D5: Load rollback status when job is a completed or failed deploy
  useEffect(() => {
    if (rollbackJobId && rollbackJobType === 'deploy' && ['completed', 'failed'].includes(rollbackJobStatus)) {
      const fetchRollbackStatus = async () => {
        setRollbackLoading(true);
        try {
          const res = await axios.get(`/api/deploys/jobs/${rollbackJobId}/rollback-status`);
          setRollbackStatus(res.data.data);
        } catch (err) {
          setRollbackStatus({ available: false });
        } finally {
          setRollbackLoading(false);
        }
      };
      fetchRollbackStatus();
    }
  }, [rollbackJobId, rollbackJobType, rollbackJobStatus]);

  const handleRollback = async () => {
    if (!job) return;
    setRollbackInProgress(true);
    try {
      const res = await axios.post(`/api/deploys/jobs/${job.id}/rollback`, {
        targetUsername: job.configuration?.targetUsername,
      });
      const { restoreJobId } = res.data.data;
      setRollbackConfirmOpen(false);
      setSuccess('Rollback started successfully.');
      setTimeout(() => navigate(`/jobs/deploy/${restoreJobId}`), 1000);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
      setRollbackConfirmOpen(false);
    } finally {
      setRollbackInProgress(false);
    }
  };

  const handleWebSocketMessage = useCallback((data) => {
    if (!data || !data.type) {
      return;
    }
    
    // Check if message is for this job - jobId can be at top level or in data
    const messageJobId = data.jobId || data.data?.id || data.data?.jobId;
    const messageJobName = data.data?.name || data.data?.jobName;
    const isForThisJob = messageJobId === jobId || messageJobName === jobId;
    
    if (!isForThisJob) {
      return;
    }
    
    switch (data.type) {
      case 'job_update':
        setJob(prev => {
          if (!prev) return data.data;
          return { ...prev, ...data.data };
        });
        break;
        
      case 'job_log':
        setLogs(prev => {
          // Prevent duplicate logs by checking if this exact log already exists
          const isDuplicate = prev.some(existingLog => 
            existingLog.timestamp === data.data.timestamp && 
            existingLog.message === data.data.message
          );
          if (isDuplicate) {
            return prev;
          }
          return [...prev, data.data];
        });
        break;
        
      case 'job_error':
        setLogs(prev => [...prev, { ...data.data, level: 'error' }]);
        break;
        
      case 'job_complete':
        setJob(prev => {
          if (!prev) return { ...data.data, status: 'completed' };
          return { ...prev, status: 'completed', ...data.data };
        });
        break;
        
      case 'job_aborted':
        setJob(prev => {
          if (!prev) return { ...data.data, status: 'aborted' };
          return { ...prev, status: 'aborted', ...data.data };
        });
        break;
        
      case 'job_started':
        setJob(prev => {
          if (!prev) return data.data;
          return { ...prev, ...data.data, status: 'running' };
        });
        break;
        
      default:
        // Unknown message type - silently ignore
        break;
    }
  }, [jobId]);

  const connectWebSocket = useCallback(() => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/jobs`;
      
      const websocket = new WebSocket(wsUrl);
      
      websocket.onopen = () => {
        setConnected(true);
        reconnectingRef.current = false;
      };
      
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          // Silently handle parse errors - might be non-JSON messages
        }
      };
      
      websocket.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectingRef.current = false;
      };
      
      websocket.onerror = () => {
        setConnected(false);
        reconnectingRef.current = false;
      };
      
      wsRef.current = websocket; // Store in ref for cleanup
    } catch (error) {
      console.error('Error creating WebSocket:', error);
    }
  }, [handleWebSocketMessage]);

  const handleReconnectWebSocket = useCallback(() => {
    if (reconnectingRef.current) {
      return;
    }

    reconnectingRef.current = true;
    setConnected(false);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    wsRef.current = null;

    connectWebSocket();
  }, [connectWebSocket]);

  useEffect(() => {
    let isMounted = true;
    let abortController = new AbortController();
    
    // Fetch job details with abort controller
    const fetchData = async () => {
      try {
        await fetchJobDetails();
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          console.error('Failed to fetch job details:', err);
        }
      }
    };
    
    fetchData();
    connectWebSocket();
    
    // Fetch available orgs
    const fetchOrgs = async () => {
      try {
        const response = await axios.get('/api/orgs/list', {
          signal: abortController.signal
        });
        if (isMounted) {
          setOrgs(response.data.orgs || []);
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          console.error('Failed to fetch orgs:', err);
        }
      }
    };
    fetchOrgs();
    
    return () => {
      isMounted = false;
      abortController.abort();
      // Avoid calling close() on CONNECTING sockets in StrictMode cleanup;
      // it creates noisy "closed before connection is established" warnings.
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchJobDetails, connectWebSocket]);

  // Poll for logs when job is running (fallback if WebSocket fails)
  useEffect(() => {
    if (!job || job.status !== 'running') {
      return;
    }

    let isMounted = true;
    let abortController = new AbortController();
    let pollInterval = null;

    // Get the job UUID - could be jobId itself (if UUID) or job.id (for export/deploy jobs)
    const jobUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId) 
      ? jobId 
      : (job.id || jobId);
    
    if (!jobUUID) {
      console.warn('Cannot poll logs: No job UUID found', { jobId, jobIdType: typeof jobId, jobIdValue: jobId, jobIdFromData: job?.id });
      return;
    }

    // Fetch logs immediately when job starts running
    const fetchLogs = async () => {
      if (!isMounted) return;
      
      try {
        const logsResponse = await axios.get(`/api/jobs/${jobUUID}/logs?tail=5000`, {
          signal: abortController.signal
        });
        const fetchedLogs = logsResponse.data.logs || [];
        
        if (isMounted && fetchedLogs.length > 0) {
          console.log(`Fetched ${fetchedLogs.length} logs for running job`);
          setLogs(fetchedLogs);
          
          // Update visible count if needed
          if (fetchedLogs.length > visibleLogCount) {
            setVisibleLogCount(Math.min(1000, fetchedLogs.length));
          }
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          console.debug('Failed to fetch logs (will retry via polling):', err.message);
        }
      }
    };

    // Fetch immediately
    fetchLogs();

    // Poll for logs every 3 seconds when job is running
    pollInterval = setInterval(async () => {
      if (!isMounted) {
        clearInterval(pollInterval);
        return;
      }
      
      try {
        const logsResponse = await axios.get(`/api/jobs/${jobUUID}/logs?tail=5000`, {
          signal: abortController.signal
        });
        const fetchedLogs = logsResponse.data.logs || [];
        
        // Only update if we got new logs (more than current) and component is still mounted
        if (isMounted && fetchedLogs.length > logs.length) {
          console.log(`Polling: Found ${fetchedLogs.length} logs (had ${logs.length})`);
          setLogs(fetchedLogs);
          
          // Update visible count if needed
          if (fetchedLogs.length > visibleLogCount) {
            setVisibleLogCount(Math.min(1000, fetchedLogs.length));
          }
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          // Silently fail - WebSocket might be working or logs endpoint might not be available
          console.debug('Polling logs (this is normal if WebSocket is working):', err.message);
        }
      }
    }, 3000); // Poll every 3 seconds

    return () => {
      isMounted = false;
      abortController.abort();
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [jobId, job, logs.length, visibleLogCount]);

  // Track previous log count to detect new logs
  const prevLogCountRef = useRef(0);
  const userScrolledUpRef = useRef(false);

  // Handle manual scroll - detect if user scrolled up
  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      userScrolledUpRef.current = !isAtBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) return;

    // Detect new logs (check actual logs array, not displayed)
    const hasNewLogs = logs.length > prevLogCountRef.current;
    const hasFilters = logFilter.trim() !== '' || logLevelFilter !== 'all';
    
    // Auto-scroll if enabled, new logs arrived
    if (autoScroll && hasNewLogs) {
      // If filters are active or user scrolled up, check if we should still scroll
      if (hasFilters || userScrolledUpRef.current) {
        const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (!isAtBottom) {
          prevLogCountRef.current = logs.length;
          return; // User scrolled up or filtered, don't auto-scroll
        }
      }

      // Scroll to bottom - use multiple attempts for reliability
      const scrollToBottom = () => {
        if (!container) return;
        // Direct scroll to bottom
        container.scrollTop = container.scrollHeight;
        
        // Also try scrollIntoView on the end ref
        if (logsEndRef.current) {
          logsEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
      };

      // Immediate scroll
      scrollToBottom();
      
      // Try again after a brief delay (for DOM updates)
      const timeoutId = setTimeout(() => {
        scrollToBottom();
      }, 10);
      
      // One more attempt after render completes
      requestAnimationFrame(() => {
        scrollToBottom();
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      });

      return () => clearTimeout(timeoutId);
    }

    // Update ref for next comparison
    prevLogCountRef.current = logs.length;
  }, [logs.length, autoScroll, logFilter, logLevelFilter]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'running': return 'primary';
      case 'completed': return 'success';
      case 'failed': return 'error';
      case 'aborted': return 'warning';
      case 'pending': return 'warning';
      default: return 'default';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'running': return <PlayArrow />;
      case 'completed': return <CheckCircle />;
      case 'failed': return <Error />;
      case 'aborted': return <Stop />;
      case 'pending': return <Schedule />;
      default: return <Info />;
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleBack = () => {
    navigate(-1);
  };

  const handleRefresh = () => {
    fetchJobDetails();
  };

  const handleAbortJob = () => {
    setConfirmDialog({
      open: true,
      title: 'Abort Job',
      message: 'Are you sure you want to abort this job? The job will stop immediately.',
      severity: 'warning',
      onConfirm: async () => {
        try {
          const response = await axios.post(`/api/jobs/${jobId}/abort`, {
            reason: 'Job aborted by user from job details page'
          });
          setJob(response.data.job);
          setSuccess('Job aborted successfully');
          setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
          setError(err.response?.data?.error?.message || err.message);
        } finally {
          setConfirmDialog({ open: false, title: '', message: '', onConfirm: null });
        }
      },
    });
  };

  const handleRunJob = () => {
    if (!job) return;
    // Open dialog to select org
    setRunDialogOpen(true);
  };

  const handleConfirmRun = async () => {
    if (!selectedOrg) {
      setError('Please select an org');
      return;
    }

    try {
      setRunDialogOpen(false);
      setUseSequentialDeploy(false);
      setSuccess('Starting job...');

      const jobConfigWithCliType = {
        ...job.configuration,
        cliType: job.cliType || job.configuration?.cliType || 'vlocity'
      };

      if (job.type === 'deploy' && useSequentialDeploy) {
        // ── Sequential 27-step deploy ──────────────────────────────────────
        const projectPath = job.configuration?.projectPath || job.projectPath;
        await axios.post('/api/deploys/sequential', {
          targetUsername: selectedOrg,
          projectPath,
          baseJobConfig: jobConfigWithCliType,
          continueOnError: true,
        });
      } else {
        // ── Standard run ───────────────────────────────────────────────────
        const endpoint = job.type === 'export' ? '/api/exports/run' : '/api/deploys/run';
        const requestBody = job.type === 'export'
          ? { username: selectedOrg, jobFilePath: job.filePath, jobConfig: jobConfigWithCliType, cliType: jobConfigWithCliType.cliType }
          : { targetUsername: selectedOrg, jobFilePath: job.filePath, jobConfig: jobConfigWithCliType, cliType: jobConfigWithCliType.cliType };
        await axios.post(endpoint, requestBody);
      }
      
      setSuccess('Job started successfully! Logs will appear below.');
      setTimeout(() => setSuccess(null), 5000);
      
      // Refresh job details
      setTimeout(() => fetchJobDetails(), 1000);
    } catch (err) {
      // Check for authentication error
      if (err.response?.data?.error?.authError && err.response?.data?.error?.reloginInfo) {
        setAuthError(err.response.data.error.reloginInfo);
      } else {
        setError(err.response?.data?.error?.message || err.message);
        setTimeout(() => setError(null), 5000);
      }
    }
  };

  const handleEditJob = () => {
    const returnPath = window.location.pathname;
    if (job.type === 'export') {
      navigate('/exports', { state: { editJob: job, returnPath } });
    } else if (job.type === 'deploy') {
      navigate('/deploys', { state: { editJob: job, returnPath } });
    }
  };

  const handleDeleteJob = () => {
    setConfirmDialog({
      open: true,
      title: 'Delete Job',
      message: `Are you sure you want to delete the job "${job.name}"? This action cannot be undone.`,
      severity: 'error',
      onConfirm: async () => {
        try {
          await axios.delete(`/api/jobs/${jobId}`);
          setSuccess('Job deleted successfully. Redirecting...');
          setTimeout(() => {
            if (job.type === 'export') {
              navigate('/exports');
            } else if (job.type === 'deploy') {
              navigate('/deploys');
            } else {
              navigate('/history');
            }
          }, 1500);
        } catch (err) {
          setError(err.response?.data?.error?.message || err.message);
          setTimeout(() => setError(null), 5000);
        } finally {
          setConfirmDialog({ open: false, title: '', message: '', onConfirm: null });
        }
      },
    });
  };

  // Extract executed commands from logs
  const extractExecutedCommands = useCallback(() => {
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (str) => str ? str.replace(/\x1b\[[0-9;]*m/g, '') : '';
    
    const commands = [];
    
    logs.forEach(log => {
      const message = stripAnsi(log.message || '');
      
      // Look for command log entries (both SF CLI and Vlocity CLI format)
      // SF CLI: "📋 Command: sf ..."
      // Vlocity CLI: "📋 Command: vlocity ..."
      const commandMatch = message.match(/📋\s*Command:\s*(.+)/i);
      if (commandMatch) {
        const command = commandMatch[1].trim();
        // Avoid duplicates
        if (!commands.some(cmd => cmd.command === command)) {
          commands.push({
            command: command,
            timestamp: log.timestamp,
            level: log.level || 'debug'
          });
        }
      }
    });

    return commands;
  }, [logs]);

  const extractStructuredInfo = () => {
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (str) => str ? str.replace(/\x1b\[[0-9;]*m/g, '') : '';
    
    const info = {
      job: {
        name: job?.name,
        type: job?.type,
        status: job?.status,
        startedAt: job?.startedAt,
        completedAt: job?.completedAt,
        duration: job?.duration,
      },
      execution: {
        itemsRetrieved: null,
        itemsExported: null,
        completed: null,
        success: null,
        errors: 0,
        warnings: 0,
        elapsedTime: null,
      },
      files: [],
      errors: [],
      warnings: [],
    };

    logs.forEach(log => {
      const message = stripAnsi(log.message || '');
      
      // Extract metrics
      const retrievedMatch = message.match(/Retrieved\s+(\d+)\s+items/i);
      if (retrievedMatch) info.execution.itemsRetrieved = parseInt(retrievedMatch[1]);
      
      const exportingMatch = message.match(/Exporting.*?(\d+)/i);
      if (exportingMatch && !info.execution.itemsExported) {
        info.execution.itemsExported = parseInt(exportingMatch[1]);
      }
      
      const completedMatch = message.match(/(\d+)\s+Completed/i);
      if (completedMatch) info.execution.completed = parseInt(completedMatch[1]);
      
      const successMatch = message.match(/Success\s+>>\s+(\d+)/i);
      if (successMatch) info.execution.success = parseInt(successMatch[1]);
      
      const elapsedMatch = message.match(/Elapsed Time\s+>>\s+(\d+m\s+\d+s)/i);
      if (elapsedMatch) info.execution.elapsedTime = elapsedMatch[1];
      
      // Extract files
      const fileMatch = message.match(/Creating file >>\s+(.+)/i);
      if (fileMatch) info.files.push(fileMatch[1].trim());
      
      // Count errors and warnings
      if (log.level === 'error' || message.toLowerCase().includes('error')) {
        info.execution.errors++;
        info.errors.push({
          timestamp: log.timestamp,
          message: message
        });
      }
      
      if (log.level === 'warn' || message.toLowerCase().includes('warning')) {
        info.execution.warnings++;
        info.warnings.push({
          timestamp: log.timestamp,
          message: message
        });
      }
    });

    return info;
  };

  const handleDownloadLogs = () => {
    if (!job) {
      setError('No job available');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      // Download directly from server (file stream)
      const link = document.createElement('a');
      link.href = `/api/jobs/${jobId}/logs/download`;
      link.download = `${job.name.replace(/[^a-z0-9]/gi, '_')}_${jobId}.log`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccess('Log file download started');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to download logs');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleDownloadReport = () => {
    if (!job || logs.length === 0) {
      setError('No logs available to generate report');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      const structuredInfo = extractStructuredInfo();
      const reportContent = JSON.stringify(structuredInfo, null, 2);

      // Create blob and download
      const blob = new Blob([reportContent], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Generate filename
      const filename = `${job.name.replace(/[^a-z0-9]/gi, '_')}_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.download = filename;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setSuccess(`Report downloaded: ${filename}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to download report');
      setTimeout(() => setError(null), 3000);
    }
  };

  if (loading) {
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading job details...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button onClick={handleBack} startIcon={<ArrowBack />}>
          Go Back
        </Button>
      </Box>
    );
  }

  if (!job) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 3 }}>
          Job not found
        </Alert>
        <Button onClick={handleBack} startIcon={<ArrowBack />}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Success Alert */}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      {/* Authentication Error Dialog */}
      <Dialog
        open={!!authError}
        onClose={() => setAuthError(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Error color="error" />
            Authentication Required
          </Box>
        </DialogTitle>
        <DialogContent>
          {authError && (
            <Box>
              <Alert severity="error" sx={{ mb: 2 }}>
                {authError.message}
              </Alert>
              
              <Typography variant="subtitle2" gutterBottom>
                Org: {authError.username}
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                Alias: {authError.alias}
              </Typography>
              {authError.instanceUrl && (
                <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                  Instance URL: {authError.instanceUrl}
                </Typography>
              )}
              {!authError.instanceUrl && <Box sx={{ mb: 2 }} />}
              
              <Typography variant="h6" gutterBottom>
                To re-authenticate:
              </Typography>
              
              <Box component="ul" sx={{ pl: 2, mb: 2 }}>
                {authError.instructions && authError.instructions.map((instruction, index) => (
                  <Typography component="li" key={index} sx={{ mb: 0.5 }}>
                    {instruction}
                  </Typography>
                ))}
              </Box>
              
              <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                <Typography variant="caption" color="text.secondary">
                  Command:
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, mb: 2 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      bgcolor: 'grey.900',
                      color: 'white',
                      p: 1,
                      borderRadius: 1,
                      flex: 1,
                      wordBreak: 'break-all'
                    }}
                  >
                    {authError.command}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      navigator.clipboard.writeText(authError.command);
                      setSuccess('Command copied to clipboard!');
                      setTimeout(() => setSuccess(null), 3000);
                    }}
                  >
                    Copy
                  </Button>
                </Box>
                
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/system/run-auth-command', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ 
                            command: authError.command,
                            alias: authError.alias,
                            instanceUrl: authError.instanceUrl
                          })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                          setSuccess('Authentication command executed! Complete the login in your browser.');
                          setTimeout(() => setSuccess(null), 5000);
                        } else {
                          setError(data.error || 'Failed to execute command. Please run manually.');
                          setTimeout(() => setError(null), 5000);
                        }
                      } catch (err) {
                        setError('Failed to execute command. Please copy and run manually.');
                        setTimeout(() => setError(null), 5000);
                      }
                    }}
                  >
                    Run Command
                  </Button>
                  
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => {
                      navigator.clipboard.writeText(authError.command);
                      setSuccess('Command copied! Paste in your terminal.');
                      setTimeout(() => setSuccess(null), 3000);
                    }}
                  >
                    Copy & Run Manually
                  </Button>
                </Box>
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAuthError(null)} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={handleBack} sx={{ mr: 2 }}>
          <ArrowBack />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4" gutterBottom>
            {job.name || jobId}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Chip
              icon={getStatusIcon(job.status)}
              label={job.status?.toUpperCase() || 'UNKNOWN'}
              color={getStatusColor(job.status)}
              variant="outlined"
            />
            <Chip
              label={jobType?.toUpperCase() || 'JOB'}
              color="primary"
              variant="outlined"
            />
            {connected && (
              <Chip
                label="LIVE"
                color="success"
                size="small"
              />
            )}
            {!connected && (
              <Chip
                label="OFFLINE"
                color="warning"
                size="small"
              />
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {/* Run Button - show only if job is pending, completed, failed, or aborted */}
          {job && ['pending', 'completed', 'failed', 'aborted'].includes(job.status) && (
            <Tooltip title="Run Job">
              <Button
                variant="contained"
                color="primary"
                startIcon={<PlayArrow />}
                onClick={handleRunJob}
                size="small"
              >
                Run
              </Button>
            </Tooltip>
          )}
          
          {/* Abort Button - show only if job is running */}
          {job && job.status === 'running' && (
            <Tooltip title="Abort Job">
              <Button
                variant="outlined"
                color="error"
                startIcon={<Stop />}
                onClick={handleAbortJob}
                size="small"
              >
                Abort
              </Button>
            </Tooltip>
          )}
          
          {/* Edit Button */}
          {job && (
            <Tooltip title="Edit Job">
              <IconButton onClick={handleEditJob} color="primary">
                <Edit />
              </IconButton>
            </Tooltip>
          )}
          
          {/* Delete Button */}
          {job && (
            <Tooltip title="Delete Job">
              <IconButton onClick={handleDeleteJob} color="error">
                <Delete />
              </IconButton>
            </Tooltip>
          )}
          
          {/* Refresh Button */}
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh}>
              <Refresh />
            </IconButton>
          </Tooltip>

          {/* Reconnect WebSocket Button */}
          {!connected && (
            <Tooltip title="Reconnect Live Updates">
              <Button
                variant="outlined"
                size="small"
                startIcon={<Refresh />}
                onClick={handleReconnectWebSocket}
              >
                Reconnect
              </Button>
            </Tooltip>
          )}
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Job Information */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Job Information
              </Typography>
              
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <Schedule />
                  </ListItemIcon>
                  <ListItemText
                    primary="Created"
                    secondary={formatTimestamp(job.createdAt || job.stats?.createdAt)}
                  />
                </ListItem>
                
                {job.stats?.modifiedAt && (
                  <ListItem>
                    <ListItemIcon>
                      <Timer />
                    </ListItemIcon>
                    <ListItemText
                      primary="Last Modified"
                      secondary={formatTimestamp(job.stats.modifiedAt)}
                    />
                  </ListItem>
                )}
                
                {job.stats?.size && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="File Size"
                      secondary={`${(job.stats.size / 1024).toFixed(2)} KB`}
                    />
                  </ListItem>
                )}
                
                {job.config?.queries && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="Queries"
                      secondary={`${job.config.queries.length} queries`}
                    />
                  </ListItem>
                )}
              </List>
            </CardContent>
          </Card>

          {/* Context Information */}
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Context Information
              </Typography>
              
              <List dense>
                {job.username && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="Salesforce Username"
                      secondary={job.username}
                      secondaryTypographyProps={{ 
                        sx: { 
                          wordBreak: 'break-all'
                        } 
                      }}
                    />
                  </ListItem>
                )}
                
                {job.filePath && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="Job File Path"
                      secondary={job.filePath}
                      secondaryTypographyProps={{ 
                        sx: { 
                          fontFamily: 'monospace', 
                          fontSize: '0.8rem',
                          wordBreak: 'break-all'
                        } 
                      }}
                    />
                  </ListItem>
                )}
                
                {job.projectPath && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="Project Path"
                      secondary={job.projectPath}
                    />
                  </ListItem>
                )}
                
                {job.sourceUsername && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="Source Username"
                      secondary={job.sourceUsername}
                      secondaryTypographyProps={{ 
                        sx: { 
                          wordBreak: 'break-all'
                        } 
                      }}
                    />
                  </ListItem>
                )}
                
                {job.targetUsername && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="Target Username"
                      secondary={job.targetUsername}
                      secondaryTypographyProps={{ 
                        sx: { 
                          wordBreak: 'break-all'
                        } 
                      }}
                    />
                  </ListItem>
                )}
                
                {job.environment && (
                  <ListItem>
                    <ListItemIcon>
                      <Info />
                    </ListItemIcon>
                    <ListItemText
                      primary="Environment"
                      secondary={job.environment}
                    />
                  </ListItem>
                )}
                
                {(job.cliType || job.configuration?.cliType) && (
                  <ListItem>
                    <ListItemIcon>
                      {(job.cliType || job.configuration?.cliType) === 'sf' ? <Code /> : <Build />}
                    </ListItemIcon>
                    <ListItemText
                      primary="CLI Type"
                      secondaryTypographyProps={{ component: 'div' }}
                      secondary={
                        <Chip
                          label={(job.cliType || job.configuration?.cliType || 'vlocity').toUpperCase()}
                          size="small"
                          color={(job.cliType || job.configuration?.cliType) === 'sf' ? 'primary' : 'secondary'}
                          variant="outlined"
                        />
                      }
                    />
                  </ListItem>
                )}
                
                {job.startedAt && (
                  <ListItem>
                    <ListItemIcon>
                      <Timer />
                    </ListItemIcon>
                    <ListItemText
                      primary="Started At"
                      secondary={formatTimestamp(job.startedAt)}
                    />
                  </ListItem>
                )}
                
                {job.completedAt && (
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle />
                    </ListItemIcon>
                    <ListItemText
                      primary="Completed At"
                      secondary={formatTimestamp(job.completedAt)}
                    />
                  </ListItem>
                )}
                
                {job.duration && (
                  <ListItem>
                    <ListItemIcon>
                      <Timer />
                    </ListItemIcon>
                    <ListItemText
                      primary="Duration"
                      secondary={formatDuration(job.duration)}
                    />
                  </ListItem>
                )}
              </List>
            </CardContent>
          </Card>

          {/* Job Configuration */}
          {job.config && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Configuration
                </Typography>
                
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography>Job Settings</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <List dense>
                      {job.config.projectPath && (
                        <ListItem>
                          <ListItemText
                            primary="Project Path"
                            secondary={job.config.projectPath}
                            secondaryTypographyProps={{ 
                              sx: { 
                                wordBreak: 'break-all'
                              } 
                            }}
                          />
                        </ListItem>
                      )}
                      {job.config.defaultMaxParallel && (
                        <ListItem>
                          <ListItemText
                            primary="Max Parallel"
                            secondary={job.config.defaultMaxParallel}
                          />
                        </ListItem>
                      )}
                      {job.config.exportPacksMaxSize && (
                        <ListItem>
                          <ListItemText
                            primary="Export Pack Size"
                            secondary={job.config.exportPacksMaxSize}
                          />
                        </ListItem>
                      )}
                    </List>
                  </AccordionDetails>
                </Accordion>

                {(() => {
                  const executedCommands = extractExecutedCommands();
                  return executedCommands.length > 0 ? (
                    <Accordion defaultExpanded>
                      <AccordionSummary expandIcon={<ExpandMore />}>
                        <Typography>Executed Commands ({executedCommands.length})</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <List dense>
                          {executedCommands.map((cmd, index) => (
                            <ListItem key={index}>
                              <ListItemText
                                primaryTypographyProps={{ component: 'div' }}
                                secondaryTypographyProps={{ component: 'div' }}
                                primary={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                    <Typography variant="body2" color="text.secondary">
                                      {formatTimestamp(cmd.timestamp)}
                                    </Typography>
                                    <IconButton
                                      size="small"
                                      onClick={() => {
                                        navigator.clipboard.writeText(cmd.command);
                                        setSuccess('Command copied to clipboard!');
                                        setTimeout(() => setSuccess(null), 3000);
                                      }}
                                      sx={{ ml: 'auto' }}
                                    >
                                      <ContentCopy fontSize="small" />
                                    </IconButton>
                                  </Box>
                                }
                                secondary={
                                  <Typography
                                    component="pre"
                                    sx={{
                                      fontFamily: 'monospace',
                                      fontSize: '0.75rem',
                                      bgcolor: 'grey.900',
                                      color: 'white',
                                      p: 1.5,
                                      borderRadius: 1,
                                      overflow: 'auto',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-all',
                                      mt: 1
                                    }}
                                  >
                                    {cmd.command}
                                  </Typography>
                                }
                              />
                            </ListItem>
                          ))}
                        </List>
                      </AccordionDetails>
                    </Accordion>
                  ) : null;
                })()}

                {job.config.queries && job.config.queries.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMore />}>
                      <Typography>SOQL Queries ({job.config.queries.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <List dense>
                        {job.config.queries.map((query, index) => {
                          const queryText = query.query || query.soql_query || '';
                          const queryLabel = query.name ? `${query.name} (Query ${index + 1})` : `Query ${index + 1}`;
                          return (
                            <ListItem key={index}>
                              <ListItemText
                                primary={queryLabel}
                                secondary={queryText}
                                secondaryTypographyProps={{ 
                                  sx: { 
                                    fontFamily: 'monospace', 
                                    fontSize: '0.8rem',
                                    wordBreak: 'break-all'
                                  } 
                                }}
                              />
                            </ListItem>
                          );
                        })}
                      </List>
                    </AccordionDetails>
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Console/Logs */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  Execution Console ({logs.length} logs)
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Tooltip title="View Report Dashboard">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/jobs/${jobType}/${jobId}/report`)}
                        disabled={logs.length === 0}
                        color="primary"
                      >
                        <BarChart />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Download structured report (JSON)">
                    <span>
                      <IconButton
                        size="small"
                        onClick={handleDownloadReport}
                        disabled={logs.length === 0}
                        color="secondary"
                      >
                        <Assessment />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Download logs (TXT)">
                    <span>
                      <IconButton
                        size="small"
                        onClick={handleDownloadLogs}
                        disabled={logs.length === 0}
                        color="primary"
                      >
                        <Download />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Auto-scroll to latest logs">
                    <IconButton
                      size="small"
                      onClick={() => setAutoScroll(!autoScroll)}
                      color={autoScroll ? 'primary' : 'default'}
                    >
                      <Visibility />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Scroll to bottom">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const container = logsContainerRef.current;
                        if (container) {
                          container.scrollTop = container.scrollHeight;
                          userScrolledUpRef.current = false;
                          // Also scroll the end ref if available
                          if (logsEndRef.current) {
                            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
                          }
                        }
                      }}
                      color="default"
                    >
                      <KeyboardArrowDown />
                    </IconButton>
                  </Tooltip>
                  <Chip
                    label={connected ? 'Connected' : 'Disconnected'}
                    color={connected ? 'success' : 'error'}
                    size="small"
                  />
                  <Chip
                    label={`${logs.length} total / ${filteredLogs.length} filtered / ${displayedLogs.length} shown`}
                    color="default"
                    size="small"
                  />
                </Box>
              </Box>

              {/* Log Filter Controls */}
              {logs.length > 0 && (
                <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <TextField
                    size="small"
                    placeholder="Search logs..."
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Search />
                        </InputAdornment>
                      ),
                      endAdornment: logFilter ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setLogFilter('')}>
                            <Clear />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    }}
                    sx={{ minWidth: 200, flexGrow: 1 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Level</InputLabel>
                    <Select
                      value={logLevelFilter}
                      label="Level"
                      onChange={(e) => setLogLevelFilter(e.target.value)}
                    >
                      <MenuItem value="all">All Levels</MenuItem>
                      <MenuItem value="error">Errors</MenuItem>
                      <MenuItem value="warn">Warnings</MenuItem>
                      <MenuItem value="info">Info</MenuItem>
                      <MenuItem value="debug">Debug</MenuItem>
                    </Select>
                  </FormControl>
                  {filteredLogs.length > visibleLogCount && (
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        Showing last {visibleLogCount} of {filteredLogs.length}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setVisibleLogCount(prev => Math.min(prev + 500, filteredLogs.length))}
                      >
                        Load More
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setVisibleLogCount(filteredLogs.length)}
                        disabled={visibleLogCount >= filteredLogs.length}
                      >
                        Show All
                      </Button>
                    </Box>
                  )}
                </Box>
              )}

              <Paper
                ref={logsContainerRef}
                sx={{
                  height: '500px',
                  overflow: 'auto',
                  backgroundColor: '#1e1e1e',
                  color: '#ffffff',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  p: 2,
                }}
              >
                {logs.length === 0 ? (
                  <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
                    No logs available yet. Start the job to see execution logs.
                    <br />
                    <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                      WebSocket: {connected ? 'Connected ✓' : 'Disconnected ✗'}
                    </Typography>
                  </Typography>
                ) : filteredLogs.length === 0 ? (
                  <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
                    No logs match your filters. Try adjusting your search criteria.
                  </Typography>
                ) : (
                  displayedLogs.map((log, index) => {
                    const actualIndex = filteredLogs.length > visibleLogCount 
                      ? filteredLogs.length - displayedLogs.length + index 
                      : index;
                    return (
                    <Box
                      key={getLogKey(log, actualIndex)}
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        mb: 0.5,
                        pb: 0.5,
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        },
                      }}
                    >
                      <Box
                        sx={{
                          minWidth: '4px',
                          height: '100%',
                          backgroundColor: log.level === 'error' ? '#f44336' :
                                         log.level === 'warn' ? '#ff9800' :
                                         log.level === 'info' ? '#2196f3' : '#4caf50',
                          mr: 1.5,
                        }}
                      />
                      <Typography
                        component="span"
                        sx={{
                          color: '#666',
                          fontSize: '0.7rem',
                          minWidth: '140px',
                          mr: 2,
                          fontFamily: 'monospace',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-US', {
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          fractionalSecondDigits: 3
                        }) : ''}
                      </Typography>
                      <Typography
                        component="pre"
                        sx={{
                          color: log.level === 'error' ? '#ff6b6b' :
                                log.level === 'warn' ? '#ffa726' :
                                log.level === 'info' ? '#90caf9' : '#81c784',
                          flexGrow: 1,
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          lineHeight: 1.5,
                        }}
                      >
                        {/* eslint-disable-next-line no-control-regex */}
                        {log.message ? log.message.replace(/\x1b\[[0-9;]*m/g, '') : ''}
                      </Typography>
                    </Box>
                    );
                  })
                )}
                {filteredLogs.length > visibleLogCount && (
                  <Box sx={{ textAlign: 'center', mt: 2, mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      Showing last {visibleLogCount} of {filteredLogs.length} filtered logs
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setVisibleLogCount(prev => Math.min(prev + 500, filteredLogs.length))}
                      sx={{ mt: 1 }}
                    >
                      Load More ({Math.min(500, filteredLogs.length - visibleLogCount)} remaining)
                    </Button>
                  </Box>
                )}
                <div ref={logsEndRef} />
              </Paper>
            </CardContent>
          </Card>
        </Grid>

        {/* Build Log Analysis — for export and deploy jobs that have completed or failed */}
        {job && ['export', 'deploy'].includes(job.type) && ['completed', 'failed'].includes(job.status) && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Build Log Analysis
                </Typography>
                <BuildLogAnalyzer jobId={job.id} />
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* D5: Rollback Panel */}
        {job && job.type === 'deploy' && ['completed', 'failed'].includes(job.status) && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Rollback</Typography>
                {rollbackLoading ? (
                  <LinearProgress />
                ) : rollbackStatus?.available ? (
                  <Box>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      <Typography variant="body2">
                        <strong>Snapshot available:</strong> {new Date(rollbackStatus.snapshotCreatedAt).toLocaleString()}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Target org:</strong> {rollbackStatus.targetUsername}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Records:</strong> {rollbackStatus.totalRecords} across {rollbackStatus.types.join(', ')}
                      </Typography>
                    </Alert>
                    <Button
                      variant="outlined"
                      color="warning"
                      onClick={() => setRollbackConfirmOpen(true)}
                      disabled={rollbackInProgress}
                    >
                      {rollbackInProgress ? 'Rolling back...' : 'Rollback to Pre-Deploy State'}
                    </Button>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No rollback snapshot available for this deploy.
                    {rollbackStatus?.reason && ` (${rollbackStatus.reason})`}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* D4: Post-Deploy Validation Results */}
        {job && job.type === 'deploy' && job.result?.postValidationResult && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Post-Deploy Validation
                </Typography>
                {(() => {
                  const vr = job.result.postValidationResult;
                  const passed = vr.passedCount || 0;
                  const failed = vr.failedCount || 0;
                  const total = passed + failed;
                  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
                  return (
                    <Box>
                      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        <Chip label={`${passed} passed`} color="success" variant="outlined" size="small" />
                        <Chip label={`${failed} failed`} color={failed > 0 ? 'error' : 'default'} variant="outlined" size="small" />
                        <Chip label={`${pct}% success rate`} color={pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'error'} size="small" />
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        color={pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'error'}
                        sx={{ mb: 1 }}
                      />
                      {vr.errors && vr.errors.length > 0 && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                          {vr.errors.slice(0, 3).map((e, i) => (
                            <Typography key={i} variant="caption" display="block">{typeof e === 'string' ? e : JSON.stringify(e)}</Typography>
                          ))}
                          {vr.errors.length > 3 && <Typography variant="caption">…and {vr.errors.length - 3} more</Typography>}
                        </Alert>
                      )}
                    </Box>
                  );
                })()}
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Run Job Dialog */}
      <Dialog open={runDialogOpen} onClose={() => setRunDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Run Job</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Select Org</InputLabel>
              <Select
                value={selectedOrg}
                label="Select Org"
                onChange={(e) => setSelectedOrg(e.target.value)}
              >
                {Array.isArray(orgs) && orgs.map((org) => (
                  <MenuItem key={org.username} value={org.username}>
                    {org.alias || org.username} ({org.username})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Select the Salesforce org where you want to run this job
            </Typography>

            {job?.type === 'deploy' && (
              <Box sx={{ mt: 2.5, p: 1.5, bgcolor: 'warning.light', borderRadius: 1, border: '1px solid', borderColor: 'warning.main' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={useSequentialDeploy}
                      onChange={e => setUseSequentialDeploy(e.target.checked)}
                      color="warning"
                    />
                  }
                  label={<Typography variant="subtitle2" fontWeight="bold">Use Standard Sequential Deployment Order</Typography>}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                  Deploys all 27 object types in the strict dependency sequence. Prevents cross-reference errors in complex org migrations.
                </Typography>
                {useSequentialDeploy && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Sequential mode ignores standard deploy command settings. Progress streams via WebSocket for all 27 steps.
                  </Alert>
                )}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRunDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleConfirmRun} 
            variant="contained" 
            color="primary"
            disabled={!selectedOrg}
            startIcon={<PlayArrow />}
          >
            Run Job
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        severity={confirmDialog.severity || 'warning'}
        confirmText={confirmDialog.severity === 'error' ? 'Delete' : 'Confirm'}
        cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ open: false, title: '', message: '', onConfirm: null })}
      />

      {/* D5: Rollback Confirmation Dialog */}
      <Dialog open={rollbackConfirmOpen} onClose={() => setRollbackConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm Rollback</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will restore the target org <strong>{rollbackStatus?.targetUsername}</strong> to its
            state before this deploy. All changes made by the deploy will be overwritten.
          </Alert>
          {rollbackStatus?.types && (
            <Typography variant="body2">
              <strong>Types to restore:</strong> {rollbackStatus.types.join(', ')}
            </Typography>
          )}
          <Typography variant="body2" sx={{ mt: 1 }}>
            <strong>Snapshot date:</strong> {rollbackStatus?.snapshotCreatedAt ? new Date(rollbackStatus.snapshotCreatedAt).toLocaleString() : 'Unknown'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackConfirmOpen(false)} disabled={rollbackInProgress}>Cancel</Button>
          <Button
            onClick={handleRollback}
            variant="contained"
            color="warning"
            disabled={rollbackInProgress}
          >
            {rollbackInProgress ? 'Rolling back...' : 'Confirm Rollback'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobDetails;
