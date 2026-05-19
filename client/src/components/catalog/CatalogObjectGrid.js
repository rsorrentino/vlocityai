import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TableSortLabel, TablePagination,
  Paper, Button, IconButton, Tooltip, Chip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Alert, Stack,
} from '@mui/material';
import { Add, Edit, Delete, Refresh, FileDownload, CloudUpload, OpenInNew } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

/**
 * CatalogObjectGrid — Generic reusable CRUD grid for catalog objects.
 *
 * Props:
 *   title          — Page section title
 *   endpoint       — Base API path, e.g. '/api/catalog/products'
 *   columns        — Array of { field, label, render? }
 *   formFields     — Array of { field, label, type?, required?, options? }
 *   selectedOrg    — Currently selected Salesforce username
 *   filters        — Additional query params (country, isActive, etc.) from parent
 *   onError        — Callback (message) for parent to display error
 *   onSuccess      — Callback (message) for parent to display success
 */
const CatalogObjectGrid = ({
  title,
  endpoint,
  columns,
  formFields,
  selectedOrg,
  filters = {},
  instanceUrl,
  onError,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const [records, setRecords]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [totalSize, setTotalSize] = useState(0);
  const [page, setPage]           = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch]       = useState('');
  const [orderBy, setOrderBy]     = useState('Name');
  const [order, setOrder]         = useState('asc');
  const [formOpen, setFormOpen]   = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [formData, setFormData]   = useState({});
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', onConfirm: null });

  const fetchRecords = useCallback(async () => {
    if (!selectedOrg) return;
    setLoading(true);
    try {
      const params = { username: selectedOrg, page, limit: rowsPerPage, search, ...filters };
      const response = await axios.get(endpoint, { params });
      setRecords(response.data.records || []);
      setTotalSize(response.data.totalSize || (response.data.records || []).length);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, page, rowsPerPage, search, endpoint, filters, onError]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // ── Sorting ─────────────────────────────────────────────────────────────
  const handleSort = (field) => {
    setOrder(prev => orderBy === field && prev === 'asc' ? 'desc' : 'asc');
    setOrderBy(field);
  };

  const sortedRecords = [...records].sort((a, b) => {
    const va = a[orderBy] ?? '';
    const vb = b[orderBy] ?? '';
    const cmp = String(va).localeCompare(String(vb));
    return order === 'asc' ? cmp : -cmp;
  });

  // ── CSV Export ───────────────────────────────────────────────────────────
  const handleCsvExport = () => {
    if (!records.length) return;
    const headers = columns.map(c => c.label).join(',');
    const rows = records.map(r =>
      columns.map(c => {
        const v = r[c.field] ?? '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(',')
    );
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Export DataPack bridge ───────────────────────────────────────────────
  const handleExportDataPack = (record) => {
    // Pre-fill an export job with this record's GlobalKey
    const globalKey = record.vlocity_cmt__GlobalKey__c || record.GT_GlobalKey__c;
    const objectType = guessVlocityDataPackType(endpoint);
    navigate('/exports', {
      state: {
        prefilledConfig: {
          name: `Export ${title} — ${record.Name}`,
          queries: globalKey
            ? [{ VlocityDataPackType: objectType, query: `SELECT Id FROM ${getSobjectName(endpoint)} WHERE vlocity_cmt__GlobalKey__c = '${globalKey}'` }]
            : [],
        },
      },
    });
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditRecord(null);
    setFormData({});
    setFormOpen(true);
  };

  const openEdit = (record) => {
    setEditRecord(record);
    setFormData({ ...record });
    setFormOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editRecord) {
        await axios.patch(`${endpoint}/${editRecord.Id}`, { username: selectedOrg, ...formData });
        onSuccess?.(`${title.replace(/s$/, '')} updated`);
      } else {
        await axios.post(endpoint, { username: selectedOrg, ...formData });
        onSuccess?.(`${title.replace(/s$/, '')} created`);
      }
      setFormOpen(false);
      fetchRecords();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (record) => {
    setConfirmDialog({
      open: true,
      title: `Delete ${title.replace(/s$/, '')}`,
      message: `Delete "${record.Name}"? This action cannot be undone and will remove the record directly from Salesforce.`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`${endpoint}/${record.Id}`, { params: { username: selectedOrg } });
          onSuccess?.(`${title.replace(/s$/, '')} deleted`);
          fetchRecords();
        } catch (err) {
          onError?.(err.response?.data?.message || err.message);
        }
      },
    });
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  return (
    <Box>
      {/* Toolbar */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <TextField
          size="small"
          placeholder={`Search ${title}...`}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          sx={{ minWidth: 220 }}
        />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchRecords} disabled={loading || !selectedOrg} size="small">
              {loading ? <CircularProgress size={18} /> : <Refresh />}
            </IconButton>
          </span>
        </Tooltip>
        <Button size="small" variant="outlined" startIcon={<FileDownload />} onClick={handleCsvExport} disabled={!records.length}>
          Export CSV
        </Button>
        <Button size="small" variant="contained" startIcon={<Add />} onClick={openCreate} disabled={!selectedOrg}>
          Add
        </Button>
      </Stack>

      {!selectedOrg && (
        <Alert severity="info">Select an org to view and manage {title.toLowerCase()}.</Alert>
      )}

      {selectedOrg && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                {columns.map(col => (
                  <TableCell key={col.field} sx={{ fontWeight: 600 }}>
                    <TableSortLabel
                      active={orderBy === col.field}
                      direction={orderBy === col.field ? order : 'asc'}
                      onClick={() => handleSort(col.field)}
                    >
                      {col.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell sx={{ fontWeight: 600, width: 120 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              )}
              {!loading && sortedRecords.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length + 1}>
                    <Alert severity="info" sx={{ m: 1 }}>No {title.toLowerCase()} found.</Alert>
                  </TableCell>
                </TableRow>
              )}
              {!loading && sortedRecords.map(record => (
                <TableRow
                  key={record.Id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/catalog/${getObjectTypeFromEndpoint(endpoint)}/${record.Id}?username=${encodeURIComponent(selectedOrg)}`)}
                >
                  {columns.map(col => (
                    <TableCell key={col.field}>
                      {col.render ? col.render(record[col.field], record) : renderValue(record[col.field])}
                    </TableCell>
                  ))}
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(record)}>
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Export DataPack">
                        <IconButton size="small" onClick={() => handleExportDataPack(record)}>
                          <CloudUpload fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {instanceUrl && (
                        <Tooltip title="View in Salesforce">
                          <IconButton size="small" component="a"
                            href={`${instanceUrl}/${record.Id}`} target="_blank" rel="noopener noreferrer">
                            <OpenInNew fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => handleDelete(record)}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={totalSize}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </TableContainer>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editRecord ? `Edit ${title.replace(/s$/, '')}` : `New ${title.replace(/s$/, '')}`}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {formFields.map(field => (
              <TextField
                key={field.field}
                size="small"
                label={field.label}
                required={field.required}
                type={field.type || 'text'}
                value={formData[field.field] ?? ''}
                onChange={e => setFormData(prev => ({ ...prev, [field.field]: e.target.value }))}
                fullWidth
                select={!!field.options}
                SelectProps={field.options ? { native: true } : undefined}
              >
                {field.options && field.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </TextField>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : null}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        severity={confirmDialog.severity || 'error'}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      />
    </Box>
  );
};

// ── Utility helpers ──────────────────────────────────────────────────────────
function renderValue(v) {
  if (v === null || v === undefined) return <Typography variant="caption" color="text.disabled">—</Typography>;
  if (typeof v === 'boolean') return <Chip label={v ? 'Yes' : 'No'} size="small" color={v ? 'success' : 'default'} variant="outlined" />;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v).toLocaleDateString();
  return String(v);
}

function getObjectTypeFromEndpoint(endpoint) {
  // e.g. '/api/catalog/products' -> 'products', '/api/catalog/rate-codes' -> 'rate-codes'
  const parts = endpoint.split('/');
  return parts[parts.length - 1];
}

function guessVlocityDataPackType(endpoint) {
  if (endpoint.includes('price-list')) return 'PriceList';
  if (endpoint.includes('promotion'))  return 'SObject';
  if (endpoint.includes('rate-code'))  return 'SObject';
  if (endpoint.includes('rate-table')) return 'RateTable';
  if (endpoint.includes('product'))    return 'SObject';
  return 'SObject';
}

function getSobjectName(endpoint) {
  if (endpoint.includes('price-list')) return 'vlocity_cmt__PriceList__c';
  if (endpoint.includes('promotion'))  return 'vlocity_cmt__Promotion__c';
  if (endpoint.includes('rate-code'))  return 'GT_RateCode__c';
  if (endpoint.includes('rate-table')) return 'GT_RateTable__c';
  if (endpoint.includes('product'))    return 'Product2';
  return 'SObject';
}

export default CatalogObjectGrid;
