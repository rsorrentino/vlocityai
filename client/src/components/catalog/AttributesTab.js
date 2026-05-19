import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Grid, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Paper, Button, IconButton, Tooltip, Chip,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, CircularProgress, Alert,
} from '@mui/material';
import { Add, Edit, Delete, Refresh, Category } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../ConfirmDialog';

const AttributesTab = ({ selectedOrg, activeFilter, instanceUrl, onError, onSuccess }) => {
  // ── Categories ───────────────────────────────────────────────────────────
  const [categories, setCategories]   = useState([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [catSearch, setCatSearch]     = useState('');
  const [selectedCat, setSelectedCat] = useState(null);
  const [catDialog, setCatDialog]     = useState({ open: false, data: null });

  // ── Attributes ───────────────────────────────────────────────────────────
  const [attributes, setAttributes]   = useState([]);
  const [attrsLoading, setAttrsLoading] = useState(false);
  const [attrSearch, setAttrSearch]   = useState('');
  const [attrDialog, setAttrDialog]   = useState({ open: false, data: null });

  const [saving, setSaving]           = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', onConfirm: null });

  // ── Fetch Categories ─────────────────────────────────────────────────────
  const fetchCategories = useCallback(async () => {
    if (!selectedOrg) return;
    setCatsLoading(true);
    try {
      const params = { username: selectedOrg, search: catSearch, limit: 200, ...(activeFilter ? { isActive: 'true' } : {}) };
      const res = await axios.get('/api/catalog/attribute-categories', { params });
      setCategories(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setCatsLoading(false);
    }
  }, [selectedOrg, catSearch, activeFilter, onError]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  // ── Fetch Attributes for selected category ───────────────────────────────
  const fetchAttributes = useCallback(async () => {
    if (!selectedOrg || !selectedCat) { setAttributes([]); return; }
    setAttrsLoading(true);
    try {
      const params = { username: selectedOrg, search: attrSearch, limit: 200, ...(activeFilter ? { isActive: 'true' } : {}) };
      const res = await axios.get(`/api/catalog/attribute-categories/${selectedCat.Id}/attributes`, { params });
      setAttributes(res.data.records || []);
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setAttrsLoading(false);
    }
  }, [selectedOrg, selectedCat, attrSearch, activeFilter, onError]);

  useEffect(() => { fetchAttributes(); }, [fetchAttributes]);

  // ── Category CRUD ────────────────────────────────────────────────────────
  const openCatCreate = () => setCatDialog({ open: true, data: { Name: '', vlocity_cmt__Code__c: '', vlocity_cmt__IsActive__c: true } });
  const openCatEdit   = (cat) => setCatDialog({ open: true, data: { ...cat } });

  const saveCat = async () => {
    const { data } = catDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/attribute-categories/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Category updated');
      } else {
        await axios.post('/api/catalog/attribute-categories', { username: selectedOrg, ...data });
        onSuccess?.('Category created');
      }
      setCatDialog({ open: false, data: null });
      fetchCategories();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteCat = (cat) => {
    setConfirmDialog({
      open: true, title: 'Delete Attribute Category',
      message: `Delete "${cat.Name}"? All associated attributes may also be removed.`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/attribute-categories/${cat.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Category deleted');
          if (selectedCat?.Id === cat.Id) setSelectedCat(null);
          fetchCategories();
        } catch (err) { onError?.(err.response?.data?.message || err.message); }
      },
    });
  };

  // ── Attribute CRUD ───────────────────────────────────────────────────────
  const openAttrCreate = () => setAttrDialog({ open: true, data: { Name: '', vlocity_cmt__Code__c: '', vlocity_cmt__IsActive__c: true } });
  const openAttrEdit   = (attr) => setAttrDialog({ open: true, data: { ...attr } });

  const saveAttr = async () => {
    const { data } = attrDialog;
    setSaving(true);
    try {
      if (data.Id) {
        await axios.patch(`/api/catalog/attribute-categories/${selectedCat.Id}/attributes/${data.Id}`, { username: selectedOrg, ...data });
        onSuccess?.('Attribute updated');
      } else {
        await axios.post(`/api/catalog/attribute-categories/${selectedCat.Id}/attributes`, { username: selectedOrg, ...data });
        onSuccess?.('Attribute created');
      }
      setAttrDialog({ open: false, data: null });
      fetchAttributes();
    } catch (err) {
      onError?.(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAttr = (attr) => {
    setConfirmDialog({
      open: true, title: 'Delete Attribute',
      message: `Delete "${attr.Name}"?`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/attribute-categories/${selectedCat.Id}/attributes/${attr.Id}`, { params: { username: selectedOrg } });
          onSuccess?.('Attribute deleted');
          fetchAttributes();
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

  if (!selectedOrg) return <Alert severity="info">Select an org to view attributes.</Alert>;

  return (
    <Box>
      <Grid container spacing={2}>
        {/* ── Left panel: Attribute Categories ── */}
        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ height: '100%' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Category fontSize="small" color="action" />
              <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Attribute Categories</Typography>
              <Tooltip title="Refresh">
                <span>
                  <IconButton size="small" onClick={fetchCategories} disabled={catsLoading}>
                    {catsLoading ? <CircularProgress size={14} /> : <Refresh fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Add Category">
                <IconButton size="small" color="primary" onClick={openCatCreate}>
                  <Add fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Box sx={{ p: 1 }}>
              <TextField size="small" placeholder="Search categories…" fullWidth value={catSearch}
                onChange={e => setCatSearch(e.target.value)} sx={{ mb: 1 }} />
            </Box>
            <Box sx={{ maxHeight: 480, overflowY: 'auto' }}>
              {categories.length === 0 && !catsLoading && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No categories found.</Typography>
              )}
              {categories.map(cat => (
                <Box
                  key={cat.Id}
                  onClick={() => setSelectedCat(cat)}
                  sx={{
                    px: 2, py: 1, cursor: 'pointer', borderBottom: 1, borderColor: 'divider',
                    backgroundColor: selectedCat?.Id === cat.Id ? 'primary.50' : 'transparent',
                    '&:hover': { backgroundColor: selectedCat?.Id === cat.Id ? 'primary.100' : 'grey.50' },
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={selectedCat?.Id === cat.Id ? 600 : 400} noWrap>
                        {cat.Name}
                      </Typography>
                      {cat.vlocity_cmt__Code__c && (
                        <Typography variant="caption" color="text.secondary">{cat.vlocity_cmt__Code__c}</Typography>
                      )}
                    </Box>
                    <Chip label={cat.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                      color={cat.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" sx={{ fontSize: '0.65rem' }} />
                    <Tooltip title="Edit"><IconButton size="small" onClick={e => { e.stopPropagation(); openCatEdit(cat); }}><Edit sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" color="error" onClick={e => { e.stopPropagation(); deleteCat(cat); }}><Delete sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                  </Stack>
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>

        {/* ── Right panel: Attributes ── */}
        <Grid item xs={12} md={8}>
          <Paper variant="outlined">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
                {selectedCat ? `Attributes — ${selectedCat.Name}` : 'Select a category'}
              </Typography>
              {selectedCat && (
                <>
                  <Tooltip title="Refresh">
                    <span>
                      <IconButton size="small" onClick={fetchAttributes} disabled={attrsLoading}>
                        {attrsLoading ? <CircularProgress size={14} /> : <Refresh fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Button size="small" variant="contained" startIcon={<Add />} onClick={openAttrCreate}>
                    Add Attribute
                  </Button>
                </>
              )}
            </Stack>

            {!selectedCat && (
              <Alert severity="info" sx={{ m: 2 }}>Select an attribute category from the left panel to view its attributes.</Alert>
            )}

            {selectedCat && (
              <>
                <Box sx={{ p: 1 }}>
                  <TextField size="small" placeholder="Search attributes…" value={attrSearch}
                    onChange={e => setAttrSearch(e.target.value)} sx={{ minWidth: 220 }} />
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: 'grey.100' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Data Type</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        {instanceUrl && <TableCell sx={{ fontWeight: 600, width: 50 }}>SF</TableCell>}
                        <TableCell sx={{ fontWeight: 600, width: 90 }}>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {attrsLoading && (
                        <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3 }}><CircularProgress size={24} /></TableCell></TableRow>
                      )}
                      {!attrsLoading && attributes.length === 0 && (
                        <TableRow><TableCell colSpan={6}>
                          <Alert severity="info" sx={{ m: 1 }}>No attributes found in this category.</Alert>
                        </TableCell></TableRow>
                      )}
                      {!attrsLoading && attributes.map(attr => (
                        <TableRow key={attr.Id} hover>
                          <TableCell sx={{ fontWeight: 500 }}>{attr.Name}</TableCell>
                          <TableCell>{attr.vlocity_cmt__Code__c}</TableCell>
                          <TableCell>{attr.vlocity_cmt__AttributeDataType__c}</TableCell>
                          <TableCell>
                            <Chip label={attr.vlocity_cmt__IsActive__c ? 'Active' : 'Inactive'} size="small"
                              color={attr.vlocity_cmt__IsActive__c ? 'success' : 'default'} variant="outlined" />
                          </TableCell>
                          {instanceUrl && <TableCell><SfLink id={attr.Id} /></TableCell>}
                          <TableCell>
                            <Stack direction="row" spacing={0.5}>
                              <Tooltip title="Edit"><IconButton size="small" onClick={() => openAttrEdit(attr)}><Edit fontSize="small" /></IconButton></Tooltip>
                              <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteAttr(attr)}><Delete fontSize="small" /></IconButton></Tooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Category Form Dialog */}
      {catDialog.open && (
        <Dialog open onClose={() => setCatDialog({ open: false, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{catDialog.data?.Id ? 'Edit Attribute Category' : 'New Attribute Category'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {[
                { field: 'Name',                          label: 'Name',         required: true },
                { field: 'vlocity_cmt__Code__c',          label: 'Code' },
                { field: 'vlocity_cmt__DisplaySequence__c', label: 'Display Sequence', type: 'number' },
              ].map(({ field, label, required, type }) => (
                <TextField key={field} size="small" label={label} required={required} fullWidth type={type || 'text'}
                  value={catDialog.data?.[field] ?? ''}
                  onChange={e => setCatDialog(prev => ({ ...prev, data: { ...prev.data, [field]: e.target.value } }))} />
              ))}
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={catDialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setCatDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCatDialog({ open: false, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={saveCat} disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : null}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Attribute Form Dialog */}
      {attrDialog.open && (
        <Dialog open onClose={() => setAttrDialog({ open: false, data: null })} maxWidth="sm" fullWidth>
          <DialogTitle>{attrDialog.data?.Id ? 'Edit Attribute' : 'New Attribute'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {[
                { field: 'Name',                          label: 'Name',         required: true },
                { field: 'vlocity_cmt__Code__c',          label: 'Code' },
                { field: 'vlocity_cmt__DisplaySequence__c', label: 'Display Sequence', type: 'number' },
              ].map(({ field, label, required, type }) => (
                <TextField key={field} size="small" label={label} required={required} fullWidth type={type || 'text'}
                  value={attrDialog.data?.[field] ?? ''}
                  onChange={e => setAttrDialog(prev => ({ ...prev, data: { ...prev.data, [field]: e.target.value } }))} />
              ))}
              <FormControl size="small" fullWidth>
                <InputLabel>Data Type</InputLabel>
                <Select value={attrDialog.data?.vlocity_cmt__AttributeDataType__c ?? ''} label="Data Type"
                  onChange={e => setAttrDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__AttributeDataType__c: e.target.value } }))}>
                  <MenuItem value="">— None —</MenuItem>
                  {['Text', 'Number', 'Boolean', 'Date', 'DateTime', 'Picklist', 'MultiPicklist'].map(t => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={attrDialog.data?.vlocity_cmt__IsActive__c ?? true} label="Status"
                  onChange={e => setAttrDialog(prev => ({ ...prev, data: { ...prev.data, vlocity_cmt__IsActive__c: e.target.value } }))}>
                  <MenuItem value={true}>Active</MenuItem>
                  <MenuItem value={false}>Inactive</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAttrDialog({ open: false, data: null })}>Cancel</Button>
            <Button variant="contained" onClick={saveAttr} disabled={saving}
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

export default AttributesTab;
