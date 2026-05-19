import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TableSortLabel, TablePagination,
  Paper, Button, IconButton, Tooltip, Chip,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Collapse, Stack, CircularProgress, Alert, Tabs, Tab,
} from '@mui/material';
import {
  Add, Edit, Delete, Refresh, FileDownload, ExpandMore, ExpandLess,
  CloudUpload,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

const PRICE_LIST_TYPES = [
  'Free Market', 'Social Market', 'Donation', 'Insurance',
  'Paid Up', 'Repair', 'Social Customer', 'Implants Registration',
];

const PriceListsTab = ({ selectedOrg, countryFilter, activeFilter, onError, onSuccess }) => {
  const navigate = useNavigate();
  // ── Price Lists state ────────────────────────────────────────────────────
  const [priceLists, setPriceLists]   = useState([]);
  const [loading, setLoading]         = useState(false);
  const [totalSize, setTotalSize]     = useState(0);
  const [page, setPage]               = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('');
  const [orderBy, setOrderBy]         = useState('Name');
  const [order, setOrder]             = useState('asc');
  const [expanded, setExpanded]       = useState(null); // priceListId

  // ── Entries / Pricing Elements state ────────────────────────────────────
  const [entries, setEntries]         = useState({});  // { [priceListId]: records }
  const [entriesLoading, setEntriesLoading] = useState({});
  const [expandedTab, setExpandedTab] = useState({}); // { [priceListId]: 'entries'|'pricing-elements' }
  const [pricingElements, setPricingElements] = useState({});
  const [pricingElementsLoading, setPricingElementsLoading] = useState({});

  // ── Pricing Element dialog ───────────────────────────────────────────────
  const [peDialog, setPeDialog] = useState({ open: false, priceListId: null, data: null });

  // ── Dialogs ──────────────────────────────────────────────────────────────
  const [plDialog, setPlDialog]       = useState({ open: false, data: null }); // price list form
  const [entryDialog, setEntryDialog] = useState({ open: false, priceListId: null, data: null }); // entry form
  const [saving, setSaving]           = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', onConfirm: null });

  // ── Fetch Price Lists ────────────────────────────────────────────────────
  const fetchPriceLists = useCallback(async () => {
    if (!selectedOrg) return;
    setLoading(true);
    try {
      const params = {
        username: selectedOrg, page, limit: rowsPerPage, search,
        ...(countryFilter && countryFilter !== 'ALL' ? { country: countryFilter } : {}),
        ...(activeFilter ? { isActive: 'true' } : {}),
        ...(typeFilter ? { priceListType: typeFilter } : {}),
      };
      const res = await axios.get('/api/catalog/price-lists', { params });
      setPriceLists(res.data.records || []);
      setTotalSize(res.data.totalSize || (res.data.records || []).length);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, page, rowsPerPage, search, countryFilter, activeFilter, typeFilter, onError]);

  useEffect(() => { fetchPriceLists(); }, [fetchPriceLists]);

  // ── Fetch Entries on expand ──────────────────────────────────────────────
  const fetchEntries = async (priceListId) => {
    if (entries[priceListId]) return; // already loaded
    setEntriesLoading(prev => ({ ...prev, [priceListId]: true }));
    try {
      const res = await axios.get(`/api/catalog/price-lists/${priceListId}/entries`, {
        params: { username: selectedOrg },
      });
      setEntries(prev => ({ ...prev, [priceListId]: res.data.records || [] }));
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setEntriesLoading(prev => ({ ...prev, [priceListId]: false }));
    }
  };

  const toggleExpand = (priceListId) => {
    if (expanded === priceListId) {
      setExpanded(null);
    } else {
      setExpanded(priceListId);
      const tab = expandedTab[priceListId] || 'entries';
      if (tab === 'entries') fetchEntries(priceListId);
      else fetchPricingElements(priceListId);
    }
  };

  // ── Fetch Pricing Elements on expand ────────────────────────────────────
  const fetchPricingElements = async (priceListId) => {
    if (pricingElements[priceListId]) return;
    setPricingElementsLoading(prev => ({ ...prev, [priceListId]: true }));
    try {
      const res = await axios.get(`/api/catalog/price-lists/${priceListId}/pricing-elements`, {
        params: { username: selectedOrg },
      });
      setPricingElements(prev => ({ ...prev, [priceListId]: res.data.records || [] }));
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setPricingElementsLoading(prev => ({ ...prev, [priceListId]: false }));
    }
  };

  const handleExpandedTabChange = (priceListId, tab) => {
    setExpandedTab(prev => ({ ...prev, [priceListId]: tab }));
    if (tab === 'entries') fetchEntries(priceListId);
    else fetchPricingElements(priceListId);
  };

  // ── Pricing Element CRUD ─────────────────────────────────────────────────
  const openPeCreate = (priceListId) => setPeDialog({ open: true, priceListId, data: {
    vlocity_cmt__Amount__c: '', vlocity_cmt__IsActive__c: true,
  }});
  const openPeEdit = (priceListId, pe) => setPeDialog({ open: true, priceListId, data: { ...pe } });

  const savePe = async () => {
    const { priceListId, data } = peDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/price-lists/${priceListId}/pricing-elements/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Pricing element updated');
      } else {
        await axios.post(`/api/catalog/price-lists/${priceListId}/pricing-elements`, { username: selectedOrg, ...data });
        onSuccess?.('Pricing element created');
      }
      setPeDialog({ open: false, priceListId: null, data: null });
      setPricingElements(prev => { const n = { ...prev }; delete n[priceListId]; return n; });
      fetchPricingElements(priceListId);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deletePe = (priceListId, pe) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Pricing Element',
      message: `Delete pricing element "${pe.Name}"?`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/price-lists/${priceListId}/pricing-elements/${pe.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Pricing element deleted');
          setPricingElements(prev => {
            const rows = (prev[priceListId] || []).filter(e => e.Id !== pe.Id);
            return { ...prev, [priceListId]: rows };
          });
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  // ── Sort ─────────────────────────────────────────────────────────────────
  const handleSort = (field) => {
    setOrder(prev => orderBy === field && prev === 'asc' ? 'desc' : 'asc');
    setOrderBy(field);
  };

  const sorted = [...priceLists].sort((a, b) => {
    const va = a[orderBy] ?? ''; const vb = b[orderBy] ?? '';
    return (order === 'asc' ? 1 : -1) * String(va).localeCompare(String(vb));
  });

  // ── Price List CRUD ──────────────────────────────────────────────────────
  const openPlEdit = (pl) => setPlDialog({ open: true, data: { ...pl } });
  const openPlCreate = () => setPlDialog({ open: true, data: {
    Name: '', vlocity_cmt__Code__c: '', vlocity_cmt__Description__c: '',
    vlocity_cmt__CurrencyCode__c: 'EUR', vlocity_cmt__IsActive__c: true,
    GT_PriceListType__c: '', GT_CountryCode__c: '',
  }});

  const savePl = async () => {
    const { data } = plDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/price-lists/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Price list updated');
      } else {
        await axios.post('/api/catalog/price-lists', { username: selectedOrg, ...data });
        onSuccess?.('Price list created');
      }
      setPlDialog({ open: false, data: null });
      fetchPriceLists();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deletePl = (pl) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Price List',
      message: `Delete "${pl.Name}"? All associated entries will also be removed.`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/price-lists/${pl.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Price list deleted');
          fetchPriceLists();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  // ── Entry CRUD ───────────────────────────────────────────────────────────
  const openEntryCreate = (priceListId) => setEntryDialog({ open: true, priceListId, data: {
    vlocity_cmt__UnitPrice__c: '', vlocity_cmt__CurrencyCode__c: 'EUR',
    vlocity_cmt__IsActive__c: true,
  }});
  const openEntryEdit = (priceListId, entry) => setEntryDialog({ open: true, priceListId, data: { ...entry } });

  const saveEntry = async () => {
    const { priceListId, data } = entryDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/price-lists/${priceListId}/entries/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Entry updated');
      } else {
        await axios.post(`/api/catalog/price-lists/${priceListId}/entries`, { username: selectedOrg, ...data });
        onSuccess?.('Entry created');
      }
      setEntryDialog({ open: false, priceListId: null, data: null });
      // Invalidate cache so re-expand fetches fresh data
      setEntries(prev => { const n = { ...prev }; delete n[priceListId]; return n; });
      fetchEntries(priceListId);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = (priceListId, entry) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Price List Entry',
      message: `Delete entry "${entry.Name}"?`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/price-lists/${priceListId}/entries/${entry.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Entry deleted');
          setEntries(prev => {
            const rows = (prev[priceListId] || []).filter(e => e.Id !== entry.Id);
            return { ...prev, [priceListId]: rows };
          });
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  const csvExport = () => {
    const rows = priceLists.map(pl => [
      pl.Name, pl.vlocity_cmt__Code__c, pl.GT_CountryCode__c,
      pl.vlocity_cmt__CurrencyCode__c, pl.GT_PriceListType__c,
      pl.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive',
    ]);
    const csv = ['Name,Code,Country,Currency,Type,Status', ...rows.map(r => r.map(v => `"${v ?? ''}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `price_lists_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <Box>
      {/* Filters */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <TextField size="small" placeholder="Search price lists…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }} sx={{ minWidth: 220 }} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Type</InputLabel>
          <Select value={typeFilter} label="Type" onChange={e => setTypeFilter(e.target.value)}>
            <MenuItem value="">All Types</MenuItem>
            {PRICE_LIST_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchPriceLists} disabled={loading || !selectedOrg} size="small">
              {loading ? <CircularProgress size={18} /> : <Refresh />}
            </IconButton>
          </span>
        </Tooltip>
        <Button size="small" variant="outlined" startIcon={<FileDownload />} onClick={csvExport} disabled={!priceLists.length}>
          Export CSV
        </Button>
        <Button size="small" variant="contained" startIcon={<Add />} onClick={openPlCreate} disabled={!selectedOrg}>
          Add Price List
        </Button>
      </Stack>

      {!selectedOrg && <Alert severity="info">Select an org to view price lists.</Alert>}

      {selectedOrg && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell width={32} />
                {[
                  { f: 'Name', l: 'Name' },
                  { f: 'vlocity_cmt__Code__c', l: 'Code' },
                  { f: 'GT_CountryCode__c', l: 'Country' },
                  { f: 'vlocity_cmt__CurrencyCode__c', l: 'Currency' },
                  { f: 'GT_PriceListType__c', l: 'Type' },
                  { f: 'vlocity_cmt__IsActive__c', l: 'Status' },
                ].map(({ f, l }) => (
                  <TableCell key={f} sx={{ fontWeight: 600 }}>
                    <TableSortLabel active={orderBy === f} direction={orderBy === f ? order : 'asc'} onClick={() => handleSort(f)}>
                      {l}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell sx={{ fontWeight: 600, width: 110 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              )}
              {!loading && sorted.length === 0 && (
                <TableRow><TableCell colSpan={8}><Alert severity="info" sx={{ m: 1 }}>No price lists found.</Alert></TableCell></TableRow>
              )}
              {!loading && sorted.map(pl => (
                <React.Fragment key={pl.Id}>
                  <TableRow
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/catalog/price-lists/${pl.Id}?username=${encodeURIComponent(selectedOrg)}`)}
                  >
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Tooltip title={expanded === pl.Id ? 'Collapse entries' : 'Expand entries'}>
                        <IconButton size="small" onClick={() => toggleExpand(pl.Id)}>
                          {expanded === pl.Id ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500 }}>{pl.Name}</TableCell>
                    <TableCell>{pl.vlocity_cmt__Code__c}</TableCell>
                    <TableCell>{pl.GT_CountryCode__c}</TableCell>
                    <TableCell>{pl.vlocity_cmt__CurrencyCode__c}</TableCell>
                    <TableCell>{pl.GT_PriceListType__c}</TableCell>
                    <TableCell>
                      <Chip label={pl.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'}
                        size="small" color={pl.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => openPlEdit(pl)}><Edit fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Export DataPack"><IconButton size="small"><CloudUpload fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deletePl(pl)}><Delete fontSize="small" /></IconButton></Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>

                  {/* Entries / Pricing Elements sub-panel */}
                  <TableRow>
                    <TableCell colSpan={8} sx={{ p: 0, border: 0 }}>
                      <Collapse in={expanded === pl.Id} unmountOnExit>
                        <Box sx={{ backgroundColor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
                          {/* Sub-tabs */}
                          <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
                            <Tabs
                              value={expandedTab[pl.Id] || 'entries'}
                              onChange={(_, v) => handleExpandedTabChange(pl.Id, v)}
                              size="small"
                              sx={{ minHeight: 36 }}
                            >
                              <Tab label="Price List Entries" value="entries" sx={{ minHeight: 36, fontSize: '0.8rem', textTransform: 'none' }} />
                              <Tab label="Pricing Elements" value="pricing-elements" sx={{ minHeight: 36, fontSize: '0.8rem', textTransform: 'none' }} />
                            </Tabs>
                          </Box>

                          <Box sx={{ p: 2 }}>
                            {/* ── Entries panel ── */}
                            {(expandedTab[pl.Id] || 'entries') === 'entries' && (
                              <>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                  <Typography variant="subtitle2" color="text.secondary">
                                    Entries for {pl.Name}
                                  </Typography>
                                  <Box sx={{ flex: 1 }} />
                                  <Button size="small" variant="outlined" startIcon={<Add />}
                                    onClick={() => openEntryCreate(pl.Id)} disabled={!selectedOrg}>
                                    Add Entry
                                  </Button>
                                </Stack>
                                {entriesLoading[pl.Id] && <CircularProgress size={20} />}
                                {!entriesLoading[pl.Id] && entries[pl.Id]?.length === 0 && (
                                  <Alert severity="info">No entries for this price list.</Alert>
                                )}
                                {!entriesLoading[pl.Id] && entries[pl.Id]?.length > 0 && (
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow sx={{ backgroundColor: 'grey.100' }}>
                                        <TableCell sx={{ fontWeight: 600 }}>Product</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Product Code</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Currency</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                                        <TableCell sx={{ fontWeight: 600, width: 90 }}>Actions</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {entries[pl.Id].map(entry => (
                                        <TableRow key={entry.Id} hover>
                                          <TableCell>{entry.vlocity_cmt__ProductId__r?.Name || entry.vlocity_cmt__ProductId__c}</TableCell>
                                          <TableCell>{entry.vlocity_cmt__ProductId__r?.ProductCode}</TableCell>
                                          <TableCell>{entry.vlocity_cmt__UnitPrice__c}</TableCell>
                                          <TableCell>{entry.vlocity_cmt__CurrencyCode__c}</TableCell>
                                          <TableCell>
                                            <Chip label={entry.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                                              color={entry.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                                          </TableCell>
                                          <TableCell>
                                            <Stack direction="row" spacing={0.5}>
                                              <Tooltip title="Edit"><IconButton size="small" onClick={() => openEntryEdit(pl.Id, entry)}><Edit fontSize="small" /></IconButton></Tooltip>
                                              <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteEntry(pl.Id, entry)}><Delete fontSize="small" /></IconButton></Tooltip>
                                            </Stack>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                )}
                              </>
                            )}

                            {/* ── Pricing Elements panel ── */}
                            {expandedTab[pl.Id] === 'pricing-elements' && (
                              <>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                  <Typography variant="subtitle2" color="text.secondary">
                                    Pricing Elements for {pl.Name}
                                  </Typography>
                                  <Box sx={{ flex: 1 }} />
                                  <Button size="small" variant="outlined" startIcon={<Add />}
                                    onClick={() => openPeCreate(pl.Id)} disabled={!selectedOrg}>
                                    Add Element
                                  </Button>
                                </Stack>
                                {pricingElementsLoading[pl.Id] && <CircularProgress size={20} />}
                                {!pricingElementsLoading[pl.Id] && pricingElements[pl.Id]?.length === 0 && (
                                  <Alert severity="info">No pricing elements for this price list.</Alert>
                                )}
                                {!pricingElementsLoading[pl.Id] && pricingElements[pl.Id]?.length > 0 && (
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow sx={{ backgroundColor: 'grey.100' }}>
                                        <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Pricing Variable</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                                        <TableCell sx={{ fontWeight: 600, width: 90 }}>Actions</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {pricingElements[pl.Id].map(pe => (
                                        <TableRow key={pe.Id} hover>
                                          <TableCell>{pe.Name}</TableCell>
                                          <TableCell>{pe.vlocity_cmt__PricingVariableId__r?.Name || pe.vlocity_cmt__PricingVariableId__c}</TableCell>
                                          <TableCell>{pe.vlocity_cmt__Amount__c}</TableCell>
                                          <TableCell>
                                            <Chip label={pe.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                                              color={pe.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                                          </TableCell>
                                          <TableCell>
                                            <Stack direction="row" spacing={0.5}>
                                              <Tooltip title="Edit"><IconButton size="small" onClick={() => openPeEdit(pl.Id, pe)}><Edit fontSize="small" /></IconButton></Tooltip>
                                              <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deletePe(pl.Id, pe)}><Delete fontSize="small" /></IconButton></Tooltip>
                                            </Stack>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                )}
                              </>
                            )}
                          </Box>
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          <TablePagination component="div" count={totalSize} page={page}
            onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]} />
        </TableContainer>
      )}

      {/* Price List Form Dialog */}
      {plDialog.open && (
        <Dialog open onClose={() => setPlDialog({ open: false, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{plDialog.data?.Id ? 'Edit Price List' : 'New Price List'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {[
                { field: 'Name', label: 'Name', required: true },
                { field: 'vlocity_cmt__Code__c', label: 'Code', required: true },
                { field: 'vlocity_cmt__Description__c', label: 'Description' },
                { field: 'vlocity_cmt__CurrencyCode__c', label: 'Currency Code' },
                { field: 'GT_CountryCode__c', label: 'Country Code' },
              ].map(({ field, label, required }) => (
                <TextField key={field} size="small" label={label} required={required} fullWidth
                  value={plDialog.data?.[field] ?? ''}
                  onChange={e => setPlDialog(prev => ({ ...prev, data: { ...prev.data, [field]: e.target.value } }))} />
              ))}
              <FormControl size="small" fullWidth>
                <InputLabel>Price List Type</InputLabel>
                <Select value={plDialog.data?.GT_PriceListType__c ?? ''} label="Price List Type"
                  onChange={e => setPlDialog(prev => ({ ...prev, data: { ...prev.data, GT_PriceListType__c: e.target.value } }))}>
                  <MenuItem value="">— None —</MenuItem>
                  {PRICE_LIST_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
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

      {/* Entry Form Dialog */}
      {entryDialog.open && (
        <Dialog open onClose={() => setEntryDialog({ open: false, priceListId: null, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{entryDialog.data?.Id ? 'Edit Entry' : 'New Price List Entry'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField size="small" label="Product ID (SF Id or External)" fullWidth
                value={entryDialog.data?.vlocity_cmt__Product2Id__c ?? ''}
                onChange={e => setEntryDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__Product2Id__c: e.target.value } }))} />
              <TextField size="small" label="Unit Price" type="number" fullWidth
                value={entryDialog.data?.vlocity_cmt__UnitPrice__c ?? ''}
                onChange={e => setEntryDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__UnitPrice__c: e.target.value } }))} />
              <TextField size="small" label="List Price" type="number" fullWidth
                value={entryDialog.data?.vlocity_cmt__ListPrice__c ?? ''}
                onChange={e => setEntryDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__ListPrice__c: e.target.value } }))} />
              <TextField size="small" label="Currency Code" fullWidth
                value={entryDialog.data?.vlocity_cmt__CurrencyCode__c ?? 'EUR'}
                onChange={e => setEntryDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__CurrencyCode__c: e.target.value } }))} />
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={entryDialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setEntryDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEntryDialog({ open: false, priceListId: null, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={saveEntry} disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : null}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Pricing Element Form Dialog */}
      {peDialog.open && (
        <Dialog open onClose={() => setPeDialog({ open: false, priceListId: null, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{peDialog.data?.Id ? 'Edit Pricing Element' : 'New Pricing Element'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField size="small" label="Name" fullWidth
                value={peDialog.data?.Name ?? ''}
                onChange={e => setPeDialog(prev => ({ ...prev, data: { ...prev.data, Name: e.target.value } }))} />
              <TextField size="small" label="Pricing Variable ID (SF Id)" fullWidth
                value={peDialog.data?.vlocity_cmt__PricingVariableId__c ?? ''}
                onChange={e => setPeDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__PricingVariableId__c: e.target.value } }))} />
              <TextField size="small" label="Amount" type="number" fullWidth
                value={peDialog.data?.vlocity_cmt__Amount__c ?? ''}
                onChange={e => setPeDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__Amount__c: e.target.value } }))} />
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={peDialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setPeDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPeDialog({ open: false, priceListId: null, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={savePe} disabled={saving}
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

export default PriceListsTab;
