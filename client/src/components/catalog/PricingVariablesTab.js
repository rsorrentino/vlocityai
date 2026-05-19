import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TableSortLabel, TablePagination,
  Paper, Button, IconButton, Tooltip, Chip,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, CircularProgress, Alert,
} from '@mui/material';
import { Add, Edit, Delete, Refresh } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

const PricingVariablesTab = ({ selectedOrg, activeFilter, instanceUrl, onError, onSuccess }) => {
  const [records, setRecords]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [totalSize, setTotalSize]     = useState(0);
  const [page, setPage]               = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch]           = useState('');
  const [orderBy, setOrderBy]         = useState('Name');
  const [order, setOrder]             = useState('asc');
  const [dialog, setDialog]           = useState({ open: false, data: null });
  const [saving, setSaving]           = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', onConfirm: null });

  const fetchRecords = useCallback(async () => {
    if (!selectedOrg) return;
    setLoading(true);
    try {
      const params = {
        username: selectedOrg, page, limit: rowsPerPage, search,
        ...(activeFilter ? { isActive: 'true' } : {}),
      };
      const res = await axios.get('/api/catalog/pricing-variables', { params });
      setRecords(res.data.records || []);
      setTotalSize(res.data.totalSize || (res.data.records || []).length);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, page, rowsPerPage, search, activeFilter, onError]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleSort = (field) => {
    setOrder(prev => orderBy === field && prev === 'asc' ? 'desc' : 'asc');
    setOrderBy(field);
  };

  const sorted = [...records].sort((a, b) => {
    const va = a[orderBy] ?? ''; const vb = b[orderBy] ?? '';
    return (order === 'asc' ? 1 : -1) * String(va).localeCompare(String(vb));
  });

  const openCreate = () => setDialog({ open: true, data: {
    Name: '', vlocity_cmt__Code__c: '', vlocity_cmt__Description__c: '',
    vlocity_cmt__IsActive__c: true,
  }});
  const openEdit = (rec) => setDialog({ open: true, data: { ...rec } });

  const save = async () => {
    const { data } = dialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/pricing-variables/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Pricing variable updated');
      } else {
        await axios.post('/api/catalog/pricing-variables', { username: selectedOrg, ...data });
        onSuccess?.('Pricing variable created');
      }
      setDialog({ open: false, data: null });
      fetchRecords();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = (rec) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Pricing Variable',
      message: `Delete "${rec.Name}"? This may break pricing elements that reference it.`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/pricing-variables/${rec.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Pricing variable deleted');
          fetchRecords();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  const COLUMNS = [
    { f: 'Name',                        l: 'Name' },
    { f: 'vlocity_cmt__Code__c',        l: 'Code' },
    { f: 'vlocity_cmt__Description__c', l: 'Description' },
    { f: 'vlocity_cmt__IsActive__c',    l: 'Status' },
  ];

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <TextField size="small" placeholder="Search pricing variables…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }} sx={{ minWidth: 220 }} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchRecords} disabled={loading || !selectedOrg} size="small">
              {loading ? <CircularProgress size={18} /> : <Refresh />}
            </IconButton>
          </span>
        </Tooltip>
        <Button size="small" variant="contained" startIcon={<Add />} onClick={openCreate} disabled={!selectedOrg}>
          Add Variable
        </Button>
      </Stack>

      {!selectedOrg && <Alert severity="info">Select an org to view pricing variables.</Alert>}

      {selectedOrg && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                {COLUMNS.map(({ f, l }) => (
                  <TableCell key={f} sx={{ fontWeight: 600 }}>
                    <TableSortLabel active={orderBy === f} direction={orderBy === f ? order : 'asc'} onClick={() => handleSort(f)}>
                      {l}
                    </TableSortLabel>
                  </TableCell>
                ))}
                {instanceUrl && (
                  <TableCell sx={{ fontWeight: 600, width: 50 }}>SF</TableCell>
                )}
                <TableCell sx={{ fontWeight: 600, width: 90 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              )}
              {!loading && sorted.length === 0 && (
                <TableRow><TableCell colSpan={7}><Alert severity="info" sx={{ m: 1 }}>No pricing variables found.</Alert></TableCell></TableRow>
              )}
              {!loading && sorted.map(rec => (
                <TableRow key={rec.Id} hover>
                  <TableCell sx={{ fontWeight: 500 }}>{rec.Name}</TableCell>
                  <TableCell>{rec.vlocity_cmt__Code__c}</TableCell>
                  <TableCell>{rec.vlocity_cmt__Description__c}</TableCell>
                  <TableCell>
                    <Chip label={rec.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                      color={rec.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  {instanceUrl && (
                    <TableCell>
                      <Tooltip title="View in Salesforce">
                        <IconButton size="small" component="a" href={`${instanceUrl}/${rec.Id}`} target="_blank" rel="noopener noreferrer">
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0070d2' }}>SF</span>
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(rec)}><Edit fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteRecord(rec)}><Delete fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination component="div" count={totalSize} page={page}
            onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]} />
        </TableContainer>
      )}

      {dialog.open && (
        <Dialog open onClose={() => setDialog({ open: false, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{dialog.data?.Id ? 'Edit Pricing Variable' : 'New Pricing Variable'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {[
                { field: 'Name',                        label: 'Name',        required: true },
                { field: 'vlocity_cmt__Code__c',        label: 'Code',        required: true },
                { field: 'vlocity_cmt__Description__c', label: 'Description'  },
              ].map(({ field, label, required }) => (
                <TextField key={field} size="small" label={label} required={required} fullWidth
                  value={dialog.data?.[field] ?? ''}
                  onChange={e => setDialog(prev => ({ ...prev, data: { ...prev.data, [field]: e.target.value } }))} />
              ))}
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={dialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialog({ open: false, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={saving}
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

export default PricingVariablesTab;
