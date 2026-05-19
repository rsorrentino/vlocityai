import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Paper, Stack, Button, IconButton, Tooltip,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Chip, Alert, CircularProgress, Snackbar,
} from '@mui/material';
import {
  ArrowBack, Add, Delete, Edit, PlayArrow, Save,
  SwapHoriz, Preview, FileUpload, FileDownload, LibraryAdd,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

import GlobalSettingsPanel, { DEFAULT_SETTINGS } from '../components/sfdmu/GlobalSettingsPanel';
import SfdmuObjectDialog, { DEFAULT_OBJECT } from '../components/sfdmu/SfdmuObjectDialog';
import PreviewDialog from '../components/sfdmu/PreviewDialog';
import TemplateDialog from '../components/sfdmu/TemplateDialog';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildExportJsonClient(objects, settings) {
  const s = settings || {};
  return {
    objects: objects.map(o => {
      const obj = {
        query: o.query || `SELECT ALL FROM ${o.sObjectType}`,
        operation: o.operation || 'Upsert',
      };
      if (!['Insert', 'Delete', 'HardDelete', 'DeleteSource', 'DeleteHierarchy'].includes(obj.operation) && o.externalId) {
        obj.externalId = o.externalId;
      }
      if (o.orderBy) obj.orderBy = o.orderBy;
      if (o.limit > 0) obj.limit = o.limit;
      if (o.offset > 0) obj.offset = o.offset;
      if (o.useQueryAll) obj.useQueryAll = true;
      if (o.deleteOldData) obj.deleteOldData = true;
      if (o.deleteQuery) obj.deleteQuery = o.deleteQuery;
      if (o.skipExistingRecords) obj.skipExistingRecords = true;
      if (o.excludedFields?.length) obj.excludedFields = o.excludedFields;
      if (o.excludedFromUpdateFields?.length) obj.excludedFromUpdateFields = o.excludedFromUpdateFields;
      if (o.useFieldMapping && o.fieldMapping?.length) obj.fieldMapping = o.fieldMapping;
      if (o.updateWithMockData && o.mockFields?.length) { obj.mockFields = o.mockFields; obj.updateWithMockData = true; }
      return obj;
    }),
    bulkThreshold: s.bulkThreshold ?? 200,
    simulationMode: !!s.simulationMode,
    allOrNone: !!s.allOrNone,
    concurrencyMode: s.concurrencyMode || 'Serial',
    promptOnMissingParentObjects: false,
    promptOnIssuesInCSVFiles: false,
  };
}

function buildCliCommand(sourceUsername, targetUsername, workDir, simulationMode) {
  if (!sourceUsername || !targetUsername) return '';
  const parts = [
    'sf sfdmu run',
    `--sourceusername ${sourceUsername}`,
    `--targetusername ${targetUsername}`,
    `--path "${workDir || '/path/to/work/dir'}"`,
    '--noprompt',
    '--filelog 0',
  ];
  if (simulationMode) parts.push('--simulation');
  return parts.join(' \\\n  ');
}

// ── Object summary chips ──────────────────────────────────────────────────────

function ObjectBadges({ obj }) {
  const badges = [];
  if (obj.useFieldMapping && obj.fieldMapping?.length) badges.push(`${obj.fieldMapping.length} mapping${obj.fieldMapping.length > 1 ? 's' : ''}`);
  if (obj.updateWithMockData && obj.mockFields?.length) badges.push(`${obj.mockFields.length} mock`);
  if (obj.excludedFields?.length) badges.push(`${obj.excludedFields.length} excluded`);
  if (obj.deleteOldData) badges.push('delOld');
  if (obj.skipExistingRecords) badges.push('skipExisting');
  return badges.map(b => <Chip key={b} label={b} size="small" variant="outlined" sx={{ mr: 0.5 }} />);
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const SfdmuConfigPage = () => {
  const { configId } = useParams();
  const navigate = useNavigate();
  const isNew = !configId;

  const [orgs, setOrgs] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceOrg, setSourceOrg] = useState('');
  const [targetOrg, setTargetOrg] = useState('');
  const [objects, setObjects] = useState([]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const [objectDialog, setObjectDialog] = useState({ open: false, object: null, index: -1 });
  const [templateOpen, setTemplateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const importRef = useRef(null);

  // ── Load orgs ───────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/orgs/list')
      .then(res => setOrgs(res.data.orgs || res.data || []))
      .catch(() => {});
  }, []);

  // ── Load existing config ────────────────────────────────────────────────────
  useEffect(() => {
    if (!configId) return;
    setLoading(true);
    axios.get(`/api/sfdmu/configs/${configId}`)
      .then(res => {
        const c = res.data.data;
        setName(c.name || '');
        setDescription(c.description || '');
        setSourceOrg(c.sourceUsername || '');
        setTargetOrg(c.targetUsername || '');
        setObjects(c.objects || []);
        setSettings({ ...DEFAULT_SETTINGS, ...(c.settings || {}) });
      })
      .catch(() => {
        toast('Failed to load configuration', 'error');
        navigate('/sfdmu');
      })
      .finally(() => setLoading(false));
  }, [configId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = (message, severity = 'success') =>
    setSnackbar({ open: true, message, severity });

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) { toast('Configuration name is required', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        name, description,
        sourceUsername: sourceOrg || null,
        targetUsername: targetOrg || null,
        objects, settings,
      };
      if (isNew) {
        const res = await axios.post('/api/sfdmu/configs', payload);
        toast('Configuration saved');
        navigate(`/sfdmu/config/${res.data.data.id}`, { replace: true });
      } else {
        await axios.put(`/api/sfdmu/configs/${configId}`, payload);
        toast('Configuration updated');
      }
    } catch (err) {
      toast(err.response?.data?.message || err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Save & Run ───────────────────────────────────────────────────────────────
  const handleSaveAndRun = async () => {
    if (!name.trim()) { toast('Configuration name is required', 'error'); return; }
    if (!sourceOrg || !targetOrg) { toast('Select source and target orgs first', 'error'); return; }
    if (sourceOrg === targetOrg) { toast('Source and target orgs must be different', 'error'); return; }
    if (!objects.length) { toast('Add at least one sObject', 'error'); return; }

    setRunning(true);
    try {
      // Save first (create or update)
      const payload = { name, description, sourceUsername: sourceOrg, targetUsername: targetOrg, objects, settings };
      let id = configId;
      if (isNew) {
        const saveRes = await axios.post('/api/sfdmu/configs', payload);
        id = saveRes.data.data.id;
        navigate(`/sfdmu/config/${id}`, { replace: true });
      } else {
        await axios.put(`/api/sfdmu/configs/${configId}`, payload);
      }
      // Then run
      const runRes = await axios.post(`/api/sfdmu/configs/${id}/run`, {});
      const { jobId } = runRes.data.data;
      toast(`Migration started — Job ${jobId.slice(0, 8)}…`);
      setTimeout(() => navigate(`/jobs/sfdmu/${jobId}`), 800);
    } catch (err) {
      toast(err.response?.data?.message || err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  // ── Export to file ────────────────────────────────────────────────────────────
  const handleExportToFile = async () => {
    if (isNew) { toast('Save the configuration first', 'warning'); return; }
    try {
      const res = await axios.post(`/api/sfdmu/configs/${configId}/export`);
      toast(`Exported to: ${res.data.data.filePath}`);
    } catch (err) {
      toast(err.response?.data?.message || err.message, 'error');
    }
  };

  // ── Download export.json in browser ──────────────────────────────────────────
  const handleDownloadJson = () => {
    const exportJson = buildExportJsonClient(objects, settings);
    const blob = new Blob([JSON.stringify(exportJson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name || 'export').replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import from file ──────────────────────────────────────────────────────────
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // Convert export.json back to our format
        const importedObjects = (parsed.objects || []).map(o => {
          const match = (o.query || '').match(/\bFROM\s+(\w+)/i);
          return {
            ...DEFAULT_OBJECT,
            sObjectType: match ? match[1] : '',
            query: o.query || '',
            operation: o.operation || 'Upsert',
            externalId: o.externalId || 'Name',
            orderBy: o.orderBy || '',
            limit: o.limit || 0,
            offset: o.offset || 0,
            useQueryAll: !!o.useQueryAll,
            deleteOldData: !!o.deleteOldData,
            deleteQuery: o.deleteQuery || '',
            skipExistingRecords: !!o.skipExistingRecords,
            excludedFields: o.excludedFields || [],
            excludedFromUpdateFields: o.excludedFromUpdateFields || [],
            useFieldMapping: !!(o.fieldMapping?.length),
            fieldMapping: o.fieldMapping || [],
            updateWithMockData: !!o.updateWithMockData,
            mockFields: o.mockFields || [],
          };
        });
        setObjects(importedObjects);
        setSettings(prev => ({
          ...prev,
          simulationMode: !!parsed.simulationMode,
          allOrNone: !!parsed.allOrNone,
          concurrencyMode: parsed.concurrencyMode || prev.concurrencyMode,
          bulkThreshold: parsed.bulkThreshold || prev.bulkThreshold,
        }));
        toast(`Imported ${importedObjects.length} object(s) from ${file.name}`);
      } catch {
        toast('Failed to parse JSON file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Object dialog handlers ────────────────────────────────────────────────────
  const openAdd = () => setObjectDialog({ open: true, object: null, index: -1 });
  const openEdit = (obj, idx) => setObjectDialog({ open: true, object: obj, index: idx });

  const handleObjectSave = (obj) => {
    if (objectDialog.index >= 0) {
      setObjects(prev => prev.map((o, i) => i === objectDialog.index ? obj : o));
    } else {
      setObjects(prev => [...prev, obj]);
    }
    setObjectDialog({ open: false, object: null, index: -1 });
  };

  const removeObject = (idx) => setObjects(prev => prev.filter((_, i) => i !== idx));

  const handleTemplateApply = (selected) => {
    const existingTypes = new Set(objects.map(o => o.sObjectType));
    const newObjects = selected
      .filter(o => !existingTypes.has(o.sObjectType))
      .map(o => ({ ...DEFAULT_OBJECT, ...o }));
    setObjects(prev => [...prev, ...newObjects]);
    setTemplateOpen(false);
    toast(`Added ${newObjects.length} object${newObjects.length !== 1 ? 's' : ''} from template`);
  };

  const swapOrgs = () => {
    setSourceOrg(targetOrg);
    setTargetOrg(sourceOrg);
  };

  const exportJson = buildExportJsonClient(objects, settings);
  const cliCommand = buildCliCommand(sourceOrg, targetOrg, `./temp/sfdmu-...`, settings.simulationMode);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Tooltip title="Back to SFDMU">
          <IconButton onClick={() => navigate(-1)}><ArrowBack /></IconButton>
        </Tooltip>
        <TextField
          size="small"
          placeholder="Configuration name *"
          value={name}
          onChange={e => setName(e.target.value)}
          sx={{ width: 280 }}
          inputProps={{ style: { fontWeight: 600 } }}
        />
        <TextField
          size="small"
          placeholder="Description (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          sx={{ flex: 1 }}
        />
      </Stack>

      {/* ── Org Selector ────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 260 }}>
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

          <FormControl size="small" sx={{ minWidth: 260 }}>
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
        </Stack>
      </Paper>

      {/* ── Objects ─────────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>Objects to Migrate</Typography>
          <Box sx={{ flex: 1 }} />
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
          <Tooltip title="Import objects from export.json file">
            <Button size="small" startIcon={<FileUpload />} onClick={() => importRef.current?.click()} sx={{ mr: 1 }}>
              Import JSON
            </Button>
          </Tooltip>
          <Button size="small" startIcon={<LibraryAdd />} onClick={() => setTemplateOpen(true)} sx={{ mr: 1 }}>
            Templates
          </Button>
          <Button size="small" startIcon={<Add />} onClick={openAdd} variant="outlined">Add Object</Button>
        </Stack>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>sObject API Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Operation</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>External ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Advanced Options</TableCell>
                <TableCell sx={{ width: 80 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {objects.map((obj, idx) => (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontWeight: 500 }}>{obj.sObjectType || <em style={{ color: '#999' }}>custom query</em>}</TableCell>
                  <TableCell><Chip label={obj.operation} size="small" /></TableCell>
                  <TableCell>{obj.externalId || '—'}</TableCell>
                  <TableCell><ObjectBadges obj={obj} /></TableCell>
                  <TableCell>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(obj, idx)}>
                        <Edit fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <IconButton size="small" color="error" onClick={() => removeObject(idx)}
                        disabled={objects.length === 1}>
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {objects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No objects defined. Click "Add Object" to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* ── Settings ────────────────────────────────────────────────────────── */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Settings</Typography>
        <GlobalSettingsPanel settings={settings} onChange={setSettings} />
      </Box>

      {/* ── Action Bar ──────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<Preview />}
              onClick={() => setPreviewOpen(true)}
            >
              Preview JSON
            </Button>
            <Button
              variant="outlined"
              startIcon={<FileDownload />}
              onClick={handleDownloadJson}
            >
              Download JSON
            </Button>
            {!isNew && (
              <Tooltip title="Write export.json to the server's sfdmu-configs directory">
                <Button variant="outlined" startIcon={<FileUpload />} onClick={handleExportToFile}>
                  Export to Server
                </Button>
              </Tooltip>
            )}
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={saving ? <CircularProgress size={16} /> : <Save />}
              onClick={handleSave}
              disabled={saving || running}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="contained"
              startIcon={running ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
              onClick={handleSaveAndRun}
              disabled={saving || running}
            >
              {running ? 'Starting…' : settings.simulationMode ? 'Save & Run (Simulation)' : 'Save & Run'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      <TemplateDialog
        open={templateOpen}
        existingTypes={objects.map(o => o.sObjectType)}
        onApply={handleTemplateApply}
        onClose={() => setTemplateOpen(false)}
      />

      <SfdmuObjectDialog
        open={objectDialog.open}
        object={objectDialog.object}
        onSave={handleObjectSave}
        onClose={() => setObjectDialog({ open: false, object: null, index: -1 })}
      />

      <PreviewDialog
        open={previewOpen}
        exportJson={exportJson}
        cliCommand={cliCommand}
        onClose={() => setPreviewOpen(false)}
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

export default SfdmuConfigPage;
