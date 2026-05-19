import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Grid, Paper, Typography, TextField, Button, IconButton,
  Tooltip, Chip, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TableSortLabel, TablePagination,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, CircularProgress, Alert, Autocomplete, Tabs, Tab,
} from '@mui/material';
import { Add, Edit, Delete, Refresh, OpenInNew } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

// ── Relationship sub-panel (shared for Products and Sub-Catalogs) ────────────
const RelationshipPanel = ({
  selectedCatalog, selectedOrg, instanceUrl,
  itemType,          // 'Product' | 'Catalog'
  onError, onSuccess,
}) => {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [orderBy, setOrderBy]     = useState('Name');
  const [order, setOrder]         = useState('asc');

  // Add dialog
  const [addOpen, setAddOpen]       = useState(false);
  const [searchVal, setSearchVal]   = useState('');
  const [options, setOptions]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [selected, setSelected]     = useState(null);
  const [adding, setAdding]         = useState(false);

  const [confirmDialog, setConfirmDialog] = useState({ open: false });

  const isProduct = itemType === 'Product';
  const label     = isProduct ? 'product' : 'sub-catalog';
  const Label     = isProduct ? 'Product'  : 'Sub-Catalog';

  const linkedName = (r) =>
    r.vlocity_cmt__Product2Id__r?.Name || r.vlocity_cmt__Product2Id__c || '—';
  const linkedCode = (r) =>
    r.vlocity_cmt__Product2Id__r?.ProductCode || '—';

  // ── Fetch items ────────────────────────────────────────────────────────────
  const fetchItems = useCallback(async () => {
    if (!selectedCatalog || !selectedOrg) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/catalog/catalogs/${selectedCatalog.Id}/products`, {
        params: { username: selectedOrg, itemType },
      });
      setItems(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally { setLoading(false); }
  }, [selectedCatalog, selectedOrg, itemType, onError]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // ── Sort ───────────────────────────────────────────────────────────────────
  const handleSort = (f) => {
    setOrder(prev => orderBy === f && prev === 'asc' ? 'desc' : 'asc');
    setOrderBy(f);
  };
  const sorted = [...items].sort((a, b) => {
    const va = orderBy === 'Name' ? linkedName(a) : (a[orderBy] ?? '');
    const vb = orderBy === 'Name' ? linkedName(b) : (b[orderBy] ?? '');
    return (order === 'asc' ? 1 : -1) * String(va).localeCompare(String(vb));
  });

  // ── Search autocomplete ────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchVal || searchVal.length < 2) { setOptions([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const endpoint = isProduct ? '/api/catalog/products' : '/api/catalog/catalogs';
        const res = await axios.get(endpoint, {
          params: { username: selectedOrg, search: searchVal, limit: 20 },
        });
        setOptions(res.data.records || []);
      } catch { setOptions([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchVal, selectedOrg, isProduct]);

  // ── Add relationship ───────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!selected || !selectedCatalog) return;
    setAdding(true);
    try {
      await axios.post(`/api/catalog/catalogs/${selectedCatalog.Id}/products`, {
        username: selectedOrg, productId: selected.Id, itemType,
      });
      onSuccess?.(`"${selected.Name}" added as ${label}`);
      setAddOpen(false); setSelected(null); setSearchVal('');
      fetchItems();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally { setAdding(false); }
  };

  // ── Remove ─────────────────────────────────────────────────────────────────
  const handleRemove = (rel) => {
    const name = linkedName(rel);
    setConfirmDialog({
      open: true,
      title: `Remove ${Label}`,
      message: `Remove "${name}" from catalog "${selectedCatalog?.Name}"?`,
      severity: 'warning',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/catalogs/${selectedCatalog.Id}/products/${rel.Id}`, {
            params: { username: selectedOrg },
          });
          onSuccess?.(`"${name}" removed from catalog`);
          fetchItems();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  const colSpan = instanceUrl ? 4 : 3;

  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          {Label}s in: <em>{selectedCatalog.Name}</em>
        </Typography>
        <Tooltip title="Refresh">
          <span>
            <IconButton size="small" onClick={fetchItems} disabled={loading}>
              {loading ? <CircularProgress size={16} /> : <Refresh fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
        <Button size="small" variant="contained" startIcon={<Add />}
          onClick={() => { setAddOpen(true); setSelected(null); setSearchVal(''); }}>
          Add {Label}
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 500, overflowY: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={{ backgroundColor: 'grey.100' }}>
              <TableCell sx={{ fontWeight: 600 }}>
                <TableSortLabel active={orderBy === 'Name'} direction={orderBy === 'Name' ? order : 'asc'}
                  onClick={() => handleSort('Name')}>
                  {Label} Name
                </TableSortLabel>
              </TableCell>
              {isProduct && <TableCell sx={{ fontWeight: 600 }}>Product Code</TableCell>}
              {instanceUrl && <TableCell sx={{ fontWeight: 600, width: 50 }}>SF</TableCell>}
              <TableCell sx={{ fontWeight: 600, width: 70 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={colSpan} align="center" sx={{ py: 3 }}><CircularProgress size={22} /></TableCell></TableRow>
            )}
            {!loading && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan}>
                  <Alert severity="info" sx={{ m: 1 }}>No {label}s assigned to this catalog.</Alert>
                </TableCell>
              </TableRow>
            )}
            {!loading && sorted.map(rel => (
              <TableRow key={rel.Id} hover>
                <TableCell sx={{ fontWeight: 500 }}>{linkedName(rel)}</TableCell>
                {isProduct && <TableCell>{linkedCode(rel)}</TableCell>}
                {instanceUrl && (
                  <TableCell>
                    <Tooltip title={`View ${label} in Salesforce`}>
                      <IconButton size="small" component="a"
                        href={`${instanceUrl}/${rel.vlocity_cmt__Product2Id__c}`}
                        target="_blank" rel="noopener noreferrer">
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
                <TableCell>
                  <Tooltip title={`Remove ${label} from catalog`}>
                    <IconButton size="small" color="error" onClick={() => handleRemove(rel)}>
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
        {items.length} {label}{items.length !== 1 ? 's' : ''} assigned
      </Typography>

      {/* Add dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add {Label} to "{selectedCatalog?.Name}"</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              options={options} loading={searching} value={selected}
              onChange={(_, v) => setSelected(v)}
              inputValue={searchVal} onInputChange={(_, v) => setSearchVal(v)}
              getOptionLabel={opt => `${opt.Name}${opt.ProductCode ? ` (${opt.ProductCode})` : ''}`}
              isOptionEqualToValue={(opt, val) => opt.Id === val.Id}
              noOptionsText={searchVal.length < 2 ? `Type at least 2 characters to search…` : `No ${label}s found`}
              renderInput={params => (
                <TextField {...params} label={`Search ${Label}s`} size="small" fullWidth
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (<>{searching ? <CircularProgress size={16} /> : null}{params.InputProps.endAdornment}</>),
                  }} />
              )}
            />
            {selected && (
              <Alert severity="success" sx={{ py: 0.5 }}>
                Selected: <strong>{selected.Name}</strong>
                {selected.ProductCode && ` — ${selected.ProductCode}`}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={!selected || adding}
            startIcon={adding ? <CircularProgress size={16} /> : <Add />}>
            {adding ? 'Adding…' : `Add ${Label}`}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog open={confirmDialog.open} title={confirmDialog.title}
        message={confirmDialog.message} severity={confirmDialog.severity || 'warning'}
        confirmText="Remove" cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))} />
    </>
  );
};

// ── Main CatalogsTab ─────────────────────────────────────────────────────────
const CatalogsTab = ({ selectedOrg, activeFilter, instanceUrl, onError, onSuccess }) => {
  const [catalogs, setCatalogs]       = useState([]);
  const [catLoading, setCatLoading]   = useState(false);
  const [catSearch, setCatSearch]     = useState('');
  const [catSearchInput, setCatSearchInput] = useState(''); // raw input, debounced into catSearch
  const [catPage, setCatPage]         = useState(0);
  const [catTotal, setCatTotal]       = useState(0);
  const [catRowsPer, setCatRowsPer]   = useState(25);
  const [catOrderBy, setCatOrderBy]   = useState('Name');
  const [catOrder, setCatOrder]       = useState('asc');
  const [selectedCatalog, setSelectedCatalog] = useState(null);
  const [rightTab, setRightTab]       = useState(0); // 0=Products, 1=Sub-Catalogs

  const [catDialog, setCatDialog]     = useState({ open: false, data: null });
  const [catSaving, setCatSaving]     = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false });

  // ── Fetch catalogs ─────────────────────────────────────────────────────────
  const fetchCatalogs = useCallback(async () => {
    if (!selectedOrg) return;
    setCatLoading(true);
    try {
      const params = {
        username: selectedOrg, page: catPage, limit: catRowsPer, search: catSearch,
        ...(activeFilter ? { isActive: 'true' } : {}),
      };
      const res = await axios.get('/api/catalog/catalogs', { params });
      const records = res.data.records || [];
      setCatalogs(records);
      setCatTotal(res.data.totalSize || records.length);
      // Auto-select: keep current selection if still in results, else pick first
      setSelectedCatalog(prev =>
        prev && records.find(r => r.Id === prev.Id)
          ? prev
          : (records[0] || null)
      );
    } catch (err) { onError?.(err.response?.data?.message || err.message); }
    finally { setCatLoading(false); }
  }, [selectedOrg, catPage, catRowsPer, catSearch, activeFilter, onError]);

  useEffect(() => { fetchCatalogs(); }, [fetchCatalogs]);
  // Reset selection when org changes so fetchCatalogs auto-selects the first catalog in the new org
  useEffect(() => { setSelectedCatalog(null); }, [selectedOrg]);

  // Debounce search input → catSearch (300 ms)
  useEffect(() => {
    const t = setTimeout(() => { setCatSearch(catSearchInput); setCatPage(0); }, 300);
    return () => clearTimeout(t);
  }, [catSearchInput]);

  // ── Catalog sorting ────────────────────────────────────────────────────────
  const handleCatSort = (f) => {
    setCatOrder(prev => catOrderBy === f && prev === 'asc' ? 'desc' : 'asc');
    setCatOrderBy(f);
  };
  const sortedCatalogs = [...catalogs].sort((a, b) => {
    const va = a[catOrderBy] ?? ''; const vb = b[catOrderBy] ?? '';
    return (catOrder === 'asc' ? 1 : -1) * String(va).localeCompare(String(vb));
  });

  // ── Catalog CRUD ───────────────────────────────────────────────────────────
  const openCreate = () => setCatDialog({ open: true, data: { Name: '', vlocity_cmt__Code__c: '' } });
  const openEdit   = (rec) => setCatDialog({ open: true, data: { ...rec } });

  const saveCatalog = async () => {
    const { data } = catDialog;
    setCatSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/catalogs/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Catalog updated');
        if (selectedCatalog?.Id === data.Id) setSelectedCatalog(data);
      } else {
        await axios.post('/api/catalog/catalogs', { username: selectedOrg, ...data });
        onSuccess?.('Catalog created');
      }
      setCatDialog({ open: false, data: null });
      fetchCatalogs();
    } catch (err) { onError?.(err.response?.data?.message || err.message); }
    finally { setCatSaving(false); }
  };

  const deleteCatalog = (rec) => {
    setConfirmDialog({
      open: true, title: 'Delete Catalog', severity: 'error',
      message: `Delete catalog "${rec.Name}"? Existing relationships will become orphaned.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/catalogs/${rec.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Catalog deleted');
          if (selectedCatalog?.Id === rec.Id) setSelectedCatalog(null);
          fetchCatalogs();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  if (!selectedOrg) return <Alert severity="info">Select an org to view catalogs.</Alert>;

  return (
    <Box>
      <Grid container spacing={2}>
        {/* ── Left panel: Catalog list ──────────────────────────────── */}
        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <TextField size="small" placeholder="Search catalogs…" value={catSearchInput}
                onChange={e => setCatSearchInput(e.target.value)}
                sx={{ flex: 1 }} />
              <Tooltip title="Refresh">
                <span>
                  <IconButton size="small" onClick={fetchCatalogs} disabled={catLoading}>
                    {catLoading ? <CircularProgress size={16} /> : <Refresh fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="New Catalog">
                <IconButton size="small" color="primary" onClick={openCreate}><Add fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>

            <TableContainer sx={{ maxHeight: 520, overflowY: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      <TableSortLabel active={catOrderBy === 'Name'} direction={catOrderBy === 'Name' ? catOrder : 'asc'}
                        onClick={() => handleCatSort('Name')}>Name</TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 70 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 80 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {catLoading && <TableRow><TableCell colSpan={3} align="center" sx={{ py: 3 }}><CircularProgress size={22} /></TableCell></TableRow>}
                  {!catLoading && sortedCatalogs.length === 0 && (
                    <TableRow><TableCell colSpan={3}><Alert severity="info" sx={{ m: 1 }}>No catalogs found.</Alert></TableCell></TableRow>
                  )}
                  {!catLoading && sortedCatalogs.map(cat => (
                    <TableRow key={cat.Id} hover selected={selectedCatalog?.Id === cat.Id}
                      onClick={() => setSelectedCatalog(cat)}
                      sx={{ cursor: 'pointer', '&.Mui-selected': { backgroundColor: 'primary.50' } }}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{cat.Name}</Typography>
                        {cat.vlocity_cmt__Code__c && (
                          <Typography variant="caption" color="text.secondary">{cat.vlocity_cmt__Code__c}</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {cat.vlocity_cmt__IsActive__c !== undefined && (
                          <Chip label={cat.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                            color={cat.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(cat)}><Edit fontSize="small" /></IconButton></Tooltip>
                          {instanceUrl && (
                            <Tooltip title="View in Salesforce">
                              <IconButton size="small" component="a" href={`${instanceUrl}/${cat.Id}`} target="_blank" rel="noopener noreferrer">
                                <OpenInNew fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteCatalog(cat)}><Delete fontSize="small" /></IconButton></Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination component="div" count={catTotal} page={catPage}
              onPageChange={(_, p) => setCatPage(p)} rowsPerPage={catRowsPer}
              onRowsPerPageChange={e => { setCatRowsPer(parseInt(e.target.value, 10)); setCatPage(0); }}
              rowsPerPageOptions={[10, 25, 50]} />
          </Paper>
        </Grid>

        {/* ── Right panel: Products / Sub-Catalogs ──────────────────── */}
        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            {!selectedCatalog ? (
              <Alert severity="info">Select a catalog on the left to view its contents.</Alert>
            ) : (
              <>
                <Tabs value={rightTab} onChange={(_, v) => setRightTab(v)} sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  <Tab label="Products" />
                  <Tab label="Sub-Catalogs" />
                </Tabs>
                {rightTab === 0 && (
                  <RelationshipPanel
                    key={`prod-${selectedCatalog.Id}`}
                    selectedCatalog={selectedCatalog} selectedOrg={selectedOrg}
                    instanceUrl={instanceUrl} itemType="Product"
                    onError={onError} onSuccess={onSuccess}
                  />
                )}
                {rightTab === 1 && (
                  <RelationshipPanel
                    key={`cat-${selectedCatalog.Id}`}
                    selectedCatalog={selectedCatalog} selectedOrg={selectedOrg}
                    instanceUrl={instanceUrl} itemType="Catalog"
                    onError={onError} onSuccess={onSuccess}
                  />
                )}
              </>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Catalog create/edit dialog */}
      {catDialog.open && (
        <Dialog open onClose={() => setCatDialog({ open: false, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{catDialog.data?.Id ? 'Edit Catalog' : 'New Catalog'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {[
                { field: 'Name',                        label: 'Name',        required: true },
                { field: 'vlocity_cmt__Code__c',        label: 'Code' },
                { field: 'vlocity_cmt__Description__c', label: 'Description' },
                { field: 'vlocity_cmt__CatalogType__c', label: 'Catalog Type' },
              ].map(({ field, label, required }) => (
                <TextField key={field} size="small" label={label} required={required} fullWidth
                  value={catDialog.data?.[field] ?? ''}
                  onChange={e => setCatDialog(prev => ({ ...prev, data: { ...prev.data, [field]: e.target.value } }))} />
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCatDialog({ open: false, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={saveCatalog} disabled={catSaving}
              startIcon={catSaving ? <CircularProgress size={16} /> : null}>
              {catSaving ? 'Saving…' : 'Save'}
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

export default CatalogsTab;
