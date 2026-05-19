import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, TextField, Button, IconButton,
  Tooltip, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TableSortLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, CircularProgress, Alert, Autocomplete,
} from '@mui/material';
import { Add, Delete, Refresh, OpenInNew } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

const ProductRelationshipsTab = ({ selectedOrg, instanceUrl, onError, onSuccess }) => {
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [orderBy, setOrderBy]       = useState('parent');
  const [order, setOrder]           = useState('asc');

  // Filter by parent product
  const [filterParent, setFilterParent]   = useState(null);
  const [filterSearch, setFilterSearch]   = useState('');
  const [filterOptions, setFilterOptions] = useState([]);
  const [filterSearching, setFilterSearching] = useState(false);

  // Add dialog
  const [addOpen, setAddOpen]       = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [parentOptions, setParentOptions] = useState([]);
  const [parentSearching, setParentSearching] = useState(false);
  const [selectedParent, setSelectedParent] = useState(null);
  const [childSearch, setChildSearch]   = useState('');
  const [childOptions, setChildOptions] = useState([]);
  const [childSearching, setChildSearching] = useState(false);
  const [selectedChild, setSelectedChild] = useState(null);
  const [adding, setAdding]         = useState(false);

  const [confirmDialog, setConfirmDialog] = useState({ open: false });

  // ── Helpers ──────────────────────────────────────────────────────────────
  const parentName = (r) => r.vlocity_cmt__ParentProductId__r?.Name || r.vlocity_cmt__ParentProductId__c || '—';
  const parentCode = (r) => r.vlocity_cmt__ParentProductId__r?.ProductCode || '';
  const childName  = (r) => r.vlocity_cmt__ChildProductId__r?.Name  || r.vlocity_cmt__ChildProductId__c  || '—';
  const childCode  = (r) => r.vlocity_cmt__ChildProductId__r?.ProductCode  || '';

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchItems = useCallback(async () => {
    if (!selectedOrg) return;
    setLoading(true);
    try {
      const res = await axios.get('/api/catalog/product-child-items', {
        params: {
          username: selectedOrg,
          ...(filterParent ? { parentProductId: filterParent.Id } : {}),
        },
      });
      setItems(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally { setLoading(false); }
  }, [selectedOrg, filterParent, onError]);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { setItems([]); setFilterParent(null); }, [selectedOrg]);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const handleSort = (f) => {
    setOrder(prev => orderBy === f && prev === 'asc' ? 'desc' : 'asc');
    setOrderBy(f);
  };
  const sorted = [...items].sort((a, b) => {
    const va = orderBy === 'parent' ? parentName(a) : orderBy === 'child' ? childName(a) : (a[orderBy] ?? '');
    const vb = orderBy === 'parent' ? parentName(b) : orderBy === 'child' ? childName(b) : (b[orderBy] ?? '');
    return (order === 'asc' ? 1 : -1) * String(va).localeCompare(String(vb));
  });

  // ── Product search (filter bar) ───────────────────────────────────────────
  useEffect(() => {
    if (!filterSearch || filterSearch.length < 2) { setFilterOptions([]); return; }
    const t = setTimeout(async () => {
      setFilterSearching(true);
      try {
        const res = await axios.get('/api/catalog/products', {
          params: { username: selectedOrg, search: filterSearch, limit: 20 },
        });
        setFilterOptions(res.data.records || []);
      } catch { setFilterOptions([]); } finally { setFilterSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [filterSearch, selectedOrg]);

  // ── Product search (add dialog — parent) ──────────────────────────────────
  useEffect(() => {
    if (!parentSearch || parentSearch.length < 2) { setParentOptions([]); return; }
    const t = setTimeout(async () => {
      setParentSearching(true);
      try {
        const res = await axios.get('/api/catalog/products', {
          params: { username: selectedOrg, search: parentSearch, limit: 20 },
        });
        setParentOptions(res.data.records || []);
      } catch { setParentOptions([]); } finally { setParentSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [parentSearch, selectedOrg]);

  // ── Product search (add dialog — child) ───────────────────────────────────
  useEffect(() => {
    if (!childSearch || childSearch.length < 2) { setChildOptions([]); return; }
    const t = setTimeout(async () => {
      setChildSearching(true);
      try {
        const res = await axios.get('/api/catalog/products', {
          params: { username: selectedOrg, search: childSearch, limit: 20 },
        });
        setChildOptions(res.data.records || []);
      } catch { setChildOptions([]); } finally { setChildSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [childSearch, selectedOrg]);

  // ── Add relationship ──────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!selectedParent || !selectedChild) return;
    setAdding(true);
    try {
      await axios.post('/api/catalog/product-child-items', {
        username: selectedOrg,
        parentProductId: selectedParent.Id,
        childProductId:  selectedChild.Id,
      });
      onSuccess?.(`"${selectedChild.Name}" added as child of "${selectedParent.Name}"`);
      setAddOpen(false); setSelectedParent(null); setSelectedChild(null);
      setParentSearch(''); setChildSearch('');
      fetchItems();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally { setAdding(false); }
  };

  // ── Delete relationship ───────────────────────────────────────────────────
  const handleDelete = (rel) => {
    setConfirmDialog({
      open: true, title: 'Remove Product Relationship', severity: 'warning',
      message: `Remove "${childName(rel)}" as a child of "${parentName(rel)}"?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/product-child-items/${rel.Id}`, {
            params: { username: selectedOrg },
          });
          onSuccess?.('Product relationship removed');
          fetchItems();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  const productLabel = (opt) => `${opt.Name}${opt.ProductCode ? ` (${opt.ProductCode})` : ''}`;
  const colSpan = instanceUrl ? 5 : 4;

  if (!selectedOrg) return <Alert severity="info">Select an org to view product relationships.</Alert>;

  return (
    <Box>
      {/* ── Filter bar ────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Autocomplete
            sx={{ minWidth: 300 }}
            options={filterOptions} loading={filterSearching} value={filterParent}
            onChange={(_, v) => setFilterParent(v)}
            inputValue={filterSearch} onInputChange={(_, v) => setFilterSearch(v)}
            getOptionLabel={productLabel} isOptionEqualToValue={(o, v) => o.Id === v.Id}
            noOptionsText={filterSearch.length < 2 ? 'Type 2+ chars to search…' : 'No products found'}
            renderInput={params => (
              <TextField {...params} label="Filter by Parent Product" size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (<>{filterSearching ? <CircularProgress size={16} /> : null}{params.InputProps.endAdornment}</>),
                }} />
            )}
          />
          <Tooltip title="Refresh">
            <span>
              <IconButton size="small" onClick={fetchItems} disabled={loading}>
                {loading ? <CircularProgress size={16} /> : <Refresh fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" size="small" startIcon={<Add />}
            onClick={() => { setAddOpen(true); setSelectedParent(null); setSelectedChild(null); setParentSearch(''); setChildSearch(''); }}>
            Add Relationship
          </Button>
        </Stack>
        {filterParent && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            Showing children of: <strong>{filterParent.Name}</strong>
            {filterParent.ProductCode && ` (${filterParent.ProductCode})`}
          </Typography>
        )}
      </Paper>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={{ backgroundColor: 'grey.100' }}>
              <TableCell sx={{ fontWeight: 600 }}>
                <TableSortLabel active={orderBy === 'parent'} direction={orderBy === 'parent' ? order : 'asc'} onClick={() => handleSort('parent')}>
                  Parent Product
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Parent Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>
                <TableSortLabel active={orderBy === 'child'} direction={orderBy === 'child' ? order : 'asc'} onClick={() => handleSort('child')}>
                  Child Product
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Child Code</TableCell>
              {instanceUrl && <TableCell sx={{ fontWeight: 600, width: 50 }}>SF</TableCell>}
              <TableCell sx={{ fontWeight: 600, width: 70 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={colSpan} align="center" sx={{ py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
            )}
            {!loading && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan}>
                  <Alert severity="info" sx={{ m: 1 }}>
                    {filterParent
                      ? `No child products found for "${filterParent.Name}".`
                      : 'No product relationships found. Use the filter to search by parent product, or add a new relationship.'}
                  </Alert>
                </TableCell>
              </TableRow>
            )}
            {!loading && sorted.map(rel => (
              <TableRow key={rel.Id} hover>
                <TableCell sx={{ fontWeight: 500 }}>{parentName(rel)}</TableCell>
                <TableCell><Typography variant="caption" color="text.secondary">{parentCode(rel)}</Typography></TableCell>
                <TableCell>{childName(rel)}</TableCell>
                <TableCell><Typography variant="caption" color="text.secondary">{childCode(rel)}</Typography></TableCell>
                {instanceUrl && (
                  <TableCell>
                    <Tooltip title="View relationship in Salesforce">
                      <IconButton size="small" component="a"
                        href={`${instanceUrl}/${rel.Id}`} target="_blank" rel="noopener noreferrer">
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
                <TableCell>
                  <Tooltip title="Remove relationship">
                    <IconButton size="small" color="error" onClick={() => handleDelete(rel)}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {items.length} relationship{items.length !== 1 ? 's' : ''}
        {filterParent ? ` for "${filterParent.Name}"` : ' (filter by parent to narrow results)'}
      </Typography>

      {/* ── Add relationship dialog ────────────────────────────────────── */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Product Relationship</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              options={parentOptions} loading={parentSearching} value={selectedParent}
              onChange={(_, v) => setSelectedParent(v)}
              inputValue={parentSearch} onInputChange={(_, v) => setParentSearch(v)}
              getOptionLabel={productLabel} isOptionEqualToValue={(o, v) => o.Id === v.Id}
              noOptionsText={parentSearch.length < 2 ? 'Type 2+ chars to search…' : 'No products found'}
              renderInput={params => (
                <TextField {...params} label="Parent Product" size="small" fullWidth required
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (<>{parentSearching ? <CircularProgress size={16} /> : null}{params.InputProps.endAdornment}</>),
                  }} />
              )}
            />
            <Autocomplete
              options={childOptions} loading={childSearching} value={selectedChild}
              onChange={(_, v) => setSelectedChild(v)}
              inputValue={childSearch} onInputChange={(_, v) => setChildSearch(v)}
              getOptionLabel={productLabel} isOptionEqualToValue={(o, v) => o.Id === v.Id}
              noOptionsText={childSearch.length < 2 ? 'Type 2+ chars to search…' : 'No products found'}
              renderInput={params => (
                <TextField {...params} label="Child Product" size="small" fullWidth required
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (<>{childSearching ? <CircularProgress size={16} /> : null}{params.InputProps.endAdornment}</>),
                  }} />
              )}
            />
            {selectedParent && selectedChild && (
              <Alert severity="success" sx={{ py: 0.5 }}>
                <strong>{selectedParent.Name}</strong> → <strong>{selectedChild.Name}</strong>
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={!selectedParent || !selectedChild || adding}
            startIcon={adding ? <CircularProgress size={16} /> : <Add />}>
            {adding ? 'Adding…' : 'Add Relationship'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog open={confirmDialog.open} title={confirmDialog.title}
        message={confirmDialog.message} severity={confirmDialog.severity || 'warning'}
        confirmText="Remove" cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))} />
    </Box>
  );
};

export default ProductRelationshipsTab;
