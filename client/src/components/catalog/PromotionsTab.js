import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TableSortLabel, TablePagination,
  Paper, Button, IconButton, Tooltip, Chip,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Drawer, Stack, CircularProgress, Alert, Divider,
} from '@mui/material';
import { Add, Edit, Delete, Refresh, FileDownload, Rule } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

const CONDITION_TYPES = ['Quantity', 'Amount', 'Product', 'Category'];
const ACTION_TYPES    = ['Discount', 'FreeItem', 'Bundle'];
const DISCOUNT_TYPES  = ['Percentage', 'Amount'];

const PromotionsTab = ({ selectedOrg, activeFilter, onError, onSuccess }) => {
  // ── Promotions state ─────────────────────────────────────────────────────
  const [promotions, setPromotions]   = useState([]);
  const [loading, setLoading]         = useState(false);
  const [totalSize, setTotalSize]     = useState(0);
  const [page, setPage]               = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch]           = useState('');
  const [orderBy, setOrderBy]         = useState('Name');
  const [order, setOrder]             = useState('asc');

  // ── Rules drawer state ───────────────────────────────────────────────────
  const [rulesDrawer, setRulesDrawer]   = useState({ open: false, promotion: null });
  const [rules, setRules]               = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);

  // ── Dialogs ──────────────────────────────────────────────────────────────
  const [promoDialog, setPromoDialog] = useState({ open: false, data: null });
  const [ruleDialog, setRuleDialog]   = useState({ open: false, promotionId: null, data: null });
  const [saving, setSaving]           = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', onConfirm: null });

  // ── Fetch Promotions ─────────────────────────────────────────────────────
  const fetchPromotions = useCallback(async () => {
    if (!selectedOrg) return;
    setLoading(true);
    try {
      const params = {
        username: selectedOrg, page, limit: rowsPerPage, search,
        ...(activeFilter !== undefined ? { isActive: activeFilter } : {}),
      };
      const res = await axios.get('/api/catalog/promotions', { params });
      setPromotions(res.data.records || []);
      setTotalSize(res.data.totalSize || (res.data.records || []).length);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, page, rowsPerPage, search, activeFilter, onError]);

  useEffect(() => { fetchPromotions(); }, [fetchPromotions]);

  // ── Fetch Rules ──────────────────────────────────────────────────────────
  const openRulesDrawer = async (promotion) => {
    setRulesDrawer({ open: true, promotion });
    setRulesLoading(true);
    try {
      const res = await axios.get(`/api/catalog/promotions/${promotion.Id}/rules`, { params: { username: selectedOrg } });
      setRules(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setRulesLoading(false);
    }
  };

  const closeRulesDrawer = () => setRulesDrawer({ open: false, promotion: null });

  // ── Sort ─────────────────────────────────────────────────────────────────
  const handleSort = (field) => {
    setOrder(prev => orderBy === field && prev === 'asc' ? 'desc' : 'asc');
    setOrderBy(field);
  };

  const sorted = [...promotions].sort((a, b) => {
    const va = a[orderBy] ?? ''; const vb = b[orderBy] ?? '';
    return (order === 'asc' ? 1 : -1) * String(va).localeCompare(String(vb));
  });

  // ── Promotions CRUD ──────────────────────────────────────────────────────
  const openPromoCreate = () => setPromoDialog({ open: true, data: {
    Name: '', vlocity_cmt__Code__c: '', vlocity_cmt__Description__c: '',
    vlocity_cmt__DiscountType__c: 'Percentage', vlocity_cmt__DiscountValue__c: '',
    vlocity_cmt__IsActive__c: true,
  }});
  const openPromoEdit = (p) => setPromoDialog({ open: true, data: { ...p } });

  const savePromo = async () => {
    const { data } = promoDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/promotions/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Promotion updated');
      } else {
        await axios.post('/api/catalog/promotions', { username: selectedOrg, ...data });
        onSuccess?.('Promotion created');
      }
      setPromoDialog({ open: false, data: null });
      fetchPromotions();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deletePromo = (p) => {
    setConfirmDialog({
      open: true, title: 'Delete Promotion',
      message: `Delete promotion "${p.Name}"?`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/promotions/${p.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Promotion deleted');
          fetchPromotions();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  // ── Rules CRUD ───────────────────────────────────────────────────────────
  const openRuleCreate = (promotionId) => setRuleDialog({ open: true, promotionId, data: {
    Name: '', ConditionType__c: 'Quantity', ConditionValue__c: '',
    ActionType__c: 'Discount', ActionValue__c: '', Priority__c: 10, IsActive__c: true,
  }});
  const openRuleEdit = (promotionId, rule) => setRuleDialog({ open: true, promotionId, data: { ...rule } });

  const saveRule = async () => {
    const { promotionId, data } = ruleDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/promotions/${promotionId}/rules/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Rule updated');
      } else {
        await axios.post(`/api/catalog/promotions/${promotionId}/rules`, { username: selectedOrg, ...data });
        onSuccess?.('Rule created');
      }
      setRuleDialog({ open: false, promotionId: null, data: null });
      // Refresh rules in drawer
      const res = await axios.get(`/api/catalog/promotions/${promotionId}/rules`, { params: { username: selectedOrg } });
      setRules(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = (promotionId, rule) => {
    setConfirmDialog({
      open: true, title: 'Delete Rule', message: `Delete rule "${rule.Name}"?`, severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/promotions/${promotionId}/rules/${rule.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Rule deleted');
          setRules(prev => prev.filter(r => r.Id !== rule.Id));
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  const csvExport = () => {
    const rows = promotions.map(p => [
      p.Name, p.vlocity_cmt__Code__c, p.vlocity_cmt__DiscountType__c,
      p.vlocity_cmt__DiscountValue__c, p.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive',
    ]);
    const csv = ['Name,Code,Discount Type,Discount Value,Status',
      ...rows.map(r => r.map(v => `"${v ?? ''}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `promotions_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <Box>
      {/* Toolbar */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <TextField size="small" placeholder="Search promotions…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }} sx={{ minWidth: 220 }} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchPromotions} disabled={loading || !selectedOrg} size="small">
              {loading ? <CircularProgress size={18} /> : <Refresh />}
            </IconButton>
          </span>
        </Tooltip>
        <Button size="small" variant="outlined" startIcon={<FileDownload />} onClick={csvExport} disabled={!promotions.length}>
          Export CSV
        </Button>
        <Button size="small" variant="contained" startIcon={<Add />} onClick={openPromoCreate} disabled={!selectedOrg}>
          Add Promotion
        </Button>
      </Stack>

      {!selectedOrg && <Alert severity="info">Select an org to view promotions.</Alert>}

      {selectedOrg && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                {[
                  { f: 'Name', l: 'Name' },
                  { f: 'vlocity_cmt__Code__c', l: 'Code' },
                  { f: 'vlocity_cmt__DiscountType__c', l: 'Discount Type' },
                  { f: 'vlocity_cmt__DiscountValue__c', l: 'Discount Value' },
                  { f: 'vlocity_cmt__EffectiveFromDate__c', l: 'Start Date' },
                  { f: 'vlocity_cmt__EffectiveUntilDate__c', l: 'End Date' },
                  { f: 'vlocity_cmt__IsActive__c', l: 'Status' },
                ].map(({ f, l }) => (
                  <TableCell key={f} sx={{ fontWeight: 600 }}>
                    <TableSortLabel active={orderBy === f} direction={orderBy === f ? order : 'asc'} onClick={() => handleSort(f)}>{l}</TableSortLabel>
                  </TableCell>
                ))}
                <TableCell sx={{ fontWeight: 600, width: 120 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              )}
              {!loading && sorted.length === 0 && (
                <TableRow><TableCell colSpan={8}><Alert severity="info" sx={{ m: 1 }}>No promotions found.</Alert></TableCell></TableRow>
              )}
              {!loading && sorted.map(p => (
                <TableRow key={p.Id} hover>
                  <TableCell sx={{ fontWeight: 500 }}>{p.Name}</TableCell>
                  <TableCell>{p.vlocity_cmt__Code__c}</TableCell>
                  <TableCell>{p.vlocity_cmt__DiscountType__c}</TableCell>
                  <TableCell>{p.vlocity_cmt__DiscountValue__c}</TableCell>
                  <TableCell>{p.vlocity_cmt__EffectiveFromDate__c ? new Date(p.vlocity_cmt__EffectiveFromDate__c).toLocaleDateString() : '—'}</TableCell>
                  <TableCell>{p.vlocity_cmt__EffectiveUntilDate__c ? new Date(p.vlocity_cmt__EffectiveUntilDate__c).toLocaleDateString() : '—'}</TableCell>
                  <TableCell>
                    <Chip label={p.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                      color={p.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => openPromoEdit(p)}><Edit fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="View Rules"><IconButton size="small" color="primary" onClick={() => openRulesDrawer(p)}><Rule fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deletePromo(p)}><Delete fontSize="small" /></IconButton></Tooltip>
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

      {/* Rules Drawer */}
      <Drawer anchor="right" open={rulesDrawer.open} onClose={closeRulesDrawer}
        PaperProps={{ sx: { width: 480, p: 2 } }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Rules — {rulesDrawer.promotion?.Name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {rulesDrawer.promotion?.vlocity_cmt__Code__c}
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Button size="small" variant="outlined" startIcon={<Add />} sx={{ mb: 2 }}
          onClick={() => openRuleCreate(rulesDrawer.promotion?.Id)} disabled={!selectedOrg}>
          Add Rule
        </Button>
        {rulesLoading && <CircularProgress size={24} />}
        {!rulesLoading && rules.length === 0 && <Alert severity="info">No rules defined for this promotion.</Alert>}
        {!rulesLoading && rules.map(rule => (
          <Paper key={rule.Id} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
            <Stack direction="row" alignItems="flex-start" spacing={1}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2">{rule.Name}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap">
                  <Chip label={`IF ${rule.ConditionType__c} ${rule.ConditionValue__c}`} size="small" color="info" variant="outlined" />
                  <Chip label={`THEN ${rule.ActionType__c} ${rule.ActionValue__c}`} size="small" color="success" variant="outlined" />
                  <Chip label={`Priority ${rule.Priority__c}`} size="small" variant="outlined" />
                  <Chip label={rule.IsActive__c ? 'Active' : 'Inactive'} size="small"
                    color={rule.IsActive__c ? 'success' : 'default'} variant="outlined" />
                </Stack>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Edit"><IconButton size="small" onClick={() => openRuleEdit(rulesDrawer.promotion?.Id, rule)}><Edit fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteRule(rulesDrawer.promotion?.Id, rule)}><Delete fontSize="small" /></IconButton></Tooltip>
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Drawer>

      {/* Promotion Form Dialog */}
      {promoDialog.open && (
        <Dialog open onClose={() => setPromoDialog({ open: false, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{promoDialog.data?.Id ? 'Edit Promotion' : 'New Promotion'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {[
                { field: 'Name', label: 'Name', required: true },
                { field: 'vlocity_cmt__Code__c', label: 'Code', required: true },
                { field: 'vlocity_cmt__Description__c', label: 'Description' },
                { field: 'vlocity_cmt__DiscountValue__c', label: 'Discount Value', type: 'number' },
              ].map(({ field, label, required, type }) => (
                <TextField key={field} size="small" label={label} required={required} type={type || 'text'} fullWidth
                  value={promoDialog.data?.[field] ?? ''}
                  onChange={e => setPromoDialog(prev => ({ ...prev, data: { ...prev.data, [field]: e.target.value } }))} />
              ))}
              <FormControl size="small" fullWidth>
                <InputLabel>Discount Type</InputLabel>
                <Select value={promoDialog.data?.vlocity_cmt__DiscountType__c ?? 'Percentage'} label="Discount Type"
                  onChange={e => setPromoDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__DiscountType__c: e.target.value } }))}>
                  {DISCOUNT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={promoDialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setPromoDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPromoDialog({ open: false, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={savePromo} disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : null}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Rule Form Dialog */}
      {ruleDialog.open && (
        <Dialog open onClose={() => setRuleDialog({ open: false, promotionId: null, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{ruleDialog.data?.Id ? 'Edit Rule' : 'New Rule'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField size="small" label="Rule Name" required fullWidth
                value={ruleDialog.data?.Name ?? ''}
                onChange={e => setRuleDialog(prev => ({ ...prev, data: { ...prev.data, Name: e.target.value } }))} />
              <FormControl size="small" fullWidth>
                <InputLabel>Condition Type</InputLabel>
                <Select value={ruleDialog.data?.ConditionType__c ?? 'Quantity'} label="Condition Type"
                  onChange={e => setRuleDialog(prev => ({ ...prev, data: { ...prev.data, ConditionType__c: e.target.value } }))}>
                  {CONDITION_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" label="Condition Value" fullWidth
                value={ruleDialog.data?.ConditionValue__c ?? ''}
                onChange={e => setRuleDialog(prev => ({ ...prev, data: { ...prev.data, ConditionValue__c: e.target.value } }))} />
              <FormControl size="small" fullWidth>
                <InputLabel>Action Type</InputLabel>
                <Select value={ruleDialog.data?.ActionType__c ?? 'Discount'} label="Action Type"
                  onChange={e => setRuleDialog(prev => ({ ...prev, data: { ...prev.data, ActionType__c: e.target.value } }))}>
                  {ACTION_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" label="Action Value" fullWidth
                value={ruleDialog.data?.ActionValue__c ?? ''}
                onChange={e => setRuleDialog(prev => ({ ...prev, data: { ...prev.data, ActionValue__c: e.target.value } }))} />
              <TextField size="small" label="Priority" type="number" fullWidth
                value={ruleDialog.data?.Priority__c ?? 10}
                onChange={e => setRuleDialog(prev => ({ ...prev, data: { ...prev.data, Priority__c: e.target.value } }))} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRuleDialog({ open: false, promotionId: null, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={saveRule} disabled={saving}
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

export default PromotionsTab;
