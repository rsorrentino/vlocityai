import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Card, CardContent, Stack, Button, IconButton, Tooltip,
  TextField, Select, MenuItem, FormControl, InputLabel, FormControlLabel,
  Switch, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Chip, Alert, CircularProgress, Accordion, AccordionSummary,
  AccordionDetails, Snackbar, Divider,
} from '@mui/material';
import {
  Add, Delete, PlayArrow, SwapHoriz, Refresh, ExpandMore,
  History, OpenInNew, Edit, FileUpload,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog';

const OPERATIONS = ['Upsert', 'Insert', 'Update', 'Delete', 'Readonly', 'DeleteSource', 'Hard_Delete'];

const DEFAULT_OBJECT = {
  sObjectType: '',
  query: '',
  operation: 'Upsert',
  externalId: 'Name',
};

const DEFAULT_SETTINGS = {
  simulationMode: false,
  allOrNone: false,
  concurrencyMode: 'Serial',
  bulkThreshold: 1000,
};

const SESSION_KEY = 'sfdmuPage.state';

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; }
}

const SfdmuPage = () => {
  const navigate = useNavigate();
  const saved = loadSession();
  const importRef = useRef(null);

  // Quick-run state
  const [orgs, setOrgs]                   = useState([]);
  const [sourceOrg, setSourceOrg]         = useState(saved.sourceOrg || '');
  const [targetOrg, setTargetOrg]         = useState(saved.targetOrg || '');
  const [objects, setObjects]             = useState(saved.objects || [{ ...DEFAULT_OBJECT }]);
  const [settings, setSettings]           = useState(saved.settings || { ...DEFAULT_SETTINGS });
  const [sfdmuInstalled, setSfdmuInstalled] = useState(null);
  const [running, setRunning]             = useState(false);
  const [recentJobs, setRecentJobs]       = useState([]);
  const [jobsLoading, setJobsLoading]     = useState(false);

  // Saved configs state
  const [savedConfigs, setSavedConfigs]   = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [runningConfigId, setRunningConfigId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, config: null });

  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const toast = (message, severity = 'success') =>
    setSnackbar({ open: true, message, severity });

  // ── Persist quick-run state ──────────────────────────────────────────────────
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sourceOrg, targetOrg, objects, settings }));
  }, [sourceOrg, targetOrg, objects, settings]);

  // ── Load orgs + check sfdmu status ───────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/orgs/list')
      .then(res => setOrgs(res.data.orgs || res.data || []))
      .catch(() => {});
    axios.get('/api/sfdmu/status')
      .then(res => setSfdmuInstalled(res.data.data?.installed ?? false))
      .catch(() => setSfdmuInstalled(false));
  }, []);

  // ── Load saved configurations ─────────────────────────────────────────────────
  const fetchSavedConfigs = useCallback(async () => {
    setConfigsLoading(true);
    try {
      const res = await axios.get('/api/sfdmu/configs');
      setSavedConfigs(res.data.data || []);
    } catch {
      // non-critical
    } finally {
      setConfigsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSavedConfigs(); }, [fetchSavedConfigs]);

  // ── Load recent jobs ──────────────────────────────────────────────────────────
  const fetchRecentJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await axios.get('/api/sfdmu/jobs');
      setRecentJobs(res.data.data || []);
    } catch {
      // non-critical
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecentJobs(); }, [fetchRecentJobs]);

  // ── Quick-run helpers ─────────────────────────────────────────────────────────
  const addObject = () => setObjects(prev => [...prev, { ...DEFAULT_OBJECT }]);
  const removeObject = (idx) => setObjects(prev => prev.filter((_, i) => i !== idx));
  const updateObject = (idx, field, value) =>
    setObjects(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o));
  const swapOrgs = () => { setSourceOrg(targetOrg); setTargetOrg(sourceOrg); };

  // ── Quick run ─────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!sourceOrg || !targetOrg) { toast('Select source and target orgs first', 'error'); return; }
    if (sourceOrg === targetOrg) { toast('Source and target orgs must be different', 'error'); return; }
    const validObjects = objects.filter(o => o.sObjectType.trim() || o.query.trim());
    if (!validObjects.length) { toast('Add at least one sObject to migrate', 'error'); return; }

    setRunning(true);
    try {
      const res = await axios.post('/api/sfdmu/run', {
        sourceUsername: sourceOrg,
        targetUsername: targetOrg,
        objects: validObjects,
        settings,
      });
      const { jobId } = res.data.data;
      toast(`Migration started — Job ${jobId.slice(0, 8)}…`);
      fetchRecentJobs();
      setTimeout(() => navigate(`/jobs/sfdmu/${jobId}`), 800);
    } catch (err) {
      toast(err.response?.data?.message || err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  // ── Saved config actions ──────────────────────────────────────────────────────
  const handleRunConfig = async (config) => {
    if (!config.sourceUsername || !config.targetUsername) {
      navigate(`/sfdmu/config/${config.id}`);
      toast('Set source and target orgs in the configuration first', 'warning');
      return;
    }
    setRunningConfigId(config.id);
    try {
      const res = await axios.post(`/api/sfdmu/configs/${config.id}/run`, {});
      const { jobId } = res.data.data;
      toast(`Migration started — Job ${jobId.slice(0, 8)}…`);
      fetchRecentJobs();
      setTimeout(() => navigate(`/jobs/sfdmu/${jobId}`), 800);
    } catch (err) {
      toast(err.response?.data?.message || err.message, 'error');
    } finally {
      setRunningConfigId(null);
    }
  };

  const handleDeleteConfig = async (config) => {
    try {
      await axios.delete(`/api/sfdmu/configs/${config.id}`);
      toast('Configuration deleted');
      fetchSavedConfigs();
    } catch (err) {
      toast(err.response?.data?.message || err.message, 'error');
    }
    setConfirmDelete({ open: false, config: null });
  };

  // ── Import config from JSON file ──────────────────────────────────────────────
  const handleImportConfig = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const cfgName = file.name.replace(/\.json$/i, '') || 'Imported Config';
        await axios.post('/api/sfdmu/configs/import', { name: cfgName, exportJson: parsed });
        toast(`Imported "${cfgName}" successfully`);
        fetchSavedConfigs();
      } catch {
        toast('Failed to import configuration', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const statusColor = (status) => ({
    completed: 'success', failed: 'error', running: 'warning',
    pending: 'default', cancelled: 'default',
  }[status] || 'default');

  return (
    <Box>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Data Migration (SFDMU)</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {sfdmuInstalled === false && (
            <Chip label="Plugin not installed" color="error" size="small" variant="outlined" />
          )}
          {sfdmuInstalled === true && (
            <Chip label="sf sfdmu ready" color="success" size="small" variant="outlined" />
          )}
        </Box>
      </Box>

      {sfdmuInstalled === false && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The <code>sfdmu</code> SF CLI plugin is not installed. Run:&nbsp;
          <code>sf plugins install sfdmu@latest</code>
        </Alert>
      )}

      {/* ── Saved Configurations ────────────────────────────────────────────── */}
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>Saved Configurations</Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Refresh">
            <span>
              <IconButton size="small" onClick={fetchSavedConfigs} disabled={configsLoading} sx={{ mr: 1 }}>
                {configsLoading ? <CircularProgress size={16} /> : <Refresh />}
              </IconButton>
            </span>
          </Tooltip>
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportConfig} />
          <Tooltip title="Import configuration from export.json file">
            <Button size="small" startIcon={<FileUpload />} onClick={() => importRef.current?.click()} sx={{ mr: 1 }}>
              Import JSON
            </Button>
          </Tooltip>
          <Button size="small" startIcon={<Add />} variant="contained"
            onClick={() => navigate('/sfdmu/config/new')}>
            New Configuration
          </Button>
        </Stack>

        {savedConfigs.length === 0 && !configsLoading && (
          <Alert severity="info">
            No saved configurations yet. Click "New Configuration" to create one with advanced options (field mapping, anonymization, full SOQL).
          </Alert>
        )}

        {savedConfigs.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Source → Target</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Objects</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 140 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {savedConfigs.map(cfg => (
                  <TableRow key={cfg.id} hover sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/sfdmu/config/${cfg.id}`)}>
                    <TableCell sx={{ fontWeight: 500 }}>
                      {cfg.name}
                      {cfg.description && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {cfg.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {cfg.sourceUsername || '—'} → {cfg.targetUsername || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`${(cfg.objects || []).length} object${(cfg.objects || []).length !== 1 ? 's' : ''}`}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(cfg.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Run">
                          <span>
                            <IconButton size="small" color="primary"
                              onClick={() => handleRunConfig(cfg)}
                              disabled={!!runningConfigId || sfdmuInstalled === false}>
                              {runningConfigId === cfg.id
                                ? <CircularProgress size={16} />
                                : <PlayArrow fontSize="small" />}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton size="small"
                            onClick={() => navigate(`/sfdmu/config/${cfg.id}`)}>
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error"
                            onClick={() => setConfirmDelete({ open: true, config: cfg })}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent></Card>

      <Divider sx={{ mb: 2 }}>
        <Chip label="Quick Run (Ad-hoc)" size="small" />
      </Divider>

      {/* ── Quick Run — Org selector ─────────────────────────────────────────── */}
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel>Source Org</InputLabel>
            <Select value={sourceOrg} label="Source Org" onChange={e => setSourceOrg(e.target.value)}>
              <MenuItem value="">— Select source —</MenuItem>
              <MenuItem value="csvfile">CSV Files (local)</MenuItem>
              {orgs.map(o => (
                <MenuItem key={o.username} value={o.username}>
                  {o.alias ? `${o.alias} (${o.username})` : o.username}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Tooltip title="Swap source / target">
            <IconButton onClick={swapOrgs} size="small"><SwapHoriz /></IconButton>
          </Tooltip>

          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel>Target Org</InputLabel>
            <Select value={targetOrg} label="Target Org" onChange={e => setTargetOrg(e.target.value)}>
              <MenuItem value="">— Select target —</MenuItem>
              <MenuItem value="csvfile">CSV Files (local)</MenuItem>
              {orgs.map(o => (
                <MenuItem key={o.username} value={o.username}>
                  {o.alias ? `${o.alias} (${o.username})` : o.username}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ flex: 1 }} />

          <Button
            variant="contained"
            startIcon={running ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
            onClick={handleRun}
            disabled={running || sfdmuInstalled === false}
          >
            {running ? 'Starting…' : settings.simulationMode ? 'Run (Simulation)' : 'Run Migration'}
          </Button>
        </Stack>
      </CardContent></Card>

      {/* ── Quick Run — Objects configuration ─────────────────────────────────── */}
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>Objects to Migrate</Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<Add />} onClick={addObject}>Add Object</Button>
        </Stack>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>sObject API Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Operation</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>External ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>WHERE clause (optional)</TableCell>
                <TableCell sx={{ width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {objects.map((obj, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <TextField
                      size="small"
                      placeholder="e.g. Account"
                      value={obj.sObjectType}
                      onChange={e => updateObject(idx, 'sObjectType', e.target.value)}
                      sx={{ minWidth: 180 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      value={obj.operation}
                      onChange={e => updateObject(idx, 'operation', e.target.value)}
                      sx={{ minWidth: 130 }}
                    >
                      {OPERATIONS.map(op => <MenuItem key={op} value={op}>{op}</MenuItem>)}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      placeholder="Name"
                      value={obj.externalId}
                      onChange={e => updateObject(idx, 'externalId', e.target.value)}
                      disabled={obj.operation === 'Insert' || obj.operation === 'Delete'}
                      sx={{ minWidth: 130 }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      placeholder="e.g. IsActive = true"
                      value={obj.query}
                      onChange={e => updateObject(idx, 'query', e.target.value)}
                      sx={{ minWidth: 240 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Remove">
                      <span>
                        <IconButton size="small" color="error" onClick={() => removeObject(idx)}
                          disabled={objects.length === 1}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Alert severity="info" sx={{ mt: 2 }} icon={false}>
          <Typography variant="caption">
            Leave <em>WHERE clause</em> empty to migrate all records. The full query will be built as
            <code> SELECT ALL FROM {'{sObjectType}'} [WHERE {'{clause}'}]</code>.
            For advanced options (field mapping, anonymization, full SOQL), use <strong>Saved Configurations</strong> above.
          </Typography>
        </Alert>
      </CardContent></Card>

      {/* ── Quick Run — Advanced Settings ─────────────────────────────────────── */}
      <Accordion variant="outlined" sx={{ mb: 2 }}>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="subtitle1" fontWeight={600}>Advanced Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={settings.simulationMode}
                  onChange={e => setSettings(s => ({ ...s, simulationMode: e.target.checked }))}
                />
              }
              label="Simulation mode (dry run — no changes made)"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.allOrNone}
                  onChange={e => setSettings(s => ({ ...s, allOrNone: e.target.checked }))}
                />
              }
              label="All or none (rollback all on any error)"
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Concurrency Mode</InputLabel>
              <Select
                value={settings.concurrencyMode}
                label="Concurrency Mode"
                onChange={e => setSettings(s => ({ ...s, concurrencyMode: e.target.value }))}
              >
                <MenuItem value="Serial">Serial</MenuItem>
                <MenuItem value="Parallel">Parallel</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Bulk API Threshold"
              type="number"
              value={settings.bulkThreshold}
              onChange={e => setSettings(s => ({ ...s, bulkThreshold: parseInt(e.target.value, 10) || 1000 }))}
              sx={{ width: 160 }}
              helperText="Records above this use Bulk API"
            />
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* ── Recent Jobs ─────────────────────────────────────────────────────────── */}
      <Card><CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
          <History sx={{ mr: 1 }} fontSize="small" />
          <Typography variant="subtitle1" fontWeight={600}>Recent Migration Jobs</Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Refresh">
            <span>
              <IconButton size="small" onClick={fetchRecentJobs} disabled={jobsLoading}>
                {jobsLoading ? <CircularProgress size={16} /> : <Refresh />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {recentJobs.length === 0 && !jobsLoading && (
          <Alert severity="info">No migration jobs yet. Run your first migration above.</Alert>
        )}

        {recentJobs.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Job Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Source → Target</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Started</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 64 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {recentJobs.map(job => (
                  <TableRow key={job.id} hover sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/jobs/sfdmu/${job.id}`)}>
                    <TableCell sx={{ fontWeight: 500 }}>{job.name}</TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {job.sourceUsername} → {job.targetUsername}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={job.status} size="small" color={statusColor(job.status)} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Tooltip title="Open in Job Monitor">
                        <IconButton size="small" onClick={() => navigate(`/jobs/sfdmu/${job.id}`)}>
                          <OpenInNew fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent></Card>

      {/* ── Confirm delete ─────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmDelete.open}
        title="Delete Configuration"
        message={`Delete "${confirmDelete.config?.name}"? This cannot be undone.`}
        confirmText="Delete"
        severity="error"
        onConfirm={() => handleDeleteConfig(confirmDelete.config)}
        onCancel={() => setConfirmDelete({ open: false, config: null })}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SfdmuPage;
