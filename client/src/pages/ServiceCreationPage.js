import React, { useState, useRef, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Alert,
  Button, Chip, Tab, Tabs,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, Stack, FormControl, InputLabel, Select, MenuItem,
  TextField, Paper, Tooltip, CircularProgress, Accordion, AccordionSummary,
  AccordionDetails, Collapse, IconButton, InputAdornment, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import {
  CloudUpload, Download, CompareArrows, ExpandMore, Refresh, Description,
  Search, Clear, KeyboardArrowDown, KeyboardArrowRight, PublishedWithChanges, PlayArrow,
} from '@mui/icons-material';
import axios from 'axios';

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatusChip({ status }) {
  const map = {
    match:           { color: 'success',  label: 'match' },
    mismatch:        { color: 'warning',  label: 'mismatch' },
    missing:         { color: 'error',    label: 'missing' },
    missing_product: { color: 'error',    label: 'missing product' },
    no_sku_record:   { color: 'default',  label: 'no SKU record' },
    extra:           { color: 'default',  label: 'extra in org' },
  };
  const cfg = map[status] || { color: 'default', label: status };
  return <Chip size="small" label={cfg.label} color={cfg.color} variant="outlined" />;
}

// ── Expandable diff row ────────────────────────────────────────────────────────
// cols: array of { value, mono? } for the fixed columns after SKU
// sourceLabel / orgLabel: labels for the diff detail table headers

function DiffRow({ row, cols, sourceLabel = 'File value', orgLabel = 'Org value', colSpan, selectable, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const diffs = row.diffs || [];
  const totalCols = (colSpan || (2 + cols.length + 2)) + (selectable ? 1 : 0);

  return (
    <>
      <TableRow
        sx={{
          cursor: diffs.length > 0 ? 'pointer' : 'default',
          bgcolor:
            (row.status === 'missing' || row.status === 'no_sku_record' || row.status === 'missing_product') ? 'error.50' :
            row.status === 'mismatch' ? 'warning.50' : undefined,
          '&:hover': { filter: 'brightness(0.97)' },
        }}
        onClick={() => diffs.length > 0 && setOpen(o => !o)}
      >
        {selectable && (
          <TableCell sx={{ width: 40, p: 0.5 }} onClick={e => e.stopPropagation()}>
            <Checkbox
              size="small"
              checked={!!selected}
              onChange={e => onSelect(row, e.target.checked)}
              disabled={row.status !== 'mismatch' || diffs.length === 0}
            />
          </TableCell>
        )}
        <TableCell sx={{ width: 32, p: 0.5 }}>
          {diffs.length > 0
            ? (open ? <KeyboardArrowDown fontSize="small" /> : <KeyboardArrowRight fontSize="small" />)
            : null}
        </TableCell>
        <TableCell><code style={{ fontSize: '0.8em' }}>{row.sku}</code></TableCell>
        {cols.map((col, i) => (
          <TableCell key={i}>
            {col.value != null && col.value !== ''
              ? col.mono ? <code style={{ fontSize: '0.75em' }}>{col.value}</code> : col.value
              : <Typography variant="body2" color="text.secondary">—</Typography>}
          </TableCell>
        ))}
        <TableCell><StatusChip status={row.status} /></TableCell>
        <TableCell>
          {diffs.length > 0
            ? <Chip size="small" label={`${diffs.length} field${diffs.length > 1 ? 's' : ''}`} variant="outlined" color="warning" />
            : row.statusDetail
              ? <Typography variant="caption" color="text.secondary">{row.statusDetail}</Typography>
              : row.status === 'extra'
                ? <Typography variant="caption" color="text.secondary">No active record in file</Typography>
                : null}
        </TableCell>
      </TableRow>

      {diffs.length > 0 && (
        <TableRow>
          <TableCell colSpan={totalCols} sx={{ p: 0, borderBottom: open ? undefined : 'none' }}>
            <Collapse in={open} unmountOnExit>
              <Box sx={{ p: 1.5, bgcolor: 'background.default' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, width: '30%' }}>Field</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'warning.dark' }}>{sourceLabel}</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'info.dark' }}>{orgLabel}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {diffs.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell><code style={{ fontSize: '0.8em' }}>{d.field}</code></TableCell>
                        <TableCell sx={{ color: 'warning.dark' }}>
                          {d.source !== '' && d.source != null ? String(d.source) : <em style={{ opacity: 0.5 }}>empty</em>}
                        </TableCell>
                        <TableCell sx={{ color: 'info.dark' }}>
                          {d.org !== '' && d.org != null ? String(d.org) : <em style={{ opacity: 0.5 }}>empty</em>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Price comparison tab ───────────────────────────────────────────────────────

function PriceComparisonTab({ orgs }) {
  const fileRef = useRef();
  const [step, setStep] = useState('upload');
  const [selectedFile, setSelectedFile] = useState(null);
  const [orgUsername, setOrgUsername] = useState('');
  const [preview, setPreview] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [fieldFilter, setFieldFilter] = useState('all');
  const rowsPerPage = 25;

  const handleUpload = async () => {
    if (!selectedFile || !orgUsername) return;
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('fileType', 'price');
    formData.append('orgUsername', orgUsername);
    try {
      const res = await axios.post('/api/service-creation/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data.data.preview);
      setJobId(res.data.data.jobId);
      setStep('preview');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/service-creation/run', { jobId, action: 'compare' });
      setCompareResult(res.data.data.result);
      setPage(0);
      setFilter('mismatch');
      setSearch('');
      setFieldFilter('all');
      setStep('compare');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setSelectedFile(null);
    setPreview(null);
    setJobId(null);
    setCompareResult(null);
    setError(null);
    setSearch('');
    setFieldFilter('all');
    setFilter('all');
  };

  const handleDownloadTemplate = async () => {
    const res = await axios.get('/api/service-creation/template?type=price', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a'); a.href = url;
    a.download = 'price-template.csv'; a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExport = async (format) => {
    const res = await axios.get(`/api/service-creation/compare/${jobId}/export?format=${format}`, {
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `price-comparison-${jobId}.${format}`; a.click();
    window.URL.revokeObjectURL(url);
  };

  const allRows = useMemo(() => compareResult
    ? [...(compareResult.rows || []), ...(compareResult.extras || []).map(e => ({ ...e, status: 'extra', diffs: [] }))]
    : [], [compareResult]);

  const diffFields = useMemo(() => {
    const fields = new Set();
    allRows.forEach(r => (r.diffs || []).forEach(d => fields.add(d.field)));
    return ['all', ...Array.from(fields).sort()];
  }, [allRows]);

  const filtered = useMemo(() => {
    let rows = allRows;
    if (filter !== 'all') rows = rows.filter(r => r.status === filter);
    if (fieldFilter !== 'all') rows = rows.filter(r => (r.diffs || []).some(d => d.field === fieldFilter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => r.sku?.toLowerCase().includes(q) || r.priceList?.toLowerCase().includes(q));
    }
    return rows;
  }, [allRows, filter, fieldFilter, search]);

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}

      {step === 'upload' && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Upload Price File</Typography>
                <Button size="small" startIcon={<Description />} onClick={handleDownloadTemplate}>
                  Download Template
                </Button>
              </Stack>
              <FormControl size="small" fullWidth>
                <InputLabel>Org</InputLabel>
                <Select value={orgUsername} onChange={e => setOrgUsername(e.target.value)} label="Org">
                  {orgs.map(o => (
                    <MenuItem key={o.username} value={o.username}>{o.alias || o.username}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Paper
                variant="outlined"
                sx={{ p: 3, textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed' }}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
                  onChange={e => setSelectedFile(e.target.files[0])} />
                <CloudUpload sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  {selectedFile ? selectedFile.name : 'Click to select a CSV file'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Columns: ItemNumberSKU, PriceList, PricingVariable, Amount, EffectiveStartDate
                </Typography>
              </Paper>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <CloudUpload />}
                onClick={handleUpload}
                disabled={!selectedFile || !orgUsername || loading}
              >
                Upload
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && preview && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">File Preview</Typography>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <Typography variant="h4">{preview.totalRows}</Typography>
                    <Typography variant="caption" color="text.secondary">Total rows</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={4}>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <Typography variant="h4" color="success.main">{preview.validRows}</Typography>
                    <Typography variant="caption" color="text.secondary">Valid</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={4}>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <Typography variant="h4" color="error.main">{preview.invalidRows}</Typography>
                    <Typography variant="caption" color="text.secondary">Invalid (skipped)</Typography>
                  </Paper>
                </Grid>
              </Grid>
              {preview.warnings?.length > 0 && (
                <Alert severity="warning">
                  {preview.warnings.map((w, i) => <div key={i}>Row {w.lineNum}: {w.message}</div>)}
                </Alert>
              )}
              {preview.sampleRows?.length > 0 && (
                <Accordion variant="outlined">
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="body2">Sample rows</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TableContainer sx={{ maxHeight: 200 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            {Object.keys(preview.sampleRows[0]).map(h => <TableCell key={h}>{h}</TableCell>)}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {preview.sampleRows.map((row, i) => (
                            <TableRow key={i}>
                              {Object.values(row).map((v, j) => <TableCell key={j}>{v}</TableCell>)}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </AccordionDetails>
                </Accordion>
              )}
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button variant="outlined" onClick={handleReset}>Back</Button>
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <CompareArrows />}
                  onClick={handleCompare}
                  disabled={loading || preview.validRows === 0}
                >
                  Compare against org
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {step === 'compare' && compareResult && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">
                  Comparison Results
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    {filtered.length} of {allRows.length} shown
                  </Typography>
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<Refresh />} onClick={handleReset}>New file</Button>
                  <Button size="small" startIcon={<Download />} onClick={() => handleExport('csv')}>CSV</Button>
                  <Button size="small" startIcon={<Download />} onClick={() => handleExport('json')}>JSON</Button>
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={`${compareResult.summary.match} match`} color="success"
                  variant={filter === 'match' ? 'filled' : 'outlined'}
                  onClick={() => { setFilter('match'); setPage(0); }} />
                <Chip size="small" label={`${compareResult.summary.mismatch} mismatch`} color="warning"
                  variant={filter === 'mismatch' ? 'filled' : 'outlined'}
                  onClick={() => { setFilter('mismatch'); setPage(0); }} />
                <Chip size="small" label={`${compareResult.summary.missing} missing`} color="error"
                  variant={filter === 'missing' ? 'filled' : 'outlined'}
                  onClick={() => { setFilter('missing'); setPage(0); }} />
                {compareResult.summary.extra > 0 && (
                  <Chip size="small" label={`${compareResult.summary.extra} extra in org`}
                    variant={filter === 'extra' ? 'filled' : 'outlined'}
                    onClick={() => { setFilter('extra'); setPage(0); }} />
                )}
              </Stack>

              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  placeholder="Search by SKU or price list…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => { setSearch(''); setPage(0); }}>
                          <Clear fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  }}
                />
                {diffFields.length > 2 && (
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Filter by field</InputLabel>
                    <Select value={fieldFilter} onChange={e => { setFieldFilter(e.target.value); setPage(0); }} label="Filter by field">
                      {diffFields.map(f => (
                        <MenuItem key={f} value={f}>{f === 'all' ? 'All fields' : f}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Stack>

              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 500 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 32 }} />
                      <TableCell>SKU</TableCell>
                      <TableCell>Price List</TableCell>
                      <TableCell>Pricing Variable</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Differences</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage).map((row, i) => (
                      <DiffRow
                        key={`${row.sku}-${row.priceList}-${i}`}
                        row={row}
                        cols={[
                          { value: row.priceList },
                          { value: row.pricingVariable },
                        ]}
                        sourceLabel="File value"
                        orgLabel="Org value"
                        colSpan={6}
                      />
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          No records match the current filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div" count={filtered.length} page={page}
                onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
                rowsPerPageOptions={[25]}
              />
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

// ── Gap fix panel ─────────────────────────────────────────────────────────────

function GapFixPanel({ orgUsername, rows, missingRelated }) {
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
  const [rtLoading, setRtLoading] = useState(false);
  const [rtResult, setRtResult] = useState(null);

  // Rows with no SKU record
  const noSkuRows = rows.filter(r => r.status === 'no_sku_record');

  // Rows with a product but no rate table
  const noRateTableRows = rows.filter(r =>
    r.productId && r.relatedChecks?.hasRateTable === false && r.salesVatCode
  );

  const handleRunBatch = async () => {
    setBatchLoading(true);
    setBatchResult(null);
    try {
      const res = await axios.post('/api/service-creation/run-batch', { username: orgUsername });
      setBatchResult({ success: true, message: res.data.data.message });
    } catch (err) {
      setBatchResult({ success: false, message: err.response?.data?.message || err.message });
    } finally {
      setBatchLoading(false);
    }
  };

  const handleCreateRateTables = async () => {
    setRtLoading(true);
    setRtResult(null);
    try {
      const items = noRateTableRows.map(r => ({
        productId: r.productId,
        productName: r.productName || r.productCode,
        orgCode: r.orgCode,
        salesVatCode: r.salesVatCode,
        sku: r.sku,
      }));
      const res = await axios.post('/api/service-creation/create-rate-tables', { username: orgUsername, items });
      setRtResult(res.data.data);
    } catch (err) {
      setRtResult({ error: err.response?.data?.message || err.message });
    } finally {
      setRtLoading(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ borderColor: 'warning.main' }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600} color="warning.dark" mb={1}>
          Related Record Gaps
        </Typography>
        <Stack spacing={2}>

          {/* Missing GT_ProductSKU__c */}
          {missingRelated.skuRecords > 0 && (
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {missingRelated.skuRecords} staging record{missingRelated.skuRecords !== 1 ? 's' : ''} missing GT_ProductSKU__c
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Service creation has not run (or failed) for these items. Running the batch will create the SKU bridge records, Product2, and related records.
                  </Typography>
                  {noSkuRows.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap mt={0.5}>
                      {noSkuRows.slice(0, 10).map(r => (
                        <Chip key={r.sku} size="small" label={r.sku} variant="outlined" />
                      ))}
                      {noSkuRows.length > 10 && (
                        <Chip size="small" label={`+${noSkuRows.length - 10} more`} variant="outlined" />
                      )}
                    </Stack>
                  )}
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  startIcon={batchLoading ? <CircularProgress size={14} color="inherit" /> : <PlayArrow />}
                  onClick={handleRunBatch}
                  disabled={batchLoading}
                  sx={{ flexShrink: 0, ml: 2 }}
                >
                  Run Service Creation Batch
                </Button>
              </Stack>
              {batchResult && (
                <Alert severity={batchResult.success ? 'success' : 'error'} sx={{ mt: 1 }}>
                  {batchResult.message}
                </Alert>
              )}
            </Box>
          )}

          {/* Missing GT_RateTable__c */}
          {missingRelated.rateTables > 0 && (
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {missingRelated.rateTables} product{missingRelated.rateTables !== 1 ? 's' : ''} missing GT_RateTable__c
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Products exist but have no VAT rate table. Rate tables will be created using the GT_SalesVatCode__c from the corresponding staging record.
                  </Typography>
                  {noRateTableRows.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap mt={0.5}>
                      {noRateTableRows.slice(0, 10).map(r => (
                        <Chip key={r.sku} size="small" label={`${r.sku} (VAT: ${r.salesVatCode})`} variant="outlined" />
                      ))}
                      {noRateTableRows.length > 10 && (
                        <Chip size="small" label={`+${noRateTableRows.length - 10} more`} variant="outlined" />
                      )}
                    </Stack>
                  )}
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  startIcon={rtLoading ? <CircularProgress size={14} color="inherit" /> : <PublishedWithChanges />}
                  onClick={handleCreateRateTables}
                  disabled={rtLoading || noRateTableRows.length === 0}
                  sx={{ flexShrink: 0, ml: 2 }}
                >
                  Create Rate Tables
                </Button>
              </Stack>
              {rtResult && (
                <Alert severity={rtResult.error ? 'error' : rtResult.errors > 0 ? 'warning' : 'success'} sx={{ mt: 1 }}>
                  {rtResult.error
                    ? rtResult.error
                    : `Created ${rtResult.created} rate table${rtResult.created !== 1 ? 's' : ''}${rtResult.errors > 0 ? `, ${rtResult.errors} errors: ${rtResult.errorDetails?.join('; ')}` : ''}${rtResult.skipped?.length > 0 ? `. ${rtResult.skipped.length} skipped (no matching GT_RateCode__c found).` : ''}`}
                </Alert>
              )}
            </Box>
          )}

        </Stack>
      </CardContent>
    </Card>
  );
}

// ── Staging comparison tab ─────────────────────────────────────────────────────

function StagingComparisonTab({ orgs }) {
  const [orgUsername, setOrgUsername] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [stagingStatus, setStagingStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fieldFilter, setFieldFilter] = useState('all');
  const [page, setPage] = useState(0);
  const rowsPerPage = 25;

  // Selection + apply state
  const [selected, setSelected] = useState(new Set()); // Set of productIds
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  const handleRun = async () => {
    if (!orgUsername) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSearch('');
    setStatusFilter('mismatch');
    setFieldFilter('all');
    setPage(0);
    setSelected(new Set());
    setApplyResult(null);
    try {
      const params = new URLSearchParams({ orgUsername });
      if (countryCode) params.set('countryCode', countryCode);
      if (stagingStatus) params.set('status', stagingStatus);
      const res = await axios.get(`/api/service-creation/staging-comparison?${params}`);
      setResult(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format) => {
    if (!orgUsername) return;
    const params = new URLSearchParams({ orgUsername, format });
    if (countryCode) params.set('countryCode', countryCode);
    if (stagingStatus) params.set('status', stagingStatus);
    const res = await axios.get(`/api/service-creation/staging-comparison?${params}`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `staging-comparison.${format}`; a.click();
    window.URL.revokeObjectURL(url);
  };

  const allRows = useMemo(() => result
    ? [...(result.rows || []), ...(result.extras || []).map(e => ({ ...e, status: 'extra', diffs: [], stagingStatus: null }))]
    : [], [result]);

  // Collect all unique diff field names for the field filter dropdown
  const diffFields = useMemo(() => {
    const fields = new Set();
    allRows.forEach(r => (r.diffs || []).forEach(d => fields.add(d.field)));
    return ['all', ...Array.from(fields).sort()];
  }, [allRows]);

  const filtered = useMemo(() => {
    let rows = allRows;
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    if (fieldFilter !== 'all') rows = rows.filter(r => (r.diffs || []).some(d => d.field === fieldFilter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.sku?.toLowerCase().includes(q) ||
        r.productCode?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [allRows, statusFilter, fieldFilter, search]);

  const summary = result?.summary || {};

  const handleSelectRow = (row, checked) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(row.productId);
      else next.delete(row.productId);
      return next;
    });
  };

  const handleSelectAllFiltered = (checked) => {
    if (checked) {
      const selectableIds = filtered.filter(r => r.status === 'mismatch' && r.diffs?.length > 0).map(r => r.productId);
      setSelected(prev => new Set([...prev, ...selectableIds]));
    } else {
      const filteredIds = new Set(filtered.map(r => r.productId));
      setSelected(prev => new Set([...prev].filter(id => !filteredIds.has(id))));
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setApplyConfirmOpen(false);
    try {
      const selectedRows = allRows.filter(r => selected.has(r.productId) && r.status === 'mismatch');
      const updates = selectedRows.map(r => ({
        productId: r.productId,
        sku: r.sku,
        data: Object.fromEntries(r.diffs.filter(d => d.productField).map(d => [d.productField, d.source])),
      }));
      const res = await axios.post('/api/service-creation/staging-apply', { username: orgUsername, updates });
      setApplyResult(res.data.data);
      setSelected(new Set());
    } catch (err) {
      setApplyResult({ error: err.response?.data?.message || err.message });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Stack spacing={3}>
      {/* Query form */}
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Staging vs Products Comparison</Typography>
            <Typography variant="body2" color="text.secondary">
              Compares <code>GT_StagingArea__c</code> records against <code>Product2</code> via the{' '}
              <code>GT_ProductSKU__c</code> bridge table.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap">
              <FormControl size="small" sx={{ minWidth: 200, flex: '2 1 180px' }}>
                <InputLabel>Org</InputLabel>
                <Select value={orgUsername} onChange={e => setOrgUsername(e.target.value)} label="Org">
                  {orgs.map(o => (
                    <MenuItem key={o.username} value={o.username}>{o.alias || o.username}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small" label="Country Code" sx={{ flex: '1 1 110px' }}
                value={countryCode} onChange={e => setCountryCode(e.target.value)}
                placeholder="e.g. AU" helperText="GT_OrganizationCode__c"
              />
              <TextField
                size="small" label="Staging Status" sx={{ flex: '1 1 120px' }}
                value={stagingStatus} onChange={e => setStagingStatus(e.target.value)}
                placeholder="e.g. New" helperText="GT_RecordStatus__c"
              />
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <CompareArrows />}
                onClick={handleRun}
                disabled={!orgUsername || loading}
                sx={{ mt: 0.25, flexShrink: 0 }}
              >
                Run Comparison
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Confirm dialog */}
      <Dialog open={applyConfirmOpen} onClose={() => setApplyConfirmOpen(false)}>
        <DialogTitle>Apply staging values to Product2?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will PATCH <strong>{selected.size}</strong> Product2 record{selected.size !== 1 ? 's' : ''} in{' '}
            <strong>{orgUsername}</strong> with the values from the corresponding GT_StagingArea__c records.
            Only differing fields will be updated. This action cannot be automatically undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplyConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={handleApply}>Apply</Button>
        </DialogActions>
      </Dialog>

      {result && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>

              {/* Header */}
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">
                  Results
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    {filtered.length} of {allRows.length} shown
                  </Typography>
                </Typography>
                <Stack direction="row" spacing={1}>
                  {selected.size > 0 && (
                    <Button
                      variant="contained"
                      color="warning"
                      size="small"
                      startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <PublishedWithChanges />}
                      onClick={() => setApplyConfirmOpen(true)}
                      disabled={applying}
                    >
                      Apply {selected.size} to Product2
                    </Button>
                  )}
                  <Button size="small" startIcon={<Download />} onClick={() => handleExport('csv')}>CSV</Button>
                  <Button size="small" startIcon={<Download />} onClick={() => handleExport('json')}>JSON</Button>
                </Stack>
              </Stack>

              {applyResult && (
                applyResult.error
                  ? <Alert severity="error">{applyResult.error}</Alert>
                  : <Alert severity={applyResult.errors > 0 ? 'warning' : 'success'}>
                      Applied staging values to Product2: {applyResult.updated} updated
                      {applyResult.errors > 0 && `, ${applyResult.errors} errors: ${(applyResult.errorDetails || []).join('; ')}`}.
                      Re-run the comparison to verify.
                    </Alert>
              )}

              {/* Summary chips */}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={`${summary.totalStaging} total`} variant="outlined"
                  onClick={() => { setStatusFilter('all'); setPage(0); }} />
                <Chip size="small" label={`${summary.match} match`} color="success"
                  variant={statusFilter === 'match' ? 'filled' : 'outlined'}
                  onClick={() => { setStatusFilter('match'); setPage(0); }} />
                <Chip size="small" label={`${summary.mismatch} mismatch`} color="warning"
                  variant={statusFilter === 'mismatch' ? 'filled' : 'outlined'}
                  onClick={() => { setStatusFilter('mismatch'); setPage(0); }} />
                <Chip size="small" label={`${summary.missing} missing`} color="error"
                  variant={statusFilter === 'missing' ? 'filled' : 'outlined'}
                  onClick={() => { setStatusFilter('missing'); setPage(0); }} />
                {summary.extra > 0 && (
                  <Chip size="small" label={`${summary.extra} extra in org`}
                    variant={statusFilter === 'extra' ? 'filled' : 'outlined'}
                    onClick={() => { setStatusFilter('extra'); setPage(0); }} />
                )}
              </Stack>

              {/* Related record gaps */}
              {summary.missingRelated && (summary.missingRelated.skuRecords > 0 || summary.missingRelated.rateTables > 0) && (
                <GapFixPanel
                  orgUsername={orgUsername}
                  rows={allRows}
                  missingRelated={summary.missingRelated}
                />
              )}

              {/* Search + field filter */}
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  placeholder="Search by SKU or product code…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => { setSearch(''); setPage(0); }}>
                          <Clear fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  }}
                />
                {diffFields.length > 2 && (
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Filter by field</InputLabel>
                    <Select
                      value={fieldFilter}
                      onChange={e => { setFieldFilter(e.target.value); setPage(0); }}
                      label="Filter by field"
                    >
                      {diffFields.map(f => (
                        <MenuItem key={f} value={f}>{f === 'all' ? 'All fields' : f}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Stack>

              {/* Table */}
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 500 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 40, p: 0.5 }}>
                        {(() => {
                          const selectableOnPage = filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage)
                            .filter(r => r.status === 'mismatch' && r.diffs?.length > 0);
                          const allChecked = selectableOnPage.length > 0 && selectableOnPage.every(r => selected.has(r.productId));
                          const someChecked = selectableOnPage.some(r => selected.has(r.productId));
                          return (
                            <Checkbox
                              size="small"
                              checked={allChecked}
                              indeterminate={someChecked && !allChecked}
                              onChange={e => handleSelectAllFiltered(e.target.checked)}
                              disabled={selectableOnPage.length === 0}
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell sx={{ width: 32 }} />
                      <TableCell>Item Number (SKU)</TableCell>
                      <TableCell>Product Code</TableCell>
                      <TableCell>Product Name</TableCell>
                      <TableCell>
                        <Tooltip title="Product2 Id — confirms which record will be updated">
                          <span>Product2 Id</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>Staging Status</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Differences</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage).map((row, i) => (
                      <DiffRow
                        key={`${row.sku}-${i}`}
                        row={row}
                        cols={[
                          { value: row.productCode, mono: true },
                          { value: row.productName },
                          { value: row.productId, mono: true },
                          { value: row.stagingStatus },
                        ]}
                        sourceLabel="Staging value"
                        orgLabel="Product2 value"
                        colSpan={9}
                        selectable
                        selected={selected.has(row.productId)}
                        onSelect={handleSelectRow}
                      />
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          No records match the current filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <TablePagination
                component="div"
                count={filtered.length}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                rowsPerPageOptions={[25]}
              />
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ServiceCreationPage() {
  const [tab, setTab] = useState(0);
  const [orgs, setOrgs] = useState([]);

  React.useEffect(() => {
    axios.get('/api/orgs/list')
      .then(r => setOrgs(r.data?.data || r.data?.orgs || []))
      .catch(() => setOrgs([]));
  }, []);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Service Creation</Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Price File Comparison" />
        <Tab label="Staging vs Products" />
      </Tabs>

      {tab === 0 && <PriceComparisonTab orgs={orgs} />}
      {tab === 1 && <StagingComparisonTab orgs={orgs} />}
    </Box>
  );
}
