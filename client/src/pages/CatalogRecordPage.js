import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Stack, Grid, Button, IconButton,
  Chip, CircularProgress, Alert, Divider, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Tooltip,
} from '@mui/material';
import { ArrowBack, Edit, Delete, ContentCopy } from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog';

// ── Per-object-type configuration ────────────────────────────────────────────
const OBJECT_CONFIGS = {
  products: {
    title: 'Product',
    listTitle: 'Products',
    fields: [
      { field: 'Name',        label: 'Name',         required: true },
      { field: 'ProductCode', label: 'Product Code' },
      { field: 'Family',      label: 'Family' },
      { field: 'IsActive',    label: 'Active',        type: 'boolean' },
      { field: 'Description', label: 'Description' },
    ],
  },
  'price-lists': {
    title: 'Price List',
    listTitle: 'Price Lists',
    fields: [
      { field: 'Name',                             label: 'Name',           required: true },
      { field: 'vlocity_cmt__Code__c',             label: 'Code' },
      { field: 'vlocity_cmt__Description__c',      label: 'Description' },
      { field: 'vlocity_cmt__CurrencyCode__c',     label: 'Currency' },
      { field: 'vlocity_cmt__IsActive__c',         label: 'Active',         type: 'boolean' },
      { field: 'vlocity_cmt__EffectiveFromDate__c', label: 'Effective From', type: 'date' },
      { field: 'vlocity_cmt__EffectiveUntilDate__c', label: 'Effective Until', type: 'date' },
      { field: 'vlocity_cmt__GlobalKey__c',        label: 'Global Key',     readonly: true },
      { field: 'GT_PriceListType__c',              label: 'Type' },
      { field: 'GT_CountryCode__c',                label: 'Country' },
      { field: 'GT_IsPrimary__c',                  label: 'Primary',        type: 'boolean' },
      { field: 'GT_OrganizationCode__c',           label: 'Org Code' },
    ],
  },
  promotions: {
    title: 'Promotion',
    listTitle: 'Promotions',
    fields: [
      { field: 'Name',                        label: 'Name',       required: true },
      { field: 'vlocity_cmt__Code__c',        label: 'Code' },
      { field: 'vlocity_cmt__Description__c', label: 'Description' },
      { field: 'vlocity_cmt__IsActive__c',    label: 'Active',     type: 'boolean' },
      { field: 'vlocity_cmt__GlobalKey__c',   label: 'Global Key', readonly: true },
      { field: 'GT_Type__c',                  label: 'Type' },
      { field: 'Promotion_Trigger__c',        label: 'Trigger' },
    ],
  },
  'rate-codes': {
    title: 'Rate Code',
    listTitle: 'Rate Codes',
    fields: [
      { field: 'Name',               label: 'Name',            required: true },
      { field: 'GT_GlobalKey__c',    label: 'Global Key',      readonly: true },
      { field: 'GT_OrgCode__c',      label: 'Org Code' },
      { field: 'GT_VATCode__c',      label: 'VAT Code' },
      { field: 'GT_VATDescription__c', label: 'VAT Description' },
      { field: 'GT_VATRate__c',      label: 'VAT Rate' },
      { field: 'GT_StartDate__c',    label: 'Start Date',      type: 'date' },
      { field: 'GT_EndDate__c',      label: 'End Date',        type: 'date' },
      { field: 'CurrencyIsoCode',    label: 'Currency' },
    ],
  },
  'rate-tables': {
    title: 'Rate Table',
    listTitle: 'Rate Tables',
    fields: [
      { field: 'Name',                  label: 'Name',            required: true },
      { field: 'GT_GlobalKey__c',       label: 'Global Key',      readonly: true },
      { field: 'GT_OrgCode__c',         label: 'Org Code' },
      { field: 'GT_ProductName_Text__c', label: 'Product Name' },
      { field: 'GT_RateCode__c',        label: 'Rate Code (SF ID)' },
      { field: 'GT_RateDescription__c', label: 'Rate Description' },
      { field: 'GT_VATType__c',         label: 'VAT Type' },
      { field: 'GT_UniqueKey__c',       label: 'Unique Key' },
      { field: 'GT_StartDate__c',       label: 'Start Date',      type: 'date' },
      { field: 'GT_EndDate__c',         label: 'End Date',        type: 'date' },
      { field: 'CurrencyIsoCode',       label: 'Currency' },
    ],
  },
};

// ── Component ─────────────────────────────────────────────────────────────────
const CatalogRecordPage = () => {
  const { objectType, id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const username = searchParams.get('username') || '';

  const config = OBJECT_CONFIGS[objectType];

  const [record, setRecord]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [saving, setSaving]     = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false });
  const [copied, setCopied]     = useState(false);

  const fetchRecord = useCallback(async () => {
    if (!username || !id || !config) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/api/catalog/${objectType}/${id}`, { params: { username } });
      setRecord(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [username, id, objectType, config]);

  useEffect(() => { fetchRecord(); }, [fetchRecord]);

  if (!config) {
    return (
      <Box>
        <Alert severity="error">Unknown object type: {objectType}</Alert>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/catalog')} sx={{ mt: 2 }}>
          Back to Catalog Manager
        </Button>
      </Box>
    );
  }

  const handleEdit = () => {
    setFormData({ ...record });
    setEditOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.patch(`/api/catalog/${objectType}/${id}`, { username, ...formData });
      setEditOpen(false);
      fetchRecord();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    setConfirmDialog({
      open: true,
      title: `Delete ${config.title}`,
      message: `Delete "${record?.Name}"? This will permanently remove the record from Salesforce.`,
      severity: 'error',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await axios.delete(`/api/catalog/${objectType}/${id}`, { params: { username } });
          navigate('/catalog');
        } catch (err) {
          setError(err.response?.data?.message || err.message);
        }
      },
    });
  };

  const copyId = () => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const renderFieldValue = (field, value) => {
    if (value === null || value === undefined) {
      return <Typography color="text.secondary" variant="body2">—</Typography>;
    }
    if (field.type === 'boolean' || typeof value === 'boolean') {
      return <Chip label={value ? 'Yes' : 'No'} size="small" color={value ? 'success' : 'default'} variant="outlined" />;
    }
    if (field.type === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))) {
      return <Typography variant="body2">{new Date(value).toLocaleDateString()}</Typography>;
    }
    return <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{String(value)}</Typography>;
  };

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button
          startIcon={<ArrowBack />}
          size="small"
          onClick={() => navigate(-1)}
        >
          {config.listTitle}
        </Button>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1, ml: 1 }}>
          {record?.Name || config.title}
        </Typography>
        {record && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<Edit />} onClick={handleEdit}>
              Edit
            </Button>
            <Button variant="outlined" size="small" color="error" startIcon={<Delete />} onClick={handleDelete}>
              Delete
            </Button>
          </Stack>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      {loading && (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      )}

      {!loading && record && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Grid container spacing={2}>
            {config.fields.map(field => (
              <Grid item xs={12} sm={6} md={4} key={field.field}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                  {field.label}
                </Typography>
                <Box sx={{ mt: 0.25 }}>
                  {renderFieldValue(field, record[field.field])}
                </Box>
              </Grid>
            ))}
          </Grid>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="caption" color="text.secondary">Salesforce ID:</Typography>
            <Typography variant="caption" fontFamily="monospace" color="text.secondary">{id}</Typography>
            <Tooltip title={copied ? 'Copied!' : 'Copy ID'}>
              <IconButton size="small" onClick={copyId}>
                <ContentCopy sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Paper>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit {config.title}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {config.fields.filter(f => !f.readonly).map(field => (
              <TextField
                key={field.field}
                size="small"
                label={field.label}
                required={field.required}
                type={field.type === 'date' ? 'date' : 'text'}
                value={formData[field.field] ?? ''}
                onChange={e => setFormData(prev => ({ ...prev, [field.field]: e.target.value }))}
                fullWidth
                InputLabelProps={field.type === 'date' ? { shrink: true } : undefined}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
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

export default CatalogRecordPage;
