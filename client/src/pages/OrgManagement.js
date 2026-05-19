import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Chip, Alert, Snackbar,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  TableSortLabel, Paper, Tooltip, IconButton, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Link, Card, CardContent,
} from '@mui/material';
import {
  Sync, Edit, Delete, CheckCircle, Error as ErrorIcon,
  Help, OpenInNew, Add,
} from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog';

const ENVIRONMENTS = ['dev', 'uat', 'prod', 'staging'];

const ENV_COLOR = { dev: 'primary', uat: 'warning', prod: 'success', staging: 'secondary' };

function StatusChip({ result, testedAt, testing }) {
  if (testing) return <Chip size="small" label="Testing…" />;
  if (result === 'success') return (
    <Tooltip title={testedAt ? `Last tested: ${new Date(testedAt).toLocaleString()}` : ''}>
      <Chip size="small" color="success" icon={<CheckCircle />} label="Connected" />
    </Tooltip>
  );
  if (result === 'failure') return (
    <Tooltip title={testedAt ? `Last tested: ${new Date(testedAt).toLocaleString()}` : ''}>
      <Chip size="small" color="error" icon={<ErrorIcon />} label="Failed" />
    </Tooltip>
  );
  return <Chip size="small" icon={<Help />} label="Unknown" />;
}

const OrgManagement = () => {
  const [orgs, setOrgs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [testing, setTesting]         = useState(new Set());
  const [snackbar, setSnackbar]       = useState({ open: false, message: '', severity: 'success' });

  // Edit dialog
  const [editDialog, setEditDialog]   = useState({ open: false, org: null });
  const [editLabel, setEditLabel]     = useState('');
  const [editEnv, setEditEnv]         = useState('');
  const [editNotes, setEditNotes]     = useState('');
  const [saving, setSaving]           = useState(false);

  // Add manually dialog
  const [addDialog, setAddDialog]     = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [adding, setAdding]           = useState(false);

  // Auth error dialog (from failed test-connection)
  const [authError, setAuthError]     = useState(null);

  // Confirm delete dialog
  const [confirmDialog, setConfirmDialog] = useState({ open: false });

  // Sort
  const [orderBy, setOrderBy]         = useState('alias');
  const [order, setOrder]             = useState('asc');

  const showSnack = (message, severity = 'success') =>
    setSnackbar({ open: true, message, severity });

  const fetchOrgs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/orgs/list');
      setOrgs(res.data.orgs || []);
    } catch (err) {
      showSnack(err.response?.data?.message || err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  // ── Sort ────────────────────────────────────────────────────────────────────
  const handleSort = (field) => {
    setOrder(prev => orderBy === field && prev === 'asc' ? 'desc' : 'asc');
    setOrderBy(field);
  };
  const sorted = [...orgs].sort((a, b) => {
    const va = a[orderBy] ?? '';
    const vb = b[orderBy] ?? '';
    return (order === 'asc' ? 1 : -1) * String(va).localeCompare(String(vb));
  });

  // ── Sync from CLI ────────────────────────────────────────────────────────────
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post('/api/orgs/sync');
      showSnack(`Synced: ${res.data.added} new, ${res.data.updated} updated (${res.data.total} total)`);
      fetchOrgs();
    } catch (err) {
      showSnack(err.response?.data?.message || err.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  // ── Test connection ──────────────────────────────────────────────────────────
  const handleTest = async (username) => {
    setTesting(prev => new Set([...prev, username]));
    setAuthError(null);
    try {
      await axios.post('/api/orgs/test-connection', { username });
      fetchOrgs(); // reload persisted result
      showSnack(`${username}: connection successful`);
    } catch (err) {
      const data = err.response?.data;
      if (data?.authError) setAuthError(data.authError);
      fetchOrgs();
      showSnack(data?.message || err.message, 'error');
    } finally {
      setTesting(prev => { const s = new Set(prev); s.delete(username); return s; });
    }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────────
  const openEdit = (org) => {
    setEditDialog({ open: true, org });
    setEditLabel(org.label || '');
    setEditEnv(org.environment || '');
    setEditNotes(org.notes || '');
  };
  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await axios.put(`/api/orgs/${encodeURIComponent(editDialog.org.username)}`, {
        label: editLabel || null,
        environment: editEnv || null,
        notes: editNotes || null,
      });
      showSnack('Org updated');
      setEditDialog({ open: false, org: null });
      fetchOrgs();
    } catch (err) {
      showSnack(err.response?.data?.message || err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = (org) => {
    setConfirmDialog({
      open: true,
      title: 'Remove Organization',
      severity: 'warning',
      message: `Remove "${org.alias}" from the app's org list?\n\nThis only removes it from tracking — SF CLI authentication is NOT revoked.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/orgs/${encodeURIComponent(org.username)}`);
          showSnack(`"${org.alias}" removed`);
          fetchOrgs();
        } catch (err) {
          showSnack(err.response?.data?.message || err.message, 'error');
        }
      },
    });
  };

  // ── Add manually ─────────────────────────────────────────────────────────────
  const handleAddManually = async () => {
    if (!addUsername.trim()) return;
    setAdding(true);
    try {
      // Test connection first — this upserts the org into DB via recordTestResult
      await axios.post('/api/orgs/test-connection', { username: addUsername.trim() });
      showSnack(`"${addUsername.trim()}" added and connected`);
      setAddDialog(false);
      setAddUsername('');
      fetchOrgs();
    } catch (err) {
      const data = err.response?.data;
      // Even if test fails, the upsert happened — just warn
      if (data?.authError) {
        setAuthError(data.authError);
        setAddDialog(false);
        setAddUsername('');
        fetchOrgs(); // org was still upserted
      } else {
        showSnack(data?.message || err.message, 'error');
      }
    } finally {
      setAdding(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Organization Management</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<Add />} onClick={() => { setAddDialog(true); setAddUsername(''); }}>
            Add Manually
          </Button>
          <Button variant="contained" startIcon={<Sync />} onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync from CLI'}
          </Button>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>Sync from CLI</strong> imports all orgs authenticated via <code>sf org login web</code>.
        Editing an org's label, environment, or notes only affects this app — not Salesforce or the CLI.
      </Alert>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Table */}
      <Card>
        <CardContent>
      <TableContainer>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, minWidth: 200 }}>
                <TableSortLabel active={orderBy === 'alias'} direction={orderBy === 'alias' ? order : 'asc'} onClick={() => handleSort('alias')}>
                  Display Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 600, minWidth: 120 }}>
                <TableSortLabel active={orderBy === 'environment'} direction={orderBy === 'environment' ? order : 'asc'} onClick={() => handleSort('environment')}>
                  Environment
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 600, minWidth: 140 }}>
                <TableSortLabel active={orderBy === 'lastTestResult'} direction={orderBy === 'lastTestResult' ? order : 'asc'} onClick={() => handleSort('lastTestResult')}>
                  Status
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Instance URL</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Notes</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 130 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Alert severity="info" sx={{ m: 1 }}>
                    No organizations tracked yet. Click <strong>Sync from CLI</strong> to import all authenticated orgs.
                  </Alert>
                </TableCell>
              </TableRow>
            )}
            {sorted.map(org => (
              <TableRow key={org.username} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>{org.alias}</Typography>
                  <Typography variant="caption" color="text.secondary">{org.username}</Typography>
                </TableCell>
                <TableCell>
                  {org.environment
                    ? <Chip size="small" label={org.environment} color={ENV_COLOR[org.environment] || 'default'} />
                    : <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
                <TableCell>
                  <StatusChip
                    result={org.lastTestResult}
                    testedAt={org.lastTestedAt}
                    testing={testing.has(org.username)}
                  />
                </TableCell>
                <TableCell>
                  {org.instanceUrl
                    ? (
                      <Link href={org.instanceUrl} target="_blank" rel="noopener noreferrer"
                        sx={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {org.instanceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        <OpenInNew sx={{ fontSize: 12 }} />
                      </Link>
                    )
                    : <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {org.notes ? org.notes.slice(0, 60) + (org.notes.length > 60 ? '…' : '') : '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Tooltip title="Test connection">
                    <span>
                      <IconButton size="small" onClick={() => handleTest(org.username)} disabled={testing.has(org.username)}>
                        {testing.has(org.username)
                          ? <LinearProgress sx={{ width: 16 }} />
                          : <CheckCircle fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Edit label / environment / notes">
                    <IconButton size="small" onClick={() => openEdit(org)}>
                      <Edit fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove from tracking">
                    <IconButton size="small" color="error" onClick={() => handleDelete(org)}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
        </CardContent>
      </Card>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {orgs.length} org{orgs.length !== 1 ? 's' : ''} tracked
      </Typography>

      {/* Edit dialog */}
      <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, org: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Organization</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {editDialog.org?.username}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Display Label"
              size="small"
              fullWidth
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              helperText="Shown in all app dropdowns. Leave blank to use the SF CLI alias."
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Environment</InputLabel>
              <Select value={editEnv} label="Environment" onChange={e => setEditEnv(e.target.value)}>
                <MenuItem value=""><em>— not set —</em></MenuItem>
                {ENVIRONMENTS.map(e => <MenuItem key={e} value={e}>{e}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Notes"
              size="small"
              fullWidth
              multiline
              rows={3}
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              helperText="Internal notes about this org (not sent to Salesforce)."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog({ open: false, org: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add manually dialog */}
      <Dialog open={addDialog} onClose={() => setAddDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Org Manually</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            The org must already be authenticated via <code>sf org login web</code>.
            Use <strong>Sync from CLI</strong> to import all authenticated orgs at once.
          </Alert>
          <TextField
            label="Salesforce Username"
            size="small"
            fullWidth
            value={addUsername}
            onChange={e => setAddUsername(e.target.value)}
            placeholder="user@company.com.sandbox"
            onKeyDown={e => { if (e.key === 'Enter') handleAddManually(); }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddManually} disabled={adding || !addUsername.trim()}>
            {adding ? 'Adding…' : 'Add & Test'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Auth error dialog */}
      <Dialog open={!!authError} onClose={() => setAuthError(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ErrorIcon color="error" /> Authentication Required
          </Box>
        </DialogTitle>
        <DialogContent>
          {authError && (
            <Box>
              <Alert severity="error" sx={{ mb: 2 }}>{authError.message}</Alert>
              <Typography variant="body2" sx={{ mb: 0.5 }}>Org: <strong>{authError.username}</strong></Typography>
              {authError.alias && <Typography variant="body2" sx={{ mb: 0.5 }}>Alias: <strong>{authError.alias}</strong></Typography>}
              {authError.instanceUrl && <Typography variant="body2" sx={{ mb: 2 }}>URL: {authError.instanceUrl}</Typography>}
              <Typography variant="subtitle2" gutterBottom>Run this command in your terminal:</Typography>
              <Paper sx={{ p: 1.5, bgcolor: 'grey.900', borderRadius: 1, mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'white', flex: 1, wordBreak: 'break-all' }}>
                    {authError.command}
                  </Typography>
                  <Button size="small" variant="outlined" sx={{ color: 'white', borderColor: 'grey.600', flexShrink: 0 }}
                    onClick={() => { navigator.clipboard.writeText(authError.command); showSnack('Copied!'); }}>
                    Copy
                  </Button>
                </Box>
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAuthError(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        severity={confirmDialog.severity || 'warning'}
        confirmText="Remove"
        cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      />

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default OrgManagement;
