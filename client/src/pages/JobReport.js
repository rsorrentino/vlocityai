import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Divider,
  LinearProgress,
  TextField,
  InputAdornment,
  TablePagination,
  IconButton,
  Collapse,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
} from '@mui/material';
import {
  ArrowBack,
  Download,
  CheckCircle,
  Error,
  Warning,
  Assessment,
  FolderOpen,
  Search,
  Clear,
  ExpandMore,
  ExpandLess,
  ContentCopy,
  Analytics,
  Code,
} from '@mui/icons-material';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import axios from 'axios';
import ScrollToTop from '../components/ScrollToTop';

const JobReport = () => {
  const { jobId, jobType } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [job, setJob] = useState(null);
  const [reportData, setReportData] = useState(null);
  
  // Errors section state
  const [errorSearch, setErrorSearch] = useState('');
  const [errorPage, setErrorPage] = useState(0);
  const [errorRowsPerPage, setErrorRowsPerPage] = useState(25);
  const [errorGroupBy, setErrorGroupBy] = useState('none');
  const [expandedErrorGroups, setExpandedErrorGroups] = useState({});
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  
  // Success/Files section state
  const [fileSearch, setFileSearch] = useState('');
  const [filePage, setFilePage] = useState(0);
  const [fileRowsPerPage, setFileRowsPerPage] = useState(25);
  const [fileGroupBy, setFileGroupBy] = useState('directory');
  const [successExpanded, setSuccessExpanded] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [summaryPage, setSummaryPage] = useState(0);
  const [summaryRowsPerPage, setSummaryRowsPerPage] = useState(25);
  const [expandedTypeStatsRows, setExpandedTypeStatsRows] = useState({});
  
  // Error analysis state
  const [errorAnalysis, setErrorAnalysis] = useState(null);
  const [analyzingErrors, setAnalyzingErrors] = useState(false);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Org instance URL for generating Salesforce record links
  const [orgInstanceUrl, setOrgInstanceUrl] = useState(null);

  const fetchJobData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch job details
      const jobResponse = await axios.get(`/api/jobs/${jobId}`);
      setJob(jobResponse.data.job);

      // Fetch first 5000 logs for error/file analysis
      const logsResponse = await axios.get(`/api/jobs/${jobId}/logs?limit=5000`);
      const logs = logsResponse.data.logs || [];

      // Also fetch the tail to capture final summary lines (Success >>, Elapsed Time >>, etc.)
      // Large jobs have far more than 5000 log entries; the Vlocity CLI prints its totals at the very end
      let tailLogs = [];
      try {
        const tailResponse = await axios.get(`/api/jobs/${jobId}/logs?tail=500`);
        tailLogs = tailResponse.data.logs || [];
      } catch (e) {
        // best-effort: report still works, just may show intermediate metric values
      }

      // Generate structured report
      const structuredInfo = extractStructuredInfo(jobResponse.data.job, logs, tailLogs);
      setReportData(structuredInfo);

      // Fetch instance URL for generating Salesforce record links (best-effort)
      const jobUsername = jobResponse.data.job?.username;
      if (jobUsername) {
        try {
          const orgResp = await axios.post('/api/orgs/test-connection', { username: jobUsername });
          if (orgResp.data?.orgInfo?.instanceUrl) {
            setOrgInstanceUrl(orgResp.data.orgInfo.instanceUrl.replace(/\/$/, ''));
          }
        } catch (e) {
          // non-fatal — links just won't be shown
        }
      }
      
      setError(null);
    } catch (err) {
      console.error('Error fetching job data:', err);
      setError(err.response?.data?.error || 'Failed to load job data');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJobData();
  }, [fetchJobData]);

  const extractStructuredInfo = (jobData, logsData, tailLogs = []) => {
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (str) => str ? str.replace(/\x1b\[[0-9;]*m/g, '') : '';
    
    const info = {
      job: {
        name: jobData?.name,
        type: jobData?.type,
        status: jobData?.status,
        startedAt: jobData?.startedAt,
        completedAt: jobData?.completedAt,
        duration: jobData?.duration,
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
      typeStats: {}, // Statistics by DataPack type: { [type]: { exported, success, error, files } }
    };

    // Pre-pass: identify log indices that belong to ignorable error blocks.
    // DUPLICATE_DEVELOPER_NAME means the custom metadata record already exists in the target
    // org — it is not a real failure, and inflates the error count / report noise.
    const suppressedIndices = new Set();
    {
      let blockStart = -1;
      let blockHasDuplicateDevName = false;
      logsData.forEach((log, index) => {
        const msg = stripAnsi(log.message || '').trim();
        if (/^Create Failed\s*>>\s*\[/.test(msg)) {
          blockStart = index;
          blockHasDuplicateDevName = false;
        }
        if (blockStart >= 0 && msg.includes('DUPLICATE_DEVELOPER_NAME')) {
          blockHasDuplicateDevName = true;
        }
        if (blockStart >= 0 && msg === ']') {
          if (blockHasDuplicateDevName) {
            for (let i = blockStart; i <= index; i++) suppressedIndices.add(i);
          }
          blockStart = -1;
          blockHasDuplicateDevName = false;
        }
        // Standalone DUPLICATE_DEVELOPER_NAME line (no outer Create Failed block)
        if (blockStart === -1 && msg.includes('DUPLICATE_DEVELOPER_NAME')) {
          suppressedIndices.add(index);
        }
      });
    }

    logsData.forEach((log, index) => {
      if (suppressedIndices.has(index)) return;

      const message = stripAnsi(log.message || '');

      // Extract metrics - capture the LATEST value for each metric
      const retrievedMatch = message.match(/Retrieved\s+(\d+)\s+items?/i);
      if (retrievedMatch) {
        const value = parseInt(retrievedMatch[1]);
        if (value > (info.execution.itemsRetrieved || 0)) {
          info.execution.itemsRetrieved = value;
        }
      }
      
      // Match patterns like "Exporting X items", "Exported X items", etc.
      const exportingMatch = message.match(/(?:Exporting|Exported)\s+(\d+)\s+items?/i);
      if (exportingMatch) {
        const value = parseInt(exportingMatch[1]);
        if (value > (info.execution.itemsExported || 0)) {
          info.execution.itemsExported = value;
        }
      }
      
      // Match "X Completed" or "Completed: X" patterns
      const completedMatch = message.match(/(?:^|\s)(\d+)\s+Completed|Completed[:\s]+(\d+)/i);
      if (completedMatch) {
        const value = parseInt(completedMatch[1] || completedMatch[2]);
        if (value > (info.execution.completed || 0)) {
          info.execution.completed = value;
        }
      }
      
      // Match "Success >> X" or "Success: X" patterns
      const successMatch = message.match(/Success\s*(?:>>|:)\s*(\d+)/i);
      if (successMatch) {
        const value = parseInt(successMatch[1]);
        if (value > (info.execution.success || 0)) {
          info.execution.success = value;
        }
      }
      
      const elapsedMatch = message.match(/Elapsed Time\s*(?:>>|:)\s*(\d+m\s+\d+s)/i);
      if (elapsedMatch) info.execution.elapsedTime = elapsedMatch[1];
      
      // Extract files
      const fileMatch = message.match(/Creating file >>\s+(.+)/i);
      if (fileMatch) {
        const filePath = fileMatch[1].trim();
        info.files.push(filePath);
        
        // Extract type from file path (e.g., export/SObject_Attribute/item/item_DataPack.json -> SObject_Attribute)
        // Pattern: export/{type}/... or just {type}/...
        const typeMatch = filePath.match(/(?:export[/\\])?([^/\\]+)[/\\]/);
        if (typeMatch) {
          const type = typeMatch[1];
          if (!info.typeStats) info.typeStats = {};
          if (!info.typeStats[type]) {
            info.typeStats[type] = { exported: 0, success: 0, error: 0, files: [] };
          }
          info.typeStats[type].exported++;
          info.typeStats[type].success++;
          info.typeStats[type].files.push(filePath);
        }
      }
      
      // Count errors and warnings
      if (log.level === 'error' || message.toLowerCase().includes('error')) {
        info.execution.errors++;
        const errorEntry = {
          timestamp: log.timestamp,
          message: message
        };
        info.errors.push(errorEntry);
        
        // Try to associate error with a type based on file paths in the error message
        if (info.typeStats && message) {
          // Look for type in error message (e.g., "SObject_Attribute", "OmniScript")
          const typePatterns = Object.keys(info.typeStats);
          for (const type of typePatterns) {
            if (message.includes(type) || message.match(new RegExp(`${type.replace(/_/g, '[\\s_]')}`, 'i'))) {
              info.typeStats[type].error++;
              // Adjust success count if we find an error for this type
              if (info.typeStats[type].success > 0) {
                info.typeStats[type].success--;
              }
              break;
            }
          }
        }
      }
      
      if (log.level === 'warn' || message.toLowerCase().includes('warning')) {
        info.execution.warnings++;
        info.warnings.push({
          timestamp: log.timestamp,
          message: message
        });
      }
    });

    // Second pass: extract final summary metrics from tail logs.
    // The Vlocity CLI prints totals (Success >>, Remaining >>, Elapsed Time >>) at the very
    // end of the log. On large jobs these lines fall beyond the first-5000 limit, so we
    // re-scan the tail to get the definitive numbers (without re-counting files/errors).
    tailLogs.forEach(log => {
      const msg = stripAnsi(log.message || '');
      const rM = msg.match(/Retrieved\s+(\d+)\s+items?/i);
      if (rM) { const v = parseInt(rM[1]); if (v > (info.execution.itemsRetrieved || 0)) info.execution.itemsRetrieved = v; }
      const eM = msg.match(/(?:Exporting|Exported)\s+(\d+)\s+items?/i);
      if (eM) { const v = parseInt(eM[1]); if (v > (info.execution.itemsExported || 0)) info.execution.itemsExported = v; }
      const cM = msg.match(/(?:^|\s)(\d+)\s+Completed|Completed[:\s]+(\d+)/i);
      if (cM) { const v = parseInt(cM[1] || cM[2]); if (v > (info.execution.completed || 0)) info.execution.completed = v; }
      const sM = msg.match(/Success\s*(?:>>|:)\s*(\d+)/i);
      if (sM) { const v = parseInt(sM[1]); if (v > (info.execution.success || 0)) info.execution.success = v; }
      const tM = msg.match(/Elapsed Time\s*(?:>>|:)\s*(\d+m\s+\d+s)/i);
      if (tM) info.execution.elapsedTime = tM[1];
    });

    return info;
  };

  const handleDownloadReport = () => {
    if (!reportData) return;

    try {
      const reportContent = JSON.stringify(reportData, null, 2);
      const blob = new Blob([reportContent], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const filename = `${job?.name?.replace(/[^a-z0-9]/gi, '_')}_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.download = filename;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download report');
    }
  };

  const handleAnalyzeErrors = async () => {
    if (!job || !job.username) {
      setError('Job username is required for error analysis');
      return;
    }
    
    setAnalyzingErrors(true);
    try {
      const response = await axios.post(`/api/jobs/${jobId}/errors/analyze`, {
        username: job.username
      });
      
      if (response.data.analyzed) {
        setErrorAnalysis(response.data);
        setAnalysisDialogOpen(true);
      } else {
        setError(response.data.message || 'No errors found to analyze');
      }
    } catch (err) {
      console.error('Error analyzing errors:', err);
      setError(err.response?.data?.error?.message || 'Failed to analyze errors');
    } finally {
      setAnalyzingErrors(false);
    }
  };

  const handleCopyQuery = (query) => {
    navigator.clipboard.writeText(query);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleExportErrorsCSV = () => {
    if (!reportData || !reportData.errors || reportData.errors.length === 0) return;

    try {
      const headers = ['Timestamp', 'Message'];
      const rows = reportData.errors.map(error => [
        error.timestamp || '',
        error.message || ''
      ]);

      // Convert to CSV format with proper escaping
      const csvContent = [
        headers.map(h => `"${h}"`).join(','),
        ...rows.map(row => 
          row.map(field => {
            // Escape quotes and wrap in quotes
            const escaped = String(field).replace(/"/g, '""');
            return `"${escaped}"`;
          }).join(',')
        )
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const filename = `${job?.name?.replace(/[^a-z0-9]/gi, '_')}_errors_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      link.download = filename;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to export errors to CSV');
    }
  };

  // Combined execution metrics with errors/warnings
  const combinedChartData = useMemo(() => {
    if (!reportData) return [];
    
    const exec = reportData.execution;
    
    /**
     * Simplified Execution Metrics:
     * 
     * - Retrieved: Total items found in Salesforce queries
     * - Success: Items successfully exported and saved as files
     * - Failed: Items that were processed but failed (calculated as: retrieved - success, or completed - success if completed exists)
     * - Errors: Number of error log entries (different from failed items - one item can generate multiple errors)
     * - Warnings: Number of warning log entries
     * 
     * Note: "Exported" and "Completed" are redundant with "Retrieved" and "Success"
     * We simplify to: Retrieved → Success/Failed, plus Error/Warning counts
     */
    const retrieved = exec.itemsRetrieved || exec.itemsExported || exec.completed || 0;
    const success = exec.success || 0;
    const completed = exec.completed || retrieved;
    const failed = completed > 0 && success >= 0 ? Math.max(0, completed - success) : 0;
    const errors = reportData.errors.length;
    const warnings = reportData.execution.warnings || 0;
    
    // Combine execution metrics with errors/warnings
    const metrics = [];
    
    // Professional color palette
    if (retrieved > 0) metrics.push({ name: 'Retrieved', value: retrieved, type: 'metric', color: '#1976d2' }); // Material Blue 700
    if (success > 0) metrics.push({ name: 'Success', value: success, type: 'metric', color: '#4caf50' }); // Material Green 500
    if (failed > 0) metrics.push({ name: 'Failed', value: failed, type: 'error', color: '#ef5350' }); // Material Red 400
    
    // Issues - using Material Design error/warning colors
    if (errors > 0) metrics.push({ name: 'Errors', value: errors, type: 'error', color: '#d32f2f' }); // Material Red 700
    if (warnings > 0) metrics.push({ name: 'Warnings', value: warnings, type: 'warning', color: '#ed6c02' }); // Material Orange 700
    
    return metrics;
  }, [reportData]);

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'success';
      case 'running': return 'info';
      case 'failed': return 'error';
      case 'cancelled': return 'warning';
      default: return 'default';
    }
  };

  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  // Convert "554m 55s" → "9h 14m 55s"
  const formatElapsedTime = (elapsed) => {
    if (!elapsed) return 'N/A';
    const m = elapsed.match(/(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i);
    if (!m) return elapsed;
    const hours = parseInt(m[1] || 0);
    const mins  = parseInt(m[2] || 0);
    const secs  = parseInt(m[3] || 0);
    const totalMins = hours * 60 + mins;
    const h = Math.floor(totalMins / 60);
    const remainMins = totalMins % 60;
    if (h > 0) return `${h}h ${remainMins}m ${secs}s`;
    if (remainMins > 0) return `${remainMins}m ${secs}s`;
    return `${secs}s`;
  };

  const successRate = useMemo(() => {
    if (!reportData) return 0;
    const exec = reportData.execution;
    
    /**
     * Success Rate Calculation:
     * Success Rate = (Successfully Completed Items / Total Completed Items) * 100
     * 
     * IMPORTANT: Errors reduce success rate. If errors exist, we cannot have 100% success.
     * 
     * The hierarchy for determining totals:
     * 1. Use 'completed' count (items that finished processing) as denominator
     * 2. Fallback to 'itemsExported' (items that started export)
     * 3. Fallback to 'itemsRetrieved' (items retrieved from Salesforce)
     * 
     * Numerator: Use 'success' count (successfully completed items)
     * If errors exist and no success count, adjust calculation to account for errors
     */
    const totalCompleted = exec.completed || exec.itemsExported || exec.itemsRetrieved || 0;
    let successful = exec.success || 0;
    const errorCount = reportData.errors.length;
    
    // If errors exist, they must be accounted for in the success rate
    if (errorCount > 0 && totalCompleted > 0) {
      // If success count is not provided but we have completed count and errors,
      // successful = completed - errors (at minimum)
      if (successful === 0 && totalCompleted >= errorCount) {
        successful = totalCompleted - errorCount;
      }
      // Ensure success count accounts for errors
      if (successful > totalCompleted - errorCount) {
        successful = Math.max(0, totalCompleted - errorCount);
      }
    }
    
    // Special case: If no completion metrics but files exist and no errors, assume success
    if (successful === 0 && reportData.files.length > 0 && totalCompleted === 0 && errorCount === 0) {
      return 100;
    }
    
    // Normal calculation: (successful / total completed) * 100
    if (totalCompleted > 0 && successful >= 0) {
      // Ensure success doesn't exceed total (data integrity)
      if (successful > totalCompleted) {
        successful = totalCompleted;
      }
      const rate = Math.round((successful / totalCompleted) * 100);
      // Ensure we never show 100% if errors exist
      return errorCount > 0 && rate === 100 ? 99 : rate;
    }
    
    return 0;
  }, [reportData]);

  // Helper functions for Errors section
  const filteredErrors = useMemo(() => {
    if (!reportData?.errors) return [];
    if (!errorSearch) return reportData.errors;
    const searchLower = errorSearch.toLowerCase();
    return reportData.errors.filter(error =>
      error.message.toLowerCase().includes(searchLower) ||
      (error.timestamp && new Date(error.timestamp).toLocaleString().toLowerCase().includes(searchLower))
    );
  }, [reportData?.errors, errorSearch]);

  const groupedErrors = useMemo(() => {
    if (errorGroupBy === 'none') {
      return { 'All Errors': filteredErrors };
    }
    
    const groups = {};
    filteredErrors.forEach(error => {
      let groupKey = 'Other';
      
      if (errorGroupBy === 'message') {
        // Group by error message (first 50 chars)
        groupKey = error.message.substring(0, 50).trim() || 'Empty Message';
      } else if (errorGroupBy === 'timestamp') {
        // Group by date
        if (error.timestamp) {
          const date = new Date(error.timestamp);
          groupKey = date.toLocaleDateString();
        } else {
          groupKey = 'No Timestamp';
        }
      }
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(error);
    });
    
    return groups;
  }, [filteredErrors, errorGroupBy]);

  const paginatedErrors = useMemo(() => {
    const allErrors = Object.values(groupedErrors).flat();
    const start = errorPage * errorRowsPerPage;
    const end = start + errorRowsPerPage;
    return allErrors.slice(start, end);
  }, [groupedErrors, errorPage, errorRowsPerPage]);

  // Helper functions for Files/Success section
  const filteredFiles = useMemo(() => {
    if (!reportData?.files) return [];
    if (!fileSearch) return reportData.files;
    const searchLower = fileSearch.toLowerCase();
    return reportData.files.filter(file => file.toLowerCase().includes(searchLower));
  }, [reportData?.files, fileSearch]);

  // Build hierarchical folder tree structure
  const fileTree = useMemo(() => {
    if (fileGroupBy !== 'directory') {
      // For non-directory grouping, return flat structure
      const groups = {};
      filteredFiles.forEach(file => {
        let groupKey = 'Other';
        
        if (fileGroupBy === 'extension') {
          const match = file.match(/\.([^.]+)$/);
          groupKey = match ? match[1].toUpperCase() : 'No Extension';
        } else {
          groupKey = 'All Files';
        }
        
        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }
        groups[groupKey].push(file);
      });
      return groups;
    }

    // Build hierarchical tree structure
    const tree = {
      name: 'Root',
      path: '',
      children: {},
      files: []
    };

    filteredFiles.forEach(file => {
      // Normalize path and split
      const normalizedPath = file.replace(/\\/g, '/');
      const pathParts = normalizedPath.split('/').filter(part => part.trim() !== '');
      
      if (pathParts.length === 0) {
        tree.files.push(file);
        return;
      }

      // Filename is the last part (not used, but kept for clarity)
      // const fileName = pathParts[pathParts.length - 1];
      const dirParts = pathParts.slice(0, -1);

      // Navigate/create tree structure
      let currentNode = tree;
      let currentPath = '';

      dirParts.forEach((dirName, index) => {
        currentPath = currentPath ? `${currentPath}/${dirName}` : dirName;
        
        if (!currentNode.children[currentPath]) {
          currentNode.children[currentPath] = {
            name: dirName,
            path: currentPath,
            children: {},
            files: []
          };
        }
        currentNode = currentNode.children[currentPath];
      });

      // Add file to the current node
      currentNode.files.push(file);
    });

    // Count files recursively
    const countFiles = (node) => {
      let count = node.files.length;
      Object.values(node.children).forEach(child => {
        count += countFiles(child);
      });
      node.totalCount = count;
      return count;
    };
    countFiles(tree);

    return tree;
  }, [filteredFiles, fileGroupBy]);

  // Convert tree to flat groups for non-directory mode or flat display
  const groupedFiles = useMemo(() => {
    if (fileGroupBy !== 'directory') {
      return fileTree;
    }
    
    // For directory mode, we'll use the tree structure directly in rendering
    return {};
  }, [fileTree, fileGroupBy]);

  const toggleFolder = (folderPath) => {
    setExpandedFolders(prev => {
      const isCurrentlyExpanded = prev[folderPath] === true;
      const newState = { ...prev };
      
      if (isCurrentlyExpanded) {
        // Collapse this folder and all its children
        // Remove this folder's expansion state
        newState[folderPath] = false;
        
        // Collapse all folders that start with this path (children)
        Object.keys(prev).forEach(path => {
          // Check if path is a child (starts with folderPath + '/' or '\')
          if (path !== folderPath && 
              (path.startsWith(folderPath + '/') || path.startsWith(folderPath + '\\'))) {
            newState[path] = false;
          }
        });
      } else {
        // Just expand this folder (don't expand children automatically)
        newState[folderPath] = true;
      }
      
      return newState;
    });
  };


  /**
   * Render an error message with Salesforce IDs highlighted and linked.
   * Detects patterns like:
   *   - "SObject/Id: 01t8s00000A8ZPRAA3"
   *   - "orgUrl: /01t8s00000A8ZPRAA3"
   *   - Standalone 15/18-char Salesforce IDs
   */
  const renderErrorMessage = (message) => {
    if (!message) return null;

    // Extract IDs only from known Vlocity error contexts to avoid false positives:
    //   "SObject/Id: a439r000001HdsRAAS"
    //   "orgUrl: /a439r000001HdsRAAS"
    const CONTEXT_RE = /(?:SObject\/Id:\s*|orgUrl:\s*\/)([A-Za-z0-9]{15,18})/gi;

    // The orgUrl gives us the record path to build a link
    const orgUrlMatch = message.match(/orgUrl:\s*\/([A-Za-z0-9]{15,18})/i);
    const orgUrlId = orgUrlMatch ? orgUrlMatch[1] : null;

    const foundIds = new Set();
    let m;
    CONTEXT_RE.lastIndex = 0;
    while ((m = CONTEXT_RE.exec(message)) !== null) {
      foundIds.add(m[1]);
    }

    if (foundIds.size === 0) return <span>{message}</span>;

    // Split message on any found ID so we can render each piece
    const escapedIds = [...foundIds].map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const splitRe = new RegExp(`(${escapedIds.join('|')})`, 'g');
    const parts = message.split(splitRe);

    const segments = parts.map((part, i) => {
      if (!foundIds.has(part)) return { type: 'text', value: part, key: i };
      const hasLink = orgUrlId && part === orgUrlId;
      return { type: 'id', value: part, hasLink, key: i };
    });

    return (
      <span>
        {segments.map((seg, i) => {
          if (seg.type === 'text') return <span key={i}>{seg.value}</span>;

          const href = orgInstanceUrl && seg.hasLink
            ? `${orgInstanceUrl}/${seg.value}`
            : null;

          return href ? (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 4,
                backgroundColor: '#e3f2fd',
                color: '#1565c0',
                border: '1px solid #90caf9',
                textDecoration: 'none',
                margin: '0 2px',
              }}
              title={`Open record ${seg.value} in Salesforce`}
            >
              {seg.value}
            </a>
          ) : (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 4,
                backgroundColor: '#fff3e0',
                color: '#e65100',
                border: '1px solid #ffb74d',
                margin: '0 2px',
              }}
            >
              {seg.value}
            </span>
          );
        })}
      </span>
    );
  };

  // Recursive component for rendering folder tree
  const FolderTree = ({ node, level = 0, path = '' }) => {
    const folderPath = path || node.path || 'root';
    const isExpanded = expandedFolders[folderPath] === true; // Default to collapsed
    const hasChildren = Object.keys(node.children || {}).length > 0;
    const hasFiles = (node.files || []).length > 0;

    return (
      <Box>
        {/* Render folder header (skip root level, show its children directly) */}
        {level > 0 && (
          <>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 1,
                pl: (level - 1) * 3,
                bgcolor: level % 2 === 0 ? 'grey.50' : 'grey.100',
                borderRadius: 1,
                cursor: hasChildren || hasFiles ? 'pointer' : 'default',
                '&:hover': {
                  bgcolor: 'action.hover',
                  opacity: 0.8,
                },
                mb: 0.5,
              }}
              onClick={() => {
                if (hasChildren || hasFiles) {
                  toggleFolder(folderPath);
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {hasChildren || hasFiles ? (
                  <IconButton size="small" sx={{ width: 24, height: 24 }}>
                    {isExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                  </IconButton>
                ) : (
                  <Box sx={{ width: 24 }} />
                )}
                <FolderOpen color="action" fontSize="small" />
                <Typography 
                  variant="body2" 
                  sx={{ fontFamily: 'monospace' }}
                >
                  {node.name}
                </Typography>
                <Chip 
                  label={`${node.totalCount || node.files.length} file${(node.totalCount || node.files.length) !== 1 ? 's' : ''}`} 
                  size="small" 
                  color="default"
                />
              </Box>
            </Box>
            
            <Collapse in={isExpanded}>
              <Box sx={{ ml: (level - 1) * 3 }}>
                {/* Render child folders */}
                {hasChildren && Object.values(node.children)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((child) => (
                    <FolderTree key={child.path} node={child} level={level + 1} path={child.path} />
                  ))}
                
                {/* Render files in this folder */}
                {hasFiles && (
                  <Box sx={{ mt: 1 }}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell width="80px">#</TableCell>
                            <TableCell>File Name</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {node.files
                            .sort()
                            .map((file, index) => {
                              const fileName = file.split(/[/\\]/).pop() || file;
                              return (
                                <TableRow key={`${folderPath}-file-${index}`}>
                                  <TableCell>{index + 1}</TableCell>
                                  <TableCell>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                      {fileName}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                      {file}
                                    </Typography>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
              </Box>
            </Collapse>
          </>
        )}
        
        {/* Root level - render children directly without header */}
        {level === 0 && (
          <Box>
            {hasChildren && Object.values(node.children)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((child) => (
                <FolderTree key={child.path} node={child} level={level + 1} path={child.path} />
              ))}
            
            {hasFiles && (
              <Box sx={{ mt: 1 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell width="80px">#</TableCell>
                        <TableCell>File Name</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {node.files
                        .sort()
                        .map((file, index) => {
                          const fileName = file.split(/[/\\]/).pop() || file;
                          return (
                            <TableRow key={`root-file-${index}`}>
                              <TableCell>{index + 1}</TableCell>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                  {fileName}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                  {file}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        )}
      </Box>
    );
  };

  const paginatedFiles = useMemo(() => {
    const allFiles = Object.values(groupedFiles).flat();
    const start = filePage * fileRowsPerPage;
    const end = start + fileRowsPerPage;
    return allFiles.slice(start, end);
  }, [groupedFiles, filePage, fileRowsPerPage]);

  const toggleErrorGroup = (groupKey) => {
    setExpandedErrorGroups(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };


  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !reportData) {
    return (
      <Box>
        <Alert severity="error">{error || 'Failed to load report data'}</Alert>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate(`/jobs/${jobType}/${jobId}`)}
          sx={{ mt: 2 }}
        >
          Back to Job Details
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Job Execution Report
          </Typography>
          <Typography variant="subtitle1" color="text.secondary">
            {reportData.job.name}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<ArrowBack />}
            onClick={() => navigate(`/jobs/${jobType}/${jobId}`)}
          >
            Back
          </Button>
          <Button
            startIcon={<Download />}
            onClick={handleDownloadReport}
            variant="contained"
            color="primary"
          >
            Download JSON
          </Button>
        </Box>
      </Box>

      {/* Job Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 'bold' }}>
                Status
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <Chip
                  label={reportData.job.status || 'Unknown'}
                  color={getStatusColor(reportData.job.status)}
                  size="medium"
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 'bold' }}>
                Duration
              </Typography>
              <Typography variant="h5" sx={{ mt: 0.5 }}>
                {reportData.job.duration
                  ? formatDuration(reportData.job.duration)
                  : formatElapsedTime(reportData.execution.elapsedTime)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 'bold' }}>
                Success Rate
              </Typography>
              <Typography variant="h5" sx={{ mt: 0.5 }}>
                {successRate}%
              </Typography>
              <LinearProgress
                variant="determinate"
                value={successRate}
                sx={{ mt: 1.5, height: 8, borderRadius: 4 }}
                color={successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'error'}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 'bold' }}>
                Items Exported
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Typography variant="h5">
                  {reportData.execution.success || reportData.files.length}
                </Typography>
              </Box>
              {reportData.files.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {reportData.files.length} DataPack files
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Combined Execution Metrics & Issues */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Assessment /> Execution Metrics & Issues
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
                <strong>Retrieved:</strong> Total items found in Salesforce queries → <strong>Success:</strong> Items successfully exported and saved as files.
                <strong>Failed:</strong> Items that were processed but failed. <strong>Errors:</strong> Number of error log entries (one item can generate multiple errors).
              </Typography>
              {combinedChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={combinedChartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="name" 
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      interval={0}
                    />
                    <YAxis />
                    <RechartsTooltip />
                    <Legend />
                    <Bar dataKey="value">
                      {combinedChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  No execution metrics available
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>


      {/* Execution Summary */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Assessment /> Execution Summary
              </Typography>
              <Divider sx={{ my: 2 }} />
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Metric</strong></TableCell>
                      <TableCell align="right"><strong>Count</strong></TableCell>
                      <TableCell align="right"><strong>Percentage</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(() => {
                      const exec = reportData.execution;
                      const retrieved = exec.itemsRetrieved || exec.itemsExported || exec.completed || 0;
                      const success = exec.success || 0;
                      const completed = exec.completed || retrieved;
                      const failed = completed > 0 && success >= 0 ? Math.max(0, completed - success) : 0;
                      const errors = reportData.errors.length;
                      const warnings = reportData.execution.warnings || 0;
                      const totalFiles = reportData.files.length;
                      
                      const metrics = [
                        {
                          label: 'Items Retrieved',
                          value: retrieved,
                          percentage: retrieved > 0 ? 100 : 0,
                          color: 'primary',
                          description: 'Total items found in Salesforce queries'
                        },
                        {
                          label: 'Success',
                          value: success,
                          percentage: (() => {
                            if (retrieved <= 0) return 0;
                            const pct = Math.round((success / retrieved) * 100);
                            // Never show 100% when there are errors — cap at 99%
                            return errors > 0 && pct === 100 ? 99 : pct;
                          })(),
                          color: 'success',
                          description: 'Items successfully exported and saved as files'
                        },
                        {
                          label: 'Failed',
                          value: failed,
                          percentage: retrieved > 0 ? Math.round((failed / retrieved) * 100) : 0,
                          color: 'error',
                          description: 'Items that were processed but failed'
                        },
                        {
                          label: 'Errors',
                          value: errors,
                          percentage: retrieved > 0 && errors > 0
                            ? Math.max(1, Math.round((errors / retrieved) * 100))
                            : 0,
                          color: 'error',
                          description: 'Number of error log entries (different from failed items)'
                        },
                        {
                          label: 'Warnings',
                          value: warnings,
                          percentage: 0,
                          color: 'warning',
                          description: 'Number of warning log entries'
                        },
                        {
                          label: 'Files Generated',
                          value: totalFiles,
                          percentage: 0,
                          color: 'success',
                          description: 'Total DataPack files written to disk (each file may contain multiple items)'
                        }
                      ];
                      
                      return metrics.map((metric, index) => (
                        <TableRow key={index} hover>
                          <TableCell>
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {metric.color === 'success' && <CheckCircle color="success" fontSize="small" />}
                                {metric.color === 'error' && <Error color="error" fontSize="small" />}
                                {metric.color === 'warning' && <Warning color="warning" fontSize="small" />}
                                {(metric.color === 'primary' || metric.color === 'info') && <Assessment color="primary" fontSize="small" />}
                                <Typography variant="body2" fontWeight="medium">{metric.label}</Typography>
                              </Box>
                              {metric.description && (
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 4, display: 'block', mt: 0.5 }}>
                                  {metric.description}
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            <Chip 
                              label={metric.value} 
                              size="small" 
                              color={metric.color}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography 
                              variant="body2" 
                              color={metric.percentage > 0 ? 'text.primary' : 'text.secondary'}
                              sx={{ fontWeight: metric.percentage > 0 ? 'bold' : 'normal' }}
                            >
                              {metric.percentage > 0 ? `${metric.percentage}%` : '-'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Errors Table */}
      {reportData.errors.length > 0 && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12}>
            <Card>
              <Accordion expanded={errorsExpanded} onChange={() => setErrorsExpanded(!errorsExpanded)}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Error color="error" /> Errors ({filteredErrors.length} / {reportData.errors.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <TextField
                        size="small"
                        placeholder="Search errors..."
                      value={errorSearch}
                      onChange={(e) => {
                        setErrorSearch(e.target.value);
                        setErrorPage(0); // Reset to first page on search
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Search />
                          </InputAdornment>
                        ),
                        endAdornment: errorSearch && (
                          <InputAdornment position="end">
                            <IconButton size="small" onClick={() => setErrorSearch('')}>
                              <Clear />
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      sx={{ minWidth: 200 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel>Group By</InputLabel>
                      <Select
                        value={errorGroupBy}
                        label="Group By"
                        onChange={(e) => {
                          setErrorGroupBy(e.target.value);
                          setErrorPage(0);
                          setExpandedErrorGroups({});
                        }}
                      >
                        <MenuItem value="none">None</MenuItem>
                        <MenuItem value="message">Message</MenuItem>
                        <MenuItem value="timestamp">Date</MenuItem>
                      </Select>
                    </FormControl>
                    </Box>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<Analytics />}
                      onClick={handleAnalyzeErrors}
                      disabled={reportData.errors.length === 0 || analyzingErrors}
                      sx={{ mr: 1 }}
                    >
                      {analyzingErrors ? 'Analyzing...' : 'Analyze Errors'}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<Download />}
                      onClick={handleExportErrorsCSV}
                      disabled={reportData.errors.length === 0}
                    >
                      Export Errors (CSV)
                    </Button>
                  </Box>
                
                  {errorGroupBy === 'none' ? (
                  <>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Timestamp</TableCell>
                            <TableCell>Message</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {paginatedErrors.map((error, index) => (
                            <TableRow key={index}>
                              <TableCell>
                                {error.timestamp ? new Date(error.timestamp).toLocaleString() : 'N/A'}
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                  {renderErrorMessage(error.message)}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <TablePagination
                      component="div"
                      count={filteredErrors.length}
                      page={errorPage}
                      onPageChange={(event, newPage) => setErrorPage(newPage)}
                      rowsPerPage={errorRowsPerPage}
                      onRowsPerPageChange={(e) => {
                        setErrorRowsPerPage(parseInt(e.target.value, 10));
                        setErrorPage(0);
                      }}
                      rowsPerPageOptions={[10, 25, 50, 100]}
                    />
                  </>
                ) : (
                  <Box>
                    {Object.entries(groupedErrors).map(([groupKey, errors]) => (
                      <Box key={groupKey} sx={{ mb: 2 }}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            bgcolor: 'grey.100',
                            borderRadius: 1,
                            cursor: 'pointer',
                          }}
                          onClick={() => toggleErrorGroup(groupKey)}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <IconButton size="small">
                              {expandedErrorGroups[groupKey] ? <ExpandLess /> : <ExpandMore />}
                            </IconButton>
                            <Typography variant="subtitle2" fontWeight="bold">
                              {groupKey}
                            </Typography>
                            <Chip label={errors.length} size="small" color="error" />
                          </Box>
                        </Box>
                        <Collapse in={expandedErrorGroups[groupKey] !== false}>
                          <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Timestamp</TableCell>
                                  <TableCell>Message</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {errors.map((error, index) => (
                                  <TableRow key={index}>
                                    <TableCell>
                                      {error.timestamp ? new Date(error.timestamp).toLocaleString() : 'N/A'}
                                    </TableCell>
                                    <TableCell>
                                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                        {renderErrorMessage(error.message)}
                                      </Typography>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Collapse>
                      </Box>
                    ))}
                  </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Warnings Table */}
      {reportData.warnings.length > 0 && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning color="warning" /> Warnings ({reportData.warnings.length})
                  </Typography>
                </Box>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Timestamp</TableCell>
                        <TableCell>Message</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reportData.warnings.slice(0, 10).map((warning, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            {warning.timestamp ? new Date(warning.timestamp).toLocaleString() : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                              {warning.message.substring(0, 200)}
                              {warning.message.length > 200 ? '...' : ''}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {reportData.warnings.length > 10 && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Showing 10 of {reportData.warnings.length} warnings
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Success/Files List */}
      {reportData.files.length > 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Card>
              <Accordion expanded={successExpanded} onChange={() => setSuccessExpanded(!successExpanded)}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CheckCircle color="success" /> Success ({(reportData.execution.success || reportData.files.length).toLocaleString()} items — {filteredFiles.length} / {reportData.files.length} files)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      size="small"
                      placeholder="Search files..."
                      value={fileSearch}
                      onChange={(e) => {
                        setFileSearch(e.target.value);
                        setFilePage(0); // Reset to first page on search
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Search />
                          </InputAdornment>
                        ),
                        endAdornment: fileSearch && (
                          <InputAdornment position="end">
                            <IconButton size="small" onClick={() => setFileSearch('')}>
                              <Clear />
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      sx={{ minWidth: 200 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel>Group By</InputLabel>
                      <Select
                        value={fileGroupBy}
                        label="Group By"
                        onChange={(e) => {
                          setFileGroupBy(e.target.value);
                          setFilePage(0);
                        }}
                      >
                        <MenuItem value="none">None</MenuItem>
                        <MenuItem value="directory">Directory</MenuItem>
                        <MenuItem value="extension">Extension</MenuItem>
                      </Select>
                    </FormControl>
                    </Box>
                  </Box>
                
                  {fileGroupBy === 'none' ? (
                  <>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell width="80px">#</TableCell>
                            <TableCell>File Path</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {paginatedFiles.map((file, index) => {
                            const globalIndex = filePage * fileRowsPerPage + index;
                            return (
                              <TableRow key={`file-${globalIndex}`}>
                                <TableCell>{globalIndex + 1}</TableCell>
                                <TableCell>
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                    {file}
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <TablePagination
                      component="div"
                      count={filteredFiles.length}
                      page={filePage}
                      onPageChange={(event, newPage) => setFilePage(newPage)}
                      rowsPerPage={fileRowsPerPage}
                      onRowsPerPageChange={(e) => {
                        setFileRowsPerPage(parseInt(e.target.value, 10));
                        setFilePage(0);
                      }}
                      rowsPerPageOptions={[10, 25, 50, 100]}
                    />
                  </>
                ) : fileGroupBy === 'directory' ? (
                  <Box>
                    {/* Detailed Folder Structure as Table */}
                    {reportData.typeStats && Object.keys(reportData.typeStats).length > 0 && (
                      <Box>
                        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                          Detailed Folder Structure ({Object.keys(reportData.typeStats).length} types)
                        </Typography>
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell width="50px"></TableCell>
                                <TableCell><strong>DataPack Type</strong></TableCell>
                                <TableCell align="right"><strong>Exported</strong></TableCell>
                                <TableCell align="right"><strong>Success</strong></TableCell>
                                <TableCell align="right"><strong>Error</strong></TableCell>
                                <TableCell align="right"><strong>Success Rate</strong></TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(() => {
                                const sortedTypes = Object.entries(reportData.typeStats)
                                  .sort(([typeA], [typeB]) => typeA.localeCompare(typeB));
                                const paginatedTypes = sortedTypes.slice(
                                  summaryPage * summaryRowsPerPage,
                                  (summaryPage + 1) * summaryRowsPerPage
                                );
                                
                                return paginatedTypes.map(([type, stats]) => {
                                  const successRate = stats.exported > 0 
                                    ? Math.round((stats.success / stats.exported) * 100) 
                                    : 0;
                                  const isExpanded = expandedTypeStatsRows[type] === true;
                                  const files = stats.files || [];
                                  
                                  return (
                                    <React.Fragment key={type}>
                                      <TableRow hover sx={{ cursor: files.length > 0 ? 'pointer' : 'default' }}>
                                        <TableCell>
                                          {files.length > 0 && (
                                            <IconButton 
                                              size="small" 
                                              onClick={() => {
                                                setExpandedTypeStatsRows(prev => ({
                                                  ...prev,
                                                  [type]: !prev[type]
                                                }));
                                              }}
                                            >
                                              {isExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                            </IconButton>
                                          )}
                                        </TableCell>
                                        <TableCell onClick={() => {
                                          if (files.length > 0) {
                                            setExpandedTypeStatsRows(prev => ({
                                              ...prev,
                                              [type]: !prev[type]
                                            }));
                                          }
                                        }}>
                                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'medium' }}>
                                            {type}
                                          </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                          <Chip label={stats.exported} size="small" color="primary" variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                          <Chip label={stats.success} size="small" color="success" variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                          <Chip label={stats.error} size="small" color={stats.error > 0 ? 'error' : 'default'} variant="outlined" />
                                        </TableCell>
                                        <TableCell align="right">
                                          <Typography 
                                            variant="body2" 
                                            color={successRate >= 90 ? 'success.main' : successRate >= 70 ? 'warning.main' : 'error.main'}
                                            sx={{ fontWeight: 'bold' }}
                                          >
                                            {successRate}%
                                          </Typography>
                                        </TableCell>
                                      </TableRow>
                                      {isExpanded && files.length > 0 && (
                                        <TableRow>
                                          <TableCell colSpan={6} sx={{ py: 0, border: 'none' }}>
                                            <Collapse in={isExpanded}>
                                              <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                                                <Typography variant="caption" fontWeight="bold" sx={{ mb: 1, display: 'block' }}>
                                                  Files for {type} ({files.length}):
                                                </Typography>
                                                <Table size="small">
                                                  <TableHead>
                                                    <TableRow>
                                                      <TableCell width="60px">#</TableCell>
                                                      <TableCell>File Path</TableCell>
                                                    </TableRow>
                                                  </TableHead>
                                                  <TableBody>
                                                    {files.map((file, fileIndex) => (
                                                      <TableRow key={`file-${type}-${fileIndex}`}>
                                                        <TableCell>{fileIndex + 1}</TableCell>
                                                        <TableCell>
                                                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                                            {file}
                                                          </Typography>
                                                        </TableCell>
                                                      </TableRow>
                                                    ))}
                                                  </TableBody>
                                                </Table>
                                              </Box>
                                            </Collapse>
                                          </TableCell>
                                        </TableRow>
                                      )}
                                    </React.Fragment>
                                  );
                                });
                              })()}
                            </TableBody>
                          </Table>
                        </TableContainer>
                        <TablePagination
                          component="div"
                          count={Object.keys(reportData.typeStats).length}
                          page={summaryPage}
                          onPageChange={(event, newPage) => setSummaryPage(newPage)}
                          rowsPerPage={summaryRowsPerPage}
                          onRowsPerPageChange={(e) => {
                            setSummaryRowsPerPage(parseInt(e.target.value, 10));
                            setSummaryPage(0);
                          }}
                          rowsPerPageOptions={[10, 25, 50, 100]}
                        />
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Box>
                    {Object.entries(groupedFiles)
                      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
                      .map(([groupKey, files]) => (
                      <Box key={groupKey} sx={{ mb: 2 }}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            bgcolor: 'success.light',
                            borderRadius: 1,
                            opacity: 0.8,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FolderOpen color="success" />
                            <Typography variant="subtitle2" fontWeight="bold" sx={{ fontFamily: 'monospace' }}>
                              {groupKey}
                            </Typography>
                            <Chip label={`${files.length} file${files.length !== 1 ? 's' : ''}`} size="small" color="success" />
                          </Box>
                        </Box>
                        <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell width="80px">#</TableCell>
                                <TableCell>File Name</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {files
                                .sort()
                                .map((file, index) => {
                                  const fileName = file.split(/[/\\]/).pop() || file;
                                  return (
                                    <TableRow key={`${groupKey}-${index}`}>
                                      <TableCell>{index + 1}</TableCell>
                                      <TableCell>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                          {fileName}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                          {file}
                                        </Typography>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    ))}
                  </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Scroll to Top Button */}
      <ScrollToTop />

      {/* Error Analysis Dialog */}
      <Dialog
        open={analysisDialogOpen}
        onClose={() => setAnalysisDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Analytics />
            <Typography variant="h6">Error Analysis - SOQL Queries</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {errorAnalysis && (
            <Box>
              <Box sx={{ mb: 2, p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                <Typography variant="body2">
                  <strong>Summary:</strong> Found {errorAnalysis.totalIds} unique Salesforce IDs 
                  across {errorAnalysis.summary?.totalErrors || 0} errors, 
                  mapped to {errorAnalysis.objectTypesCount || 0} object types.
                </Typography>
              </Box>

              {errorAnalysis.objectStats && Object.keys(errorAnalysis.objectStats).length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" gutterBottom fontWeight="bold">
                    Object Type Statistics:
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Object Type</strong></TableCell>
                          <TableCell align="right"><strong>Record Count</strong></TableCell>
                          <TableCell><strong>Sample IDs</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {Object.entries(errorAnalysis.objectStats).map(([objectType, stats]) => (
                          <TableRow key={objectType}>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                {objectType}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">{stats.count}</TableCell>
                            <TableCell>
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                {stats.ids.slice(0, 3).join(', ')}
                                {stats.ids.length > 3 && '...'}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}

              {errorAnalysis.queries && errorAnalysis.queries.length > 0 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom fontWeight="bold">
                    Generated SOQL Queries:
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Copy these queries to execute in Salesforce to retrieve the problematic records:
                  </Typography>
                  
                  {errorAnalysis.queries.map((queryInfo, index) => (
                    <Accordion key={index} defaultExpanded={index === 0}>
                      <AccordionSummary expandIcon={<ExpandMore />}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                          <Code color="primary" />
                          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                            {queryInfo.objectType} ({queryInfo.recordCount} records)
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyQuery(queryInfo.query);
                            }}
                            sx={{ mr: 1 }}
                          >
                            <ContentCopy fontSize="small" />
                          </IconButton>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box
                          sx={{
                            position: 'relative',
                            bgcolor: '#f5f5f5',
                            p: 2,
                            borderRadius: 1,
                            border: '1px solid #e0e0e0',
                          }}
                        >
                          <IconButton
                            size="small"
                            sx={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                            }}
                            onClick={() => handleCopyQuery(queryInfo.query)}
                          >
                            <ContentCopy fontSize="small" />
                          </IconButton>
                          <pre
                            style={{
                              margin: 0,
                              fontSize: '0.875rem',
                              fontFamily: 'monospace',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              overflow: 'auto',
                              maxHeight: '400px',
                            }}
                          >
                            {queryInfo.query}
                          </pre>
                          {queryInfo.sampleIds && queryInfo.sampleIds.length > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                              Sample IDs: {queryInfo.sampleIds.join(', ')}
                            </Typography>
                          )}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Box>
              )}

              {errorAnalysis.message && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
                  <Typography variant="body2">{errorAnalysis.message}</Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnalysisDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Copy Success Snackbar */}
      <Snackbar
        open={copySuccess}
        autoHideDuration={2000}
        onClose={() => setCopySuccess(false)}
        message="Query copied to clipboard!"
      />
    </Box>
  );
};

export default JobReport;

