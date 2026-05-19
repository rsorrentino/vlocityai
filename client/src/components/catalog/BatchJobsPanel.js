import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Paper, Button, Select, MenuItem, FormControl,
  InputLabel, TextField, Stack, Alert, CircularProgress, LinearProgress,
  Chip, Tooltip, IconButton,
} from '@mui/material';
import { PlayArrow, Refresh } from '@mui/icons-material';
import axios from 'axios';

const BATCH_CLASSES = [
  'AMP_ServiceCreationSingleBatch',
  'AMP_itemSkuBatchProcess',
  'AMP_PricingElementBatch',
  'AMP_CreatePricingListEntryBatch',
  'AMP_CreatePricingElementBatch',
];

const STATUS_COLOR = {
  Completed: 'success',
  Failed:    'error',
  Aborted:   'error',
  Processing: 'warning',
  Queued:    'info',
};

const BatchJobsPanel = ({ selectedOrg, onError, onSuccess }) => {
  const [jobs, setJobs]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [executing, setExecuting]   = useState(false);
  const [apexClass, setApexClass]   = useState(BATCH_CLASSES[0]);
  const [country, setCountry]       = useState('');
  const pollerRef = useRef(null);

  const fetchJobs = useCallback(async () => {
    if (!selectedOrg) return;
    setLoading(true);
    try {
      const res = await axios.get('/api/catalog/batch/jobs', { params: { username: selectedOrg } });
      setJobs(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, onError]);

  // Auto-poll every 5s when any job is actively running
  useEffect(() => {
    const hasRunning = jobs.some(j => ['Processing', 'Queued', 'Preparing'].includes(j.Status));
    if (hasRunning) {
      pollerRef.current = setInterval(fetchJobs, 5000);
    } else {
      clearInterval(pollerRef.current);
    }
    return () => clearInterval(pollerRef.current);
  }, [jobs, fetchJobs]);

  useEffect(() => {
    fetchJobs();
    return () => clearInterval(pollerRef.current);
  }, [fetchJobs]);

  const executeBatch = async () => {
    if (!selectedOrg) return;
    setExecuting(true);
    try {
      await axios.post('/api/catalog/batch/execute', { username: selectedOrg, apexClassName: apexClass, country });
      onSuccess?.(`Batch job "${apexClass}" queued`);
      // Refresh after a short delay
      setTimeout(fetchJobs, 1500);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setExecuting(false);
    }
  };

  const progressPct = (job) => {
    if (!job.TotalJobItems || job.TotalJobItems === 0) return 0;
    return Math.round((job.JobItemsProcessed / job.TotalJobItems) * 100);
  };

  return (
    <Box>
      {/* Execute panel */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Execute Batch Job</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }}>
          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel>Batch Class</InputLabel>
            <Select value={apexClass} label="Batch Class" onChange={e => setApexClass(e.target.value)}>
              {BATCH_CLASSES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="Country Code (optional)" value={country}
            onChange={e => setCountry(e.target.value)} placeholder="e.g. IT" sx={{ width: 180 }} />
          <Button variant="contained" startIcon={executing ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
            onClick={executeBatch} disabled={executing || !selectedOrg}>
            {executing ? 'Queueing…' : 'Execute'}
          </Button>
        </Stack>
        {!selectedOrg && <Alert severity="info" sx={{ mt: 2 }}>Select an org to execute batch jobs.</Alert>}
      </Paper>

      {/* Jobs list */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>Recent Batch Jobs</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchJobs} disabled={!selectedOrg} size="small">
              {loading ? <CircularProgress size={18} /> : <Refresh />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {!selectedOrg && <Alert severity="info">Select an org to view batch jobs.</Alert>}

      {selectedOrg && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>Apex Class</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Progress</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Processed / Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Errors</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Alert severity="info" sx={{ m: 1 }}>No recent batch jobs.</Alert>
                  </TableCell>
                </TableRow>
              )}
              {jobs.map(job => {
                const pct = progressPct(job);
                const isRunning = ['Processing', 'Queued', 'Preparing'].includes(job.Status);
                return (
                  <TableRow key={job.Id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {job.ApexClass?.Name || '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={job.Status}
                        size="small"
                        color={STATUS_COLOR[job.Status] || 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 150 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress
                          variant={isRunning && !job.TotalJobItems ? 'indeterminate' : 'determinate'}
                          value={pct}
                          sx={{ flex: 1, height: 8, borderRadius: 1 }}
                          color={job.NumberOfErrors > 0 ? 'error' : 'primary'}
                        />
                        <Typography variant="caption" sx={{ minWidth: 35 }}>{pct}%</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {job.JobItemsProcessed ?? 0} / {job.TotalJobItems ?? '?'}
                    </TableCell>
                    <TableCell>
                      {job.NumberOfErrors > 0
                        ? <Chip label={job.NumberOfErrors} size="small" color="error" />
                        : <Typography variant="caption" color="text.disabled">0</Typography>
                      }
                    </TableCell>
                    <TableCell>
                      {job.CreatedDate ? new Date(job.CreatedDate).toLocaleString() : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default BatchJobsPanel;
