import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, Alert, CircularProgress, Chip, FormControl,
  InputLabel, Select, MenuItem, TextField,
} from '@mui/material';
import { CameraAlt, Restore, Visibility, Refresh } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

const SnapshotsPanel = ({ selectedOrg, orgs = [], onError, onSuccess }) => {
  const [snapshots, setSnapshots]       = useState([]);
  const [loading, setLoading]           = useState(false);
  const [creating, setCreating]         = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [viewDialog, setViewDialog]     = useState({ open: false, snapshot: null, data: null });
  const [viewLoading, setViewLoading]   = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', onConfirm: null });
  const [restoreTarget, setRestoreTarget] = useState('');

  const fetchSnapshots = useCallback(async () => {
    if (!selectedOrg) return;
    setLoading(true);
    try {
      const res = await axios.get('/api/catalog/snapshots', { params: { username: selectedOrg } });
      setSnapshots(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, onError]);

  useEffect(() => { fetchSnapshots(); }, [fetchSnapshots]);

  const createSnapshot = async () => {
    setCreating(true);
    try {
      const label = snapshotLabel.trim() || `Manual snapshot — ${new Date().toLocaleString()}`;
      await axios.post('/api/catalog/snapshots', { username: selectedOrg, label });
      onSuccess?.('Snapshot created successfully');
      setSnapshotLabel('');
      fetchSnapshots();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setCreating(false);
    }
  };

  const viewSnapshot = async (snapshot) => {
    setViewLoading(true);
    setViewDialog({ open: true, snapshot, data: null });
    try {
      const res = await axios.get(`/api/catalog/snapshots/${snapshot.id}`);
      setViewDialog({ open: true, snapshot, data: res.data.data });
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
      setViewDialog({ open: false, snapshot: null, data: null });
    } finally {
      setViewLoading(false);
    }
  };

  const confirmRestore = (snapshot) => {
    if (!restoreTarget) {
      onError?.('Select a target org for restore');
      return;
    }
    setConfirmDialog({
      open: true,
      title: 'Restore Snapshot',
      message: `Restore snapshot "${snapshot.name}" to org "${restoreTarget}"?\n\nThis will upsert all catalog records (Price Lists, Promotions, Rate Codes, Products) from the snapshot into the target org. Existing records with matching keys will be updated.`,
      severity: 'warning',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          const res = await axios.post(`/api/catalog/snapshots/${snapshot.id}/restore`, { targetUsername: restoreTarget });
          const { summary } = res.data.data;
          onSuccess?.(`Restore complete: ${summary.success} records restored, ${summary.errors} errors`);
          fetchSnapshots();
        } catch (err) {
          onError?.(err.response?.data?.message || err.message);
        }
      },
    });
  };

  const isAutomatic = (snapshot) => snapshot.configuration?.isAutomatic;

  return (
    <Box>
      {/* Create Snapshot Panel */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Create Manual Snapshot</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }}>
          <TextField size="small" label="Snapshot Label (optional)" value={snapshotLabel}
            onChange={e => setSnapshotLabel(e.target.value)}
            placeholder="e.g. Before country expansion" sx={{ flex: 1, maxWidth: 400 }} />
          <Button variant="contained" startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <CameraAlt />}
            onClick={createSnapshot} disabled={creating || !selectedOrg}>
            {creating ? 'Creating…' : 'Create Snapshot'}
          </Button>
        </Stack>
        {!selectedOrg && <Alert severity="info" sx={{ mt: 2 }}>Select an org to create snapshots.</Alert>}
      </Paper>

      {/* Restore target selector */}
      {selectedOrg && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Restore Configuration</Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 280 }}>
              <InputLabel>Target Org for Restore</InputLabel>
              <Select value={restoreTarget} label="Target Org for Restore" onChange={e => setRestoreTarget(e.target.value)}>
                <MenuItem value="">— Select target org —</MenuItem>
                {orgs.filter(o => o.username !== selectedOrg).map(o => (
                  <MenuItem key={o.username} value={o.username}>{o.alias || o.username}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              Choose the org where the snapshot will be restored. Can be the same or a different org.
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Snapshot Timeline */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>Snapshot History</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchSnapshots} disabled={!selectedOrg} size="small">
              {loading ? <CircularProgress size={18} /> : <Refresh />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {!selectedOrg && <Alert severity="info">Select an org to view snapshots.</Alert>}

      {selectedOrg && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Label</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Records Captured</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 130 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              )}
              {!loading && snapshots.length === 0 && (
                <TableRow><TableCell colSpan={5}><Alert severity="info" sx={{ m: 1 }}>No snapshots yet. Create one above or run a deploy job to generate an automatic pre-deploy snapshot.</Alert></TableCell></TableRow>
              )}
              {!loading && snapshots.map(snap => {
                const counts = snap.configuration?.recordCounts || snap.result?.recordCounts || {};
                const isAuto = isAutomatic(snap);
                return (
                  <TableRow key={snap.id} hover>
                    <TableCell>
                      <Chip
                        label={isAuto ? 'Auto' : 'Manual'}
                        size="small"
                        color={isAuto ? 'info' : 'secondary'}
                        variant="outlined"
                        icon={isAuto ? undefined : <CameraAlt fontSize="small" />}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{snap.name}</Typography>
                      {snap.configuration?.relatedJobId && (
                        <Typography variant="caption" color="text.secondary">
                          Deploy job: {snap.configuration.relatedJobId.substring(0, 8)}…
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {counts.priceLists !== undefined && <Chip label={`${counts.priceLists} PL`} size="small" variant="outlined" />}
                        {counts.promotions !== undefined && <Chip label={`${counts.promotions} Promo`} size="small" variant="outlined" />}
                        {counts.rateCodes  !== undefined && <Chip label={`${counts.rateCodes} RC`} size="small" variant="outlined" />}
                        {counts.rateTables !== undefined && <Chip label={`${counts.rateTables} RT`} size="small" variant="outlined" />}
                        {counts.products   !== undefined && <Chip label={`${counts.products} Prod`} size="small" variant="outlined" />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {snap.createdAt ? new Date(snap.createdAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="View snapshot details">
                          <IconButton size="small" onClick={() => viewSnapshot(snap)}>
                            <Visibility fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={restoreTarget ? `Restore to ${restoreTarget}` : 'Select a target org first'}>
                          <span>
                            <IconButton size="small" color="warning" onClick={() => confirmRestore(snap)} disabled={!restoreTarget}>
                              <Restore fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* View Snapshot Dialog */}
      <Dialog open={viewDialog.open} onClose={() => setViewDialog({ open: false, snapshot: null, data: null })} maxWidth="md" fullWidth>
        <DialogTitle>Snapshot: {viewDialog.snapshot?.name}</DialogTitle>
        <DialogContent>
          {viewLoading && <CircularProgress size={24} sx={{ m: 2 }} />}
          {!viewLoading && viewDialog.data && (
            <Box>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                Captured: {viewDialog.data.capturedAt ? new Date(viewDialog.data.capturedAt).toLocaleString() : '—'}
                {' · '}Org: {viewDialog.data.username}
              </Typography>
              <Table size="small" sx={{ mt: 2 }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'grey.100' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Object Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Records</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[
                    { label: 'Price Lists',  key: 'priceLists' },
                    { label: 'Promotions',   key: 'promotions' },
                    { label: 'Rate Codes',   key: 'rateCodes' },
                    { label: 'Rate Tables',  key: 'rateTables' },
                    { label: 'Products',     key: 'products' },
                  ].map(({ label, key }) => (
                    <TableRow key={key}>
                      <TableCell>{label}</TableCell>
                      <TableCell>{viewDialog.data[key]?.length ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialog({ open: false, snapshot: null, data: null })}>Close</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog open={confirmDialog.open} title={confirmDialog.title}
        message={confirmDialog.message} severity={confirmDialog.severity || 'warning'}
        confirmText="Restore" cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))} />
    </Box>
  );
};

export default SnapshotsPanel;
