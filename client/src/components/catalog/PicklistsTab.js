import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Grid, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Paper, Button, IconButton, Tooltip, Chip,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, CircularProgress, Alert,
} from '@mui/material';
import { Add, Edit, Delete, Refresh, List } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

const PicklistsTab = ({ selectedOrg, activeFilter, instanceUrl, onError, onSuccess }) => {
  // ── Picklists ────────────────────────────────────────────────────────────
  const [picklists, setPicklists]     = useState([]);
  const [plLoading, setPlLoading]     = useState(false);
  const [plSearch, setPlSearch]       = useState('');
  const [selectedPl, setSelectedPl]   = useState(null);
  const [plDialog, setPlDialog]       = useState({ open: false, data: null });

  // ── Picklist Values ──────────────────────────────────────────────────────
  const [values, setValues]           = useState([]);
  const [valLoading, setValLoading]   = useState(false);
  const [valDialog, setValDialog]     = useState({ open: false, data: null });

  const [saving, setSaving]           = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', onConfirm: null });

  // ── Fetch Picklists ──────────────────────────────────────────────────────
  const fetchPicklists = useCallback(async () => {
    if (!selectedOrg) return;
    setPlLoading(true);
    try {
      const params = { username: selectedOrg, search: plSearch, limit: 200, ...(activeFilter ? { isActive: 'true' } : {}) };
      const res = await axios.get('/api/catalog/picklists', { params });
      setPicklists(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setPlLoading(false);
    }
  }, [selectedOrg, plSearch, activeFilter, onError]);

  useEffect(() => { fetchPicklists(); }, [fetchPicklists]);

  // ── Fetch Values for selected picklist ──────────────────────────────────
  const fetchValues = useCallback(async () => {
    if (!selectedOrg || !selectedPl) { setValues([]); return; }
    setValLoading(true);
    try {
      const res = await axios.get(`/api/catalog/picklists/${selectedPl.Id}/values`, {
        params: { username: selectedOrg },
      });
      setValues(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setValLoading(false);
    }
  }, [selectedOrg, selectedPl, onError]);

  useEffect(() => { fetchValues(); }, [fetchValues]);

  // ── Picklist CRUD ────────────────────────────────────────────────────────
  const openPlCreate = () => setPlDialog({ open: true, data: { Name: '', vlocity_cmt__IsActive__c: true } });
  const openPlEdit   = (pl) => setPlDialog({ open: true, data: { ...pl } });

  const savePl = async () => {
    const { data } = plDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/picklists/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Picklist updated');
      } else {
        await axios.post('/api/catalog/picklists', { username: selectedOrg, ...data });
        onSuccess?.('Picklist created');
      }
      setPlDialog({ open: false, data: null });
      fetchPicklists();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deletePl = (pl) => {
    setConfirmDialog({
      open: true, title: 'Delete Picklist',
      message: `Delete "${pl.Name}"? All associated picklist values will be removed.`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/picklists/${pl.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Picklist deleted');
          if (selectedPl?.Id === pl.Id) setSelectedPl(null);
          fetchPicklists();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  // ── Picklist Value CRUD ──────────────────────────────────────────────────
  const openValCreate = () => setValDialog({ open: true, data: { Name: '', vlocity_cmt__Code__c: '', vlocity_cmt__Sequence__c: '', vlocity_cmt__IsDefaultValue__c: false, vlocity_cmt__IsActive__c: true } });
  const openValEdit   = (val) => setValDialog({ open: true, data: { ...val } });

  const saveVal = async () => {
    const { data } = valDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/picklists/${selectedPl.Id}/values/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Value updated');
      } else {
        await axios.post(`/api/catalog/picklists/${selectedPl.Id}/values`, { username: selectedOrg, ...data });
        onSuccess?.('Value created');
      }
      setValDialog({ open: false, data: null });
      fetchValues();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteVal = (val) => {
    setConfirmDialog({
      open: true, title: 'Delete Picklist Value',
      message: `Delete value "${val.Name}"?`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/picklists/${selectedPl.Id}/values/${val.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Value deleted');
          fetchValues();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  const SfLink = ({ id }) => instanceUrl ? (
    <Tooltip title="View in Salesforce">
      <IconButton size="small" component="a" href={`${instanceUrl}/${id}`} target="_blank" rel="noopener noreferrer">
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0070d2' }}>SF</span>
      </IconButton>
    </Tooltip>
  ) : null;

  if (!selectedOrg) return <Alert severity="info">Select an org to view picklists.</Alert>;

  return (
    <Box>
      <Grid container spacing={2}>
        {/* ── Left: Picklists ── */}
        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ height: '100%' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <List fontSize="small" color="action" />
              <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Picklists</Typography>
              <Tooltip title="Refresh">
                <span>
                  <IconButton size="small" onClick={fetchPicklists} disabled={plLoading}>
                    {plLoading ? <CircularProgress size={14} /> : <Refresh fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Add Picklist">
                <IconButton size="small" color="primary" onClick={openPlCreate}>
                  <Add fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Box sx={{ p: 1 }}>
              <TextField size="small" placeholder="Search picklists…" fullWidth value={plSearch}
                onChange={e => setPlSearch(e.target.value)} sx={{ mb: 1 }} />
            </Box>
            <Box sx={{ maxHeight: 480, overflowY: 'auto' }}>
              {picklists.length === 0 && !plLoading && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No picklists found.</Typography>
              )}
              {picklists.map(pl => (
                <Box
                  key={pl.Id}
                  onClick={() => setSelectedPl(pl)}
                  sx={{
                    px: 2, py: 1, cursor: 'pointer', borderBottom: 1, borderColor: 'divider',
                    backgroundColor: selectedPl?.Id === pl.Id ? 'primary.50' : 'transparent',
                    '&:hover': { backgroundColor: selectedPl?.Id === pl.Id ? 'primary.100' : 'grey.50' },
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography variant="body2" fontWeight={selectedPl?.Id === pl.Id ? 600 : 400} sx={{ flex: 1 }} noWrap>
                      {pl.Name}
                    </Typography>
                    <Chip label={pl.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                      color={pl.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" sx={{ fontSize: '0.65rem' }} />
                    <Tooltip title="Edit"><IconButton size="small" onClick={e => { e.stopPropagation(); openPlEdit(pl); }}><Edit sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" color="error" onClick={e => { e.stopPropagation(); deletePl(pl); }}><Delete sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                  </Stack>
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>

        {/* ── Right: Values ── */}
        <Grid item xs={12} md={8}>
          <Paper variant="outlined">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
                {selectedPl ? `Values — ${selectedPl.Name}` : 'Select a picklist'}
              </Typography>
              {selectedPl && (
                <>
                  <Tooltip title="Refresh">
                    <span>
                      <IconButton size="small" onClick={fetchValues} disabled={valLoading}>
                        {valLoading ? <CircularProgress size={14} /> : <Refresh fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Button size="small" variant="contained" startIcon={<Add />} onClick={openValCreate}>
                    Add Value
                  </Button>
                </>
              )}
            </Stack>

            {!selectedPl && (
              <Alert severity="info" sx={{ m: 2 }}>Select a picklist from the left to view its values.</Alert>
            )}

            {selectedPl && (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: 'grey.100' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Sequence</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Default</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                      {instanceUrl && <TableCell sx={{ fontWeight: 600, width: 50 }}>SF</TableCell>}
                      <TableCell sx={{ fontWeight: 600, width: 90 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {valLoading && (
                      <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3 }}><CircularProgress size={24} /></TableCell></TableRow>
                    )}
                    {!valLoading && values.length === 0 && (
                      <TableRow><TableCell colSpan={7}>
                        <Alert severity="info" sx={{ m: 1 }}>No values in this picklist.</Alert>
                      </TableCell></TableRow>
                    )}
                    {!valLoading && values.map(val => (
                      <TableRow key={val.Id} hover>
                        <TableCell sx={{ fontWeight: 500 }}>{val.Name}</TableCell>
                        <TableCell>{val.vlocity_cmt__Code__c}</TableCell>
                        <TableCell>{val.vlocity_cmt__Sequence__c}</TableCell>
                        <TableCell>
                          {val.vlocity_cmt__IsDefaultValue__c && (
                            <Chip label="Default" size="small" color="primary" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip label={val.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                            color={val.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                        </TableCell>
                        {instanceUrl && <TableCell><SfLink id={val.Id} /></TableCell>}
                        <TableCell>
                          <Stack direction="row" spacing={0.5}>
                            <Tooltip title="Edit"><IconButton size="small" onClick={() => openValEdit(val)}><Edit fontSize="small" /></IconButton></Tooltip>
                            <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteVal(val)}><Delete fontSize="small" /></IconButton></Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Picklist Form Dialog */}
      {plDialog.open && (
        <Dialog open onClose={() => setPlDialog({ open: false, data: null })} maxWidth="xs" fullWidth>
          <DialogTitle>{plDialog.data?.Id ? 'Edit Picklist' : 'New Picklist'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField size="small" label="Name" required fullWidth
                value={plDialog.data?.Name ?? ''}
                onChange={e => setPlDialog(prev => ({ ...prev, data: { ...prev.data, Name: e.target.value } }))} />
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={plDialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setPlDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPlDialog({ open: false, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={savePl} disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : null}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Picklist Value Form Dialog */}
      {valDialog.open && (
        <Dialog open onClose={() => setValDialog({ open: false, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{valDialog.data?.Id ? 'Edit Picklist Value' : 'New Picklist Value'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {[
                { field: 'Name',                          label: 'Name',     required: true },
                { field: 'vlocity_cmt__Code__c',          label: 'Code' },
                { field: 'vlocity_cmt__Sequence__c',      label: 'Sequence', type: 'number' },
              ].map(({ field, label, required, type }) => (
                <TextField key={field} size="small" label={label} required={required} fullWidth type={type || 'text'}
                  value={valDialog.data?.[field] ?? ''}
                  onChange={e => setValDialog(prev => ({ ...prev, data: { ...prev.data, [field]: e.target.value } }))} />
              ))}
              <FormControl size="small" fullWidth>
                <InputLabel>Default Value?</InputLabel>
                <Select value={valDialog.data?.vlocity_cmt__IsDefaultValue__c ?? false} label="Default Value?"
                  onChange={e => setValDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsDefaultValue__c: e.target.value } }))}>
                  <MenuItem value={true}>Yes</MenuItem>
                  <MenuItem value={false}>No</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={valDialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setValDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setValDialog({ open: false, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={saveVal} disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : null}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <ConfirmDialog open={confirmDialog.open} title={confirmDialog.title}
        message={confirmDialog.message} severity={confirmDialog.severity || 'error'}
        confirmText="Delete" cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))} />
    </Box>
  );
};

export default PicklistsTab;
