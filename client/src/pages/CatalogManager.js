import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Card, CardContent, Tab, Tabs, Alert, Snackbar, Chip,
  FormControl, InputLabel, Select, MenuItem, Stack, Divider,
  Switch, FormControlLabel, IconButton, Tooltip, Button, CircularProgress,
} from '@mui/material';
import { Refresh, CameraAlt } from '@mui/icons-material';
import axios from 'axios';
import CatalogObjectGrid   from '../components/catalog/CatalogObjectGrid';
import PriceListsTab       from '../components/catalog/PriceListsTab';
import PromotionsTab       from '../components/catalog/PromotionsTab';
import AttributesTab       from '../components/catalog/AttributesTab';
import PicklistsTab        from '../components/catalog/PicklistsTab';
import PricingVariablesTab from '../components/catalog/PricingVariablesTab';
import CatalogsTab             from '../components/catalog/CatalogsTab';
import ProductRelationshipsTab from '../components/catalog/ProductRelationshipsTab';
import BatchJobsPanel      from '../components/catalog/BatchJobsPanel';
import SnapshotsPanel      from '../components/catalog/SnapshotsPanel';

// ── Tab configuration ─────────────────────────────────────────────────────────
const TABS = [
  { label: 'Products',          id: 'products'          },
  { label: 'Price Lists',       id: 'price-lists'       },
  { label: 'Promotions',        id: 'promotions'        },
  { label: 'Attributes',        id: 'attributes'        },
  { label: 'Picklists',         id: 'picklists'         },
  { label: 'Pricing Variables', id: 'pricing-variables' },
  { label: 'Catalogs',               id: 'catalogs'               },
  { label: 'Product Relationships',  id: 'product-relationships'  },
  { label: 'Rate Codes',             id: 'rate-codes'             },
  { label: 'Rate Tables',       id: 'rate-tables'       },
  { label: 'Batch Jobs',        id: 'batch-jobs'        },
  { label: 'Snapshots',         id: 'snapshots'         },
];

// ── Column & form definitions for CatalogObjectGrid tabs ─────────────────────

const PRODUCT_COLUMNS = [
  { field: 'Name',        label: 'Name' },
  { field: 'ProductCode', label: 'Code' },
  { field: 'Family',      label: 'Family' },
  { field: 'IsActive',    label: 'Active' },
  { field: 'Description', label: 'Description' },
];
const PRODUCT_FIELDS = [
  { field: 'Name',        label: 'Product Name', required: true },
  { field: 'ProductCode', label: 'Product Code' },
  { field: 'Family',      label: 'Family' },
  { field: 'IsActive',    label: 'Active', type: 'select',
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { field: 'Description', label: 'Description' },
];

const RATE_CODE_COLUMNS = [
  { field: 'Name',               label: 'Name' },
  { field: 'GT_VATCode__c',      label: 'VAT Code' },
  { field: 'GT_VATRate__c',      label: 'VAT Rate' },
  { field: 'GT_OrgCode__c',      label: 'Org Code' },
  { field: 'GT_StartDate__c',    label: 'Start Date' },
  { field: 'GT_EndDate__c',      label: 'End Date' },
  { field: 'CurrencyIsoCode',    label: 'Currency' },
];
const RATE_CODE_FIELDS = [
  { field: 'Name',                 label: 'Name',        required: true },
  { field: 'GT_VATCode__c',        label: 'VAT Code' },
  { field: 'GT_VATDescription__c', label: 'VAT Description' },
  { field: 'GT_VATRate__c',        label: 'VAT Rate' },
  { field: 'GT_OrgCode__c',        label: 'Org Code' },
  { field: 'GT_StartDate__c',      label: 'Start Date',  type: 'date' },
  { field: 'GT_EndDate__c',        label: 'End Date',    type: 'date' },
  { field: 'CurrencyIsoCode',      label: 'Currency' },
];

const RATE_TABLE_COLUMNS = [
  { field: 'Name',                 label: 'Name' },
  { field: 'GT_OrgCode__c',        label: 'Org Code' },
  { field: 'GT_ProductName_Text__c', label: 'Product' },
  { field: 'GT_RateCode__c',       label: 'Rate Code' },
  { field: 'GT_VATType__c',        label: 'VAT Type' },
  { field: 'GT_StartDate__c',      label: 'Start Date' },
  { field: 'GT_EndDate__c',        label: 'End Date' },
  { field: 'CurrencyIsoCode',      label: 'Currency' },
];
const RATE_TABLE_FIELDS = [
  { field: 'Name',                  label: 'Name',         required: true },
  { field: 'GT_OrgCode__c',         label: 'Org Code' },
  { field: 'GT_ProductName_Text__c', label: 'Product Name' },
  { field: 'Product__c',            label: 'Product ID (SF)' },
  { field: 'GT_RateCode__c',        label: 'Rate Code (SF ID)' },
  { field: 'GT_RateDescription__c', label: 'Rate Description' },
  { field: 'GT_VATType__c',         label: 'VAT Type' },
  { field: 'GT_UniqueKey__c',       label: 'Unique Key' },
  { field: 'GT_StartDate__c',       label: 'Start Date',   type: 'date' },
  { field: 'GT_EndDate__c',         label: 'End Date',     type: 'date' },
  { field: 'CurrencyIsoCode',       label: 'Currency' },
];

// ── Component ─────────────────────────────────────────────────────────────────
const SESSION_KEY = 'catalogManager.state';

function restoreState() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

const CatalogManager = () => {
  const saved = restoreState();
  const [orgs, setOrgs]                 = useState([]);
  const [selectedOrg, setSelectedOrg]   = useState(saved.selectedOrg || '');
  const [countryFilter, setCountryFilter] = useState(saved.countryFilter || '');
  const [activeFilter, setActiveFilter] = useState(saved.activeFilter || false);
  const [currentTab, setCurrentTab]     = useState(saved.currentTab || 0);
  const [stats, setStats]               = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [snackbar, setSnackbar]         = useState({ open: false, message: '', severity: 'success' });
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [instanceUrl, setInstanceUrl]   = useState(null);
  const [technicalMode, setTechnicalMode] = useState(false);
  const snapshotsPanelRef = useRef(null);

  // ── Persist state to sessionStorage whenever it changes ─────────────────
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ selectedOrg, countryFilter, activeFilter, currentTab }));
  }, [selectedOrg, countryFilter, activeFilter, currentTab]);

  // ── Load orgs on mount ───────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/orgs/list')
      .then(res => setOrgs(res.data.orgs || res.data || []))
      .catch(() => {});
  }, []);

  // ── Load stats when org changes ──────────────────────────────────────────
  const loadStats = useCallback(async () => {
    if (!selectedOrg) { setStats(null); return; }
    setStatsLoading(true);
    try {
      const res = await axios.get('/api/catalog/stats', { params: { username: selectedOrg } });
      setStats(res.data.data || res.data);
    } catch {
      // stats are nice-to-have; don't block the UI
    } finally {
      setStatsLoading(false);
    }
  }, [selectedOrg]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Load instance URL when org changes ──────────────────────────────────
  useEffect(() => {
    if (!selectedOrg) { setInstanceUrl(null); return; }
    axios.get('/api/catalog/instance-url', { params: { username: selectedOrg } })
      .then(res => setInstanceUrl(res.data.instanceUrl || null))
      .catch(() => setInstanceUrl(null));
  }, [selectedOrg]);

  // ── Shared error / success handlers ────────────────────────────────────
  const handleError   = useCallback((msg) => setSnackbar({ open: true, message: msg,  severity: 'error'   }), []);
  const handleSuccess = useCallback((msg) => setSnackbar({ open: true, message: msg,  severity: 'success' }), []);

  // ── Quick "Create Snapshot" from the header ───────────────────────────
  const handleQuickSnapshot = async () => {
    if (!selectedOrg) return;
    setCreatingSnapshot(true);
    try {
      await axios.post('/api/catalog/snapshots', {
        username: selectedOrg,
        label: `Manual snapshot — ${new Date().toLocaleString()}`,
      });
      handleSuccess('Snapshot created');
      // If Snapshots tab is visible, let it refresh itself on mount
    } catch (err) {
      handleError(err.response?.data?.message || err.message);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  // ── Shared filters object passed to CatalogObjectGrid tabs ───────────
  const sharedFilters = {
    ...(countryFilter ? { country: countryFilter } : {}),
    ...(activeFilter  ? { isActive: 'true' }       : {}),
  };

  // ── Stats chips ──────────────────────────────────────────────────────
  const statChips = stats
    ? [
        { label: 'Products',    value: stats.products,    color: 'default'   },
        { label: 'Price Lists', value: stats.priceLists,  color: 'primary'   },
        { label: 'Promotions',  value: stats.promotions,  color: 'secondary' },
        { label: 'Rate Codes',  value: stats.rateCodes,   color: 'info'      },
        { label: 'Rate Tables', value: stats.rateTables,  color: 'warning'   },
      ]
    : [];

  return (
    <Box>
      {/* ── Page header ───────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Catalog Manager</Typography>
      </Box>

      {/* ── Control bar ───────────────────────────────────────────────── */}
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ md: 'center' }}
          flexWrap="wrap"
        >
          {/* Org selector */}
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel>Salesforce Org</InputLabel>
            <Select
              value={selectedOrg}
              label="Salesforce Org"
              onChange={e => { setSelectedOrg(e.target.value); setStats(null); }}
            >
              <MenuItem value="">— Select org —</MenuItem>
              {orgs.map(o => (
                <MenuItem key={o.username} value={o.username}>
                  {o.alias ? `${o.alias} (${o.username})` : o.username}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Country filter */}
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Country</InputLabel>
            <Select
              value={countryFilter}
              label="Country"
              onChange={e => setCountryFilter(e.target.value)}
            >
              <MenuItem value="">All countries</MenuItem>
              {['AU', 'NZ', 'GB', 'US', 'SG', 'HK', 'IN', 'IE'].map(c => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Active-only toggle */}
          <FormControlLabel
            control={
              <Switch
                checked={activeFilter}
                onChange={e => setActiveFilter(e.target.checked)}
                size="small"
              />
            }
            label="Active only"
            sx={{ m: 0 }}
          />

          {/* Technical mode toggle */}
          <FormControlLabel
            control={
              <Switch
                checked={technicalMode}
                onChange={e => setTechnicalMode(e.target.checked)}
                size="small"
                color="warning"
              />
            }
            label="Technical mode"
            sx={{ m: 0 }}
          />

          <Box sx={{ flex: 1 }} />

          {/* Refresh stats */}
          <Tooltip title="Refresh statistics">
            <span>
              <IconButton onClick={loadStats} disabled={!selectedOrg || statsLoading} size="small">
                {statsLoading ? <CircularProgress size={18} /> : <Refresh />}
              </IconButton>
            </span>
          </Tooltip>

          {/* Quick snapshot */}
          <Button
            size="small"
            variant="outlined"
            startIcon={creatingSnapshot ? <CircularProgress size={14} color="inherit" /> : <CameraAlt />}
            onClick={handleQuickSnapshot}
            disabled={!selectedOrg || creatingSnapshot}
          >
            {creatingSnapshot ? 'Saving…' : 'Snapshot'}
          </Button>
        </Stack>

        {/* Stats bar */}
        {selectedOrg && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {statsLoading && <CircularProgress size={16} />}
              {statChips.map(({ label, value, color }) => (
                <Chip
                  key={label}
                  label={`${value ?? '…'} ${label}`}
                  size="small"
                  color={color}
                  variant="outlined"
                />
              ))}
              {!statsLoading && !stats && (
                <Typography variant="caption" color="text.secondary">
                  Select an org to see statistics.
                </Typography>
              )}
            </Stack>
          </>
        )}
      </CardContent></Card>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <Card variant="outlined">
        <Tabs
          value={currentTab}
          onChange={(_, v) => setCurrentTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {TABS.map(t => (
            <Tab key={t.id} label={t.label} sx={{ textTransform: 'none', fontWeight: 500 }} />
          ))}
        </Tabs>

        <Box sx={{ p: 2 }}>
          {/* Tab 0 — Products */}
          {currentTab === 0 && (
            <CatalogObjectGrid
              title="Products"
              endpoint="/api/catalog/products"
              columns={PRODUCT_COLUMNS}
              formFields={PRODUCT_FIELDS}
              selectedOrg={selectedOrg}
              filters={sharedFilters}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 1 — Price Lists */}
          {currentTab === 1 && (
            <PriceListsTab
              selectedOrg={selectedOrg}
              activeFilter={activeFilter}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 2 — Promotions */}
          {currentTab === 2 && (
            <PromotionsTab
              selectedOrg={selectedOrg}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 3 — Attributes */}
          {currentTab === 3 && (
            <AttributesTab
              selectedOrg={selectedOrg}
              activeFilter={activeFilter}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 4 — Picklists */}
          {currentTab === 4 && (
            <PicklistsTab
              selectedOrg={selectedOrg}
              activeFilter={activeFilter}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 5 — Pricing Variables */}
          {currentTab === 5 && (
            <PricingVariablesTab
              selectedOrg={selectedOrg}
              activeFilter={activeFilter}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 6 — Catalogs */}
          {currentTab === 6 && (
            <CatalogsTab
              selectedOrg={selectedOrg}
              activeFilter={activeFilter}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 7 — Product Relationships */}
          {currentTab === 7 && (
            <ProductRelationshipsTab
              selectedOrg={selectedOrg}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 8 — Rate Codes */}
          {currentTab === 8 && (
            <CatalogObjectGrid
              title="Rate Codes"
              endpoint="/api/catalog/rate-codes"
              columns={RATE_CODE_COLUMNS}
              formFields={RATE_CODE_FIELDS}
              selectedOrg={selectedOrg}
              filters={sharedFilters}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 9 — Rate Tables */}
          {currentTab === 9 && (
            <CatalogObjectGrid
              title="Rate Tables"
              endpoint="/api/catalog/rate-tables"
              columns={RATE_TABLE_COLUMNS}
              formFields={RATE_TABLE_FIELDS}
              selectedOrg={selectedOrg}
              filters={sharedFilters}
              instanceUrl={instanceUrl}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 10 — Batch Jobs */}
          {currentTab === 10 && (
            <BatchJobsPanel
              selectedOrg={selectedOrg}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}

          {/* Tab 11 — Snapshots */}
          {currentTab === 11 && (
            <SnapshotsPanel
              ref={snapshotsPanelRef}
              selectedOrg={selectedOrg}
              orgs={orgs}
              onError={handleError}
              onSuccess={handleSuccess}
            />
          )}
        </Box>
      </Card>

      {/* ── Global Snackbar ───────────────────────────────────────────── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CatalogManager;
