import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Alert,
  Button, Chip, FormControl, InputLabel, Select, MenuItem,
  Checkbox, FormControlLabel, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, Tooltip, Stack, Dialog, DialogTitle, DialogContent,
  DialogActions, IconButton, TableSortLabel, Tabs, Tab, TextField, InputAdornment,
} from '@mui/material';
import {
  Sync, CheckCircle, Warning,
  PlayArrow, Refresh, FilterList, ArrowForward, ArrowBack, SwapHoriz,
  Visibility, Search, CallMissed,
} from '@mui/icons-material';
import axios from 'axios';

function SummaryCard({ result, onMissingClick, onExtraClick }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {result.label}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {result.skipped ? (
            <Chip
              size="small"
              label="Not in org"
              color="default"
              variant="outlined"
              title={result.skipReason}
            />
          ) : (
            <>
          <Chip size="small" label={`Source: ${result.sourceCount}`} color="primary" variant="outlined" />
          <Chip size="small" label={`Target: ${result.targetCount}`} color="default" variant="outlined" />
          {result.missingCount > 0 && (
            <Chip
              size="small"
              icon={<Warning fontSize="small" />}
              label={`${result.missingCount} missing`}
              color="error"
              onClick={onMissingClick}
              sx={{ cursor: onMissingClick ? 'pointer' : 'default' }}
            />
          )}
          {result.missingCount === 0 && result.sourceCount > 0 && result.extraCount === 0 && (
            <Chip
              size="small"
              icon={<CheckCircle fontSize="small" />}
              label="In sync"
              color="success"
            />
          )}
          {result.sourceCount === 0 && result.targetCount === 0 && (
            <Chip
              size="small"
              label="Not configured"
              color="default"
              variant="outlined"
            />
          )}
          {result.sourceCount === 0 && result.targetCount > 0 && (
            <Chip
              size="small"
              icon={<Warning fontSize="small" />}
              label="Source empty"
              color="warning"
            />
          )}
          {result.extraCount > 0 && (
            <Chip
              size="small"
              label={`${result.extraCount} extra in target`}
              color="warning"
              variant="outlined"
              onClick={onExtraClick}
              sx={{ cursor: onExtraClick ? 'pointer' : 'default' }}
            />
          )}
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function EnvComparisonPage() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [objectTypeDefs, setObjectTypeDefs] = useState([]);
  const [sourceUsername, setSourceUsername] = useState('');
  const [targetUsername, setTargetUsername] = useState('');
  const [selectedObjectTypes, setSelectedObjectTypes] = useState([
    'Product2',
    'vlocity_cmt__PriceList__c',
    'vlocity_cmt__PriceListEntry__c',
    'vlocity_cmt__PricingElement__c',
    'vlocity_cmt__Promotion__c',
    'GT_RateCode__c',
    'GT_RateTable__c',
  ]);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const [comparing, setComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [compareError, setCompareError] = useState(null);

  // All missing / extra rows from all object types flattened
  const [allMissingRows, setAllMissingRows] = useState([]);
  const [allExtraRows, setAllExtraRows]     = useState([]);
  const [activeView, setActiveView]         = useState('missing'); // 'missing' | 'extra'
  const [typeFilter, setTypeFilter]         = useState('all');
  const [nameSearch, setNameSearch]         = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  // Sort
  const [sortField, setSortField] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);

  // Detail dialog
  const [detailRow, setDetailRow] = useState(null);

  // Selected rows (array of row IDs: `${objectType}::${globalKey}`)
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Sync direction per row: 'source_to_target' | 'target_to_source'
  const [rowDirections, setRowDirections] = useState({});
  const [bulkDirection, setBulkDirection] = useState('source_to_target');

  // Sync job state
  const [syncing, setSyncing] = useState(false);
  const [syncJobId, setSyncJobId] = useState(null);
  const [syncJobStatus, setSyncJobStatus] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const pollRef = useRef(null);

  // ─── Load orgs and object type definitions on mount ────────────────────────
  useEffect(() => {
    axios.get('/api/orgs/list').then(res => {
      const list = res.data?.data || res.data?.orgs || [];
      setOrgs(list);
    }).catch(() => {});

    axios.get('/api/env-comparison/object-types').then(res => {
      setObjectTypeDefs(res.data?.data || []);
    }).catch(() => {});
  }, []);

  // ─── Poll sync job status until terminal ───────────────────────────────────
  const pollJobStatus = useCallback((jobId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`/api/jobs/${jobId}`);
        const job = res.data?.data || res.data;
        setSyncJobStatus(job?.status);
        if (['completed', 'failed', 'error', 'aborted'].includes(job?.status)) {
          clearInterval(pollRef.current);
          setSyncing(false);
        }
      } catch {
        clearInterval(pollRef.current);
        setSyncing(false);
      }
    }, 3000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ─── Run comparison ────────────────────────────────────────────────────────
  const handleRunComparison = useCallback(async () => {
    if (!sourceUsername || !targetUsername) return;
    setComparing(true);
    setCompareError(null);
    setComparisonResult(null);
    setAllMissingRows([]);
    setAllExtraRows([]);
    setActiveView('missing');
    setTypeFilter('all');
    setNameSearch('');
    setSelectedIds(new Set());
    setSyncJobId(null);
    setSyncJobStatus(null);
    setSyncError(null);

    try {
      const params = {
        sourceUsername,
        targetUsername,
        objectTypes: selectedObjectTypes.join(','),
      };
      const res = await axios.get('/api/env-comparison/run', { params, timeout: 180000 });
      const data = res.data?.data;
      setComparisonResult(data);

      // Flatten missing and extra records into table rows
      const missingRows = [];
      const extraRows = [];
      for (const result of data.results) {
        for (const rec of result.missingInTarget) {
          missingRows.push({
            id: `${result.objectType}::${rec.globalKey}`,
            objectType: result.objectType,
            typeLabel: result.label,
            globalKey: rec.globalKey,
            name: rec.name || '—',
            sourceId: rec.sourceId,
          });
        }
        for (const rec of result.extraInTarget) {
          extraRows.push({
            id: `extra::${result.objectType}::${rec.globalKey}`,
            objectType: result.objectType,
            typeLabel: result.label,
            globalKey: rec.globalKey,
            name: rec.name || '—',
            targetId: rec.targetId,
          });
        }
      }
      setAllMissingRows(missingRows);
      setAllExtraRows(extraRows);
      setPage(0);
    } catch (err) {
      setCompareError(
        err.response?.data?.message || err.message || 'Comparison failed'
      );
    } finally {
      setComparing(false);
    }
  }, [sourceUsername, targetUsername, selectedObjectTypes]);

  // ─── Row filtering & sorting ───────────────────────────────────────────────
  const applyFilters = (rows) => rows.filter(r =>
    (typeFilter === 'all' || r.objectType === typeFilter) &&
    (!nameSearch || r.name.toLowerCase().includes(nameSearch.toLowerCase()))
  );

  const visibleRows = applyFilters(allMissingRows);
  const visibleExtraRows = applyFilters(allExtraRows);

  const handleSort = (field) => {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(true); }
  };

  const sortRows = (rows) => [...rows].sort((a, b) => {
    const av = (a[sortField] || '').toLowerCase();
    const bv = (b[sortField] || '').toLowerCase();
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const sortedRows      = sortRows(visibleRows);
  const sortedExtraRows = sortRows(visibleExtraRows);

  const activeSortedRows = activeView === 'missing' ? sortedRows : sortedExtraRows;
  const paginatedRows = activeSortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const toggleRow = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(visibleRows.map(r => r.id)));
  const deselectAll = () => setSelectedIds(new Set());

  // ─── Trigger sync ──────────────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    if (!selectedIds.size) return;

    setSyncing(true);
    setSyncError(null);
    setSyncJobId(null);
    setSyncJobStatus(null);

    // Build selected records with per-row direction (fallback to bulkDirection)
    const selectedRecords = allMissingRows
      .filter(r => selectedIds.has(r.id))
      .map(r => {
        const dir = rowDirections[r.id] || bulkDirection;
        return {
          objectType: r.objectType,
          globalKey: r.globalKey,
          name: r.name,
          direction: dir,
          sourceUsername: dir === 'source_to_target' ? sourceUsername : targetUsername,
          targetUsername: dir === 'source_to_target' ? targetUsername : sourceUsername,
        };
      });

    try {
      const res = await axios.post('/api/env-comparison/sync', {
        sourceUsername,
        targetUsername,
        selectedRecords,
      });
      const { jobId } = res.data?.data;
      setSyncJobId(jobId);
      setSyncJobStatus('running');
      pollJobStatus(jobId);
    } catch (err) {
      setSyncError(err.response?.data?.message || err.message || 'Sync failed to start');
      setSyncing(false);
    }
  }, [selectedIds, allMissingRows, sourceUsername, targetUsername, pollJobStatus, bulkDirection, rowDirections]);

  // ─── Direction helpers ─────────────────────────────────────────────────────
  const toggleRowDirection = (rowId, e) => {
    e.stopPropagation();
    setRowDirections(prev => ({
      ...prev,
      [rowId]: (prev[rowId] || bulkDirection) === 'source_to_target'
        ? 'target_to_source'
        : 'source_to_target',
    }));
  };

  const applyBulkDirectionToSelected = (dir) => {
    setBulkDirection(dir);
    const updates = {};
    selectedIds.forEach(id => { updates[id] = dir; });
    setRowDirections(prev => ({ ...prev, ...updates }));
  };

  // ─── Derived values ────────────────────────────────────────────────────────
  const totalMissing = comparisonResult?.results
    ? comparisonResult.results.reduce((acc, r) => acc + r.missingCount, 0)
    : 0;
  const totalExtra = comparisonResult?.results
    ? comparisonResult.results.reduce((acc, r) => acc + r.extraCount, 0)
    : 0;

  const sourceAlias = orgs.find(o => o.username === sourceUsername)?.alias
    || sourceUsername?.split('@')[0] || 'Source';
  const targetAlias = orgs.find(o => o.username === targetUsername)?.alias
    || targetUsername?.split('@')[0] || 'Target';

  const sameOrg = sourceUsername && targetUsername && sourceUsername === targetUsername;
  const canCompare = sourceUsername && targetUsername && !sameOrg && selectedObjectTypes.length > 0;

  const handleCardMissingClick = (objectType) => {
    setActiveView('missing');
    setTypeFilter(objectType);
    setNameSearch('');
    setPage(0);
  };

  const handleCardExtraClick = (objectType) => {
    setActiveView('extra');
    setTypeFilter(objectType);
    setNameSearch('');
    setPage(0);
  };

  const syncStatusColor = {
    running: 'primary',
    completed: 'success',
    failed: 'error',
    error: 'error',
    aborted: 'warning',
  }[syncJobStatus] || 'default';

  return (
    <Box>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Environment Comparison</Typography>
      </Box>

      {/* ── Configuration ──────────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Configuration
          </Typography>
          <Grid container spacing={2} alignItems="flex-start">
            {/* Source org */}
            <Grid item xs={12} sm={5}>
              <FormControl fullWidth size="small">
                <InputLabel>Source Org</InputLabel>
                <Select
                  value={sourceUsername}
                  label="Source Org"
                  onChange={e => setSourceUsername(e.target.value)}
                >
                  {orgs.map(org => (
                    <MenuItem key={org.username || org.sfdxUsername} value={org.username || org.sfdxUsername}>
                      {org.alias || org.username || org.sfdxUsername}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Target org */}
            <Grid item xs={12} sm={5}>
              <FormControl fullWidth size="small">
                <InputLabel>Target Org</InputLabel>
                <Select
                  value={targetUsername}
                  label="Target Org"
                  onChange={e => setTargetUsername(e.target.value)}
                >
                  {orgs.map(org => (
                    <MenuItem key={org.username || org.sfdxUsername} value={org.username || org.sfdxUsername}>
                      {org.alias || org.username || org.sfdxUsername}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Run button */}
            <Grid item xs={12} sm={2}>
              <Button
                fullWidth
                variant="contained"
                startIcon={comparing ? null : <PlayArrow />}
                onClick={handleRunComparison}
                disabled={!canCompare || comparing}
                sx={{ height: 40 }}
              >
                {comparing ? 'Comparing…' : 'Run'}
              </Button>
            </Grid>

            {/* Object types — grouped */}
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Object Types ({selectedObjectTypes.length} of {objectTypeDefs.length} selected)
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => setSelectedObjectTypes(objectTypeDefs.map(d => d.objectType))}>
                    Select All
                  </Button>
                  <Button size="small" onClick={() => setSelectedObjectTypes([])}>
                    Clear All
                  </Button>
                </Stack>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {Object.entries(
                  objectTypeDefs.reduce((acc, def) => {
                    (acc[def.group] = acc[def.group] || []).push(def);
                    return acc;
                  }, {})
                ).map(([groupName, defs]) => {
                  const groupTypes = defs.map(d => d.objectType);
                  const checkedCount = groupTypes.filter(t => selectedObjectTypes.includes(t)).length;
                  const allChecked = checkedCount === groupTypes.length;
                  const someChecked = checkedCount > 0 && !allChecked;
                  const isExpanded = expandedGroups.has(groupName);

                  const toggleGroup = () => {
                    if (allChecked) {
                      setSelectedObjectTypes(prev => prev.filter(t => !groupTypes.includes(t)));
                    } else {
                      setSelectedObjectTypes(prev => [...new Set([...prev, ...groupTypes])]);
                    }
                  };

                  const toggleExpand = () => {
                    setExpandedGroups(prev => {
                      const next = new Set(prev);
                      next.has(groupName) ? next.delete(groupName) : next.add(groupName);
                      return next;
                    });
                  };

                  return (
                    <Card key={groupName} variant="outlined" sx={{ overflow: 'hidden' }}>
                      {/* Group header row */}
                      <Box
                        sx={{
                          display: 'flex', alignItems: 'center', px: 1, py: 0.5,
                          bgcolor: 'grey.50', cursor: 'pointer',
                          '&:hover': { bgcolor: 'grey.100' },
                        }}
                        onClick={toggleExpand}
                      >
                        <Checkbox
                          size="small"
                          checked={allChecked}
                          indeterminate={someChecked}
                          onClick={e => { e.stopPropagation(); toggleGroup(); }}
                          sx={{ p: 0.5 }}
                        />
                        <Typography variant="body2" fontWeight={600} sx={{ flex: 1, ml: 0.5 }}>
                          {groupName}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${checkedCount} / ${defs.length}`}
                          color={allChecked ? 'primary' : someChecked ? 'default' : 'default'}
                          variant={allChecked ? 'filled' : 'outlined'}
                          sx={{ mr: 1, fontSize: '0.7rem' }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {isExpanded ? '▲' : '▼'}
                        </Typography>
                      </Box>

                      {/* Expanded object list */}
                      {isExpanded && (
                        <Box sx={{ px: 1, py: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                          {defs.map(def => (
                            <FormControlLabel
                              key={def.objectType}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={selectedObjectTypes.includes(def.objectType)}
                                  onChange={e => {
                                    setSelectedObjectTypes(prev =>
                                      e.target.checked
                                        ? [...prev, def.objectType]
                                        : prev.filter(t => t !== def.objectType)
                                    );
                                  }}
                                />
                              }
                              label={
                                <Typography variant="body2">
                                  {def.label}
                                  {def.syncBy === 'directApi' && (
                                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                      (API)
                                    </Typography>
                                  )}
                                </Typography>
                              }
                            />
                          ))}
                        </Box>
                      )}
                    </Card>
                  );
                })}
              </Box>
            </Grid>
          </Grid>

          {sameOrg && (
            <Alert severity="error" sx={{ mt: 1 }}>
              Source and target org must be different.
            </Alert>
          )}
          {compareError && (
            <Alert severity="error" sx={{ mt: 1 }}>{compareError}</Alert>
          )}
          {comparing && <LinearProgress sx={{ mt: 1.5 }} />}
        </CardContent>
      </Card>

      {/* ── Summary Cards ──────────────────────────────────────────────── */}
      {comparisonResult && (
        <>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            Comparison Results
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {new Date(comparisonResult.timestamp).toLocaleString()}
            </Typography>
          </Typography>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            {comparisonResult.results.map(r => (
              <Grid item xs={12} sm={6} md={3} key={r.objectType}>
                <SummaryCard
                  result={r}
                  onMissingClick={r.missingCount > 0 ? () => handleCardMissingClick(r.objectType) : undefined}
                  onExtraClick={r.extraCount > 0 ? () => handleCardExtraClick(r.objectType) : undefined}
                />
              </Grid>
            ))}
          </Grid>
        </>
      )}

      {/* ── Missing Records Table ──────────────────────────────────────── */}
      {comparisonResult && totalMissing === 0 && (
        <Alert severity="success" icon={<CheckCircle />}>
          All records are in sync between the two orgs. No action required.
        </Alert>
      )}

      {comparisonResult && (totalMissing > 0 || totalExtra > 0) && (
        <Card variant="outlined">
          <CardContent sx={{ pb: 1 }}>

            {/* ── View tabs ──────────────────────────────────────────────── */}
            <Tabs
              value={activeView}
              onChange={(_, v) => { setActiveView(v); setPage(0); }}
              sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}
            >
              <Tab
                value="missing"
                label={
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Warning fontSize="small" sx={{ color: 'error.main' }} />
                    <span>Missing in Target</span>
                    <Chip size="small" label={totalMissing} color="error" sx={{ height: 18, fontSize: '0.68rem' }} />
                  </Stack>
                }
              />
              <Tab
                value="extra"
                label={
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <CallMissed fontSize="small" sx={{ color: 'warning.main' }} />
                    <span>Extra in Target</span>
                    <Chip size="small" label={totalExtra} color="warning" sx={{ height: 18, fontSize: '0.68rem' }} />
                  </Stack>
                }
              />
            </Tabs>

            {/* Table header bar */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>

                {/* Name search */}
                <TextField
                  size="small"
                  placeholder="Search by name…"
                  value={nameSearch}
                  onChange={e => { setNameSearch(e.target.value); setPage(0); }}
                  sx={{ width: 200 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />

                {/* Type filter chips */}
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    icon={<FilterList fontSize="small" />}
                    label="All"
                    variant={typeFilter === 'all' ? 'filled' : 'outlined'}
                    onClick={() => { setTypeFilter('all'); setPage(0); }}
                    color={typeFilter === 'all' ? 'primary' : 'default'}
                  />
                  {comparisonResult.results
                    .filter(r => activeView === 'missing' ? r.missingCount > 0 : r.extraCount > 0)
                    .map(r => {
                      const count = activeView === 'missing' ? r.missingCount : r.extraCount;
                      return (
                        <Chip
                          key={r.objectType}
                          size="small"
                          label={`${r.label} (${count})`}
                          variant={typeFilter === r.objectType ? 'filled' : 'outlined'}
                          onClick={() => { setTypeFilter(r.objectType); setPage(0); }}
                          color={typeFilter === r.objectType ? (activeView === 'missing' ? 'error' : 'warning') : 'default'}
                        />
                      );
                    })}
                </Box>
              </Box>

              {/* Selection actions — only on Missing tab */}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                {activeView === 'missing' && (<>
                <Button size="small" variant="outlined" onClick={selectAll}>
                  Select All ({visibleRows.length})
                </Button>
                <Button size="small" variant="outlined" onClick={deselectAll} disabled={!selectedIds.size}>
                  Deselect All
                </Button>

                {/* Bulk direction controls */}
                {selectedIds.size > 0 && (
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Tooltip title="Sync selected: Source → Target">
                      <Button
                        size="small"
                        variant={bulkDirection === 'source_to_target' ? 'contained' : 'outlined'}
                        color="primary"
                        startIcon={<ArrowForward />}
                        onClick={() => applyBulkDirectionToSelected('source_to_target')}
                        sx={{ minWidth: 0, px: 1.5 }}
                      >
                        →
                      </Button>
                    </Tooltip>
                    <Tooltip title="Sync selected: Target → Source">
                      <Button
                        size="small"
                        variant={bulkDirection === 'target_to_source' ? 'contained' : 'outlined'}
                        color="secondary"
                        startIcon={<ArrowBack />}
                        onClick={() => applyBulkDirectionToSelected('target_to_source')}
                        sx={{ minWidth: 0, px: 1.5 }}
                      >
                        ←
                      </Button>
                    </Tooltip>
                  </Stack>
                )}

                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={syncing ? <Refresh /> : <Sync />}
                  onClick={handleSync}
                  disabled={!selectedIds.size || syncing}
                >
                  {syncing ? 'Syncing…' : `Sync Selected (${selectedIds.size})`}
                </Button>
                </>)}
              </Stack>
            </Box>

            {/* Sync job status banner */}
            {syncError && (
              <Alert severity="error" sx={{ mb: 1 }}>{syncError}</Alert>
            )}
            {syncJobId && (
              <Alert
                severity={syncJobStatus === 'completed' ? 'success' : syncJobStatus === 'running' ? 'info' : 'warning'}
                sx={{ mb: 1 }}
                action={
                  <Button size="small" onClick={() => navigate('/history')}>
                    View Job
                  </Button>
                }
              >
                Sync job <strong>{syncJobId}</strong>
                {' — '}
                <Chip size="small" label={syncJobStatus} color={syncStatusColor} sx={{ ml: 0.5 }} />
              </Alert>
            )}

            {/* Top pagination */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid', borderColor: 'divider' }}>
              <TablePagination
                component="div"
                count={activeSortedRows.length}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={e => { setRowsPerPage(+e.target.value); setPage(0); }}
                rowsPerPageOptions={[25, 50, 100, 250]}
              />
            </Box>

            {/* ── Missing in Target table ─────────────────────────────── */}
            {activeView === 'missing' && <TableContainer sx={{ mt: 0 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {/* Select All checkbox */}
                    <TableCell padding="checkbox">
                      <Tooltip title={selectedIds.size === visibleRows.length ? 'Deselect All' : 'Select All'}>
                        <Checkbox
                          size="small"
                          checked={visibleRows.length > 0 && selectedIds.size === visibleRows.length}
                          indeterminate={selectedIds.size > 0 && selectedIds.size < visibleRows.length}
                          onChange={e => e.target.checked ? selectAll() : deselectAll()}
                        />
                      </Tooltip>
                    </TableCell>
                    {/* Source org column — green */}
                    <TableCell
                      sx={{ bgcolor: 'success.main', color: 'success.contrastText', fontWeight: 600, minWidth: 200 }}
                    >
                      <Stack direction="column" spacing={0}>
                        <Typography variant="caption" sx={{ opacity: 0.85, lineHeight: 1 }}>SOURCE</Typography>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <CheckCircle fontSize="small" />
                          <TableSortLabel
                            active={sortField === 'name'}
                            direction={sortField === 'name' ? (sortAsc ? 'asc' : 'desc') : 'asc'}
                            onClick={() => handleSort('name')}
                            sx={{ color: 'inherit !important', '& .MuiTableSortLabel-icon': { color: 'inherit !important' } }}
                          >
                            <Tooltip title={sourceUsername}>
                              <Typography variant="body2" fontWeight={700} noWrap sx={{ maxWidth: 160 }}>
                                {sourceAlias}
                              </Typography>
                            </Tooltip>
                          </TableSortLabel>
                        </Stack>
                      </Stack>
                    </TableCell>
                    {/* Direction toggle column */}
                    <TableCell align="center" sx={{ width: 80, fontWeight: 600 }}>
                      <Tooltip title="Click → / ← to toggle sync direction per record">
                        <SwapHoriz fontSize="small" />
                      </Tooltip>
                    </TableCell>
                    {/* Target org column — red */}
                    <TableCell
                      sx={{ bgcolor: 'error.main', color: 'error.contrastText', fontWeight: 600, minWidth: 200 }}
                    >
                      <Stack direction="column" spacing={0}>
                        <Typography variant="caption" sx={{ opacity: 0.85, lineHeight: 1 }}>TARGET</Typography>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Warning fontSize="small" />
                          <Tooltip title={targetUsername}>
                            <Typography variant="body2" fontWeight={700} noWrap sx={{ maxWidth: 160 }}>
                              {targetAlias}
                            </Typography>
                          </Tooltip>
                        </Stack>
                      </Stack>
                    </TableCell>
                    {/* Type — sortable */}
                    <TableCell>
                      <TableSortLabel
                        active={sortField === 'typeLabel'}
                        direction={sortField === 'typeLabel' ? (sortAsc ? 'asc' : 'desc') : 'asc'}
                        onClick={() => handleSort('typeLabel')}
                      >
                        Type
                      </TableSortLabel>
                    </TableCell>
                    {/* Global Key — sortable */}
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      <TableSortLabel
                        active={sortField === 'globalKey'}
                        direction={sortField === 'globalKey' ? (sortAsc ? 'asc' : 'desc') : 'asc'}
                        onClick={() => handleSort('globalKey')}
                      >
                        Global Key
                      </TableSortLabel>
                    </TableCell>
                    {/* Detail action */}
                    <TableCell sx={{ width: 48 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRows.map(row => {
                    const dir = rowDirections[row.id] || bulkDirection;
                    const isSelected = selectedIds.has(row.id);
                    const isRTL = dir === 'target_to_source';
                    return (
                      <TableRow
                        key={row.id}
                        hover
                        selected={isSelected}
                        onClick={() => toggleRow(row.id)}
                        sx={{
                          cursor: 'pointer',
                          '&.Mui-selected': { bgcolor: 'action.selected' },
                        }}
                      >
                        {/* Checkbox */}
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            checked={isSelected}
                            onClick={e => e.stopPropagation()}
                            onChange={() => toggleRow(row.id)}
                          />
                        </TableCell>

                        {/* Source cell */}
                        <TableCell sx={{ bgcolor: isRTL ? 'transparent' : 'success.50', borderLeft: isRTL ? 'none' : '3px solid', borderColor: 'success.main' }}>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 200, fontWeight: isRTL ? 400 : 500 }}>
                            {isRTL ? (
                              <span style={{ color: '#999', fontStyle: 'italic', fontSize: '0.75rem' }}>— missing —</span>
                            ) : (
                              row.name
                            )}
                          </Typography>
                          {!isRTL && (
                            <Typography variant="caption" noWrap sx={{ maxWidth: 200, fontFamily: 'monospace', color: 'text.secondary', display: 'block' }}>
                              {row.sourceId}
                            </Typography>
                          )}
                        </TableCell>

                        {/* Direction toggle button */}
                        <TableCell align="center" sx={{ px: 0.5 }}>
                          <Tooltip title={isRTL ? 'Click to sync Target → Source' : 'Click to sync Source → Target'}>
                            <Button
                              size="small"
                              variant="outlined"
                              color={isRTL ? 'secondary' : 'primary'}
                              onClick={e => toggleRowDirection(row.id, e)}
                              sx={{
                                minWidth: 56,
                                px: 0.5,
                                fontWeight: 700,
                                fontSize: '1rem',
                              }}
                            >
                              {isRTL ? '←' : '→'}
                            </Button>
                          </Tooltip>
                        </TableCell>

                        {/* Target cell */}
                        <TableCell sx={{ bgcolor: isRTL ? 'success.50' : 'error.50', borderRight: isRTL ? '3px solid' : 'none', borderColor: 'success.main' }}>
                          {isRTL ? (
                            <Typography variant="body2" noWrap sx={{ maxWidth: 200, fontWeight: 500 }}>
                              {row.name}
                            </Typography>
                          ) : (
                            <Chip
                              size="small"
                              label="MISSING"
                              color="error"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.65rem' }}
                            />
                          )}
                        </TableCell>

                        {/* Type */}
                        <TableCell>
                          <Chip size="small" label={row.typeLabel} variant="outlined" />
                        </TableCell>

                        {/* Global Key */}
                        <TableCell>
                          <Tooltip title={row.globalKey}>
                            <Typography
                              variant="body2"
                              noWrap
                              sx={{ maxWidth: 200, fontFamily: 'monospace', fontSize: '0.72rem', color: 'text.secondary' }}
                            >
                              {row.globalKey}
                            </Typography>
                          </Tooltip>
                        </TableCell>

                        {/* Detail button */}
                        <TableCell padding="none" align="center">
                          <Tooltip title="View record details">
                            <IconButton
                              size="small"
                              onClick={e => { e.stopPropagation(); setDetailRow(row); }}
                            >
                              <Visibility fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {paginatedRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">No records match the current filter.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>}

            {/* ── Extra in Target table ────────────────────────────────── */}
            {activeView === 'extra' && (
              <TableContainer sx={{ mt: 0 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: 'warning.main', color: 'warning.contrastText', fontWeight: 600, minWidth: 220 }}>
                        <Stack direction="column" spacing={0}>
                          <Typography variant="caption" sx={{ opacity: 0.85, lineHeight: 1 }}>EXTRA IN TARGET</Typography>
                          <Stack direction="row" alignItems="center" spacing={0.5}>
                            <CallMissed fontSize="small" />
                            <TableSortLabel
                              active={sortField === 'name'}
                              direction={sortField === 'name' ? (sortAsc ? 'asc' : 'desc') : 'asc'}
                              onClick={() => handleSort('name')}
                              sx={{ color: 'inherit !important', '& .MuiTableSortLabel-icon': { color: 'inherit !important' } }}
                            >
                              <Tooltip title={targetUsername}>
                                <Typography variant="body2" fontWeight={700} noWrap sx={{ maxWidth: 160 }}>
                                  {targetAlias}
                                </Typography>
                              </Tooltip>
                            </TableSortLabel>
                          </Stack>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <TableSortLabel
                          active={sortField === 'typeLabel'}
                          direction={sortField === 'typeLabel' ? (sortAsc ? 'asc' : 'desc') : 'asc'}
                          onClick={() => handleSort('typeLabel')}
                        >
                          Type
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        <TableSortLabel
                          active={sortField === 'globalKey'}
                          direction={sortField === 'globalKey' ? (sortAsc ? 'asc' : 'desc') : 'asc'}
                          onClick={() => handleSort('globalKey')}
                        >
                          Global Key
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ width: 48 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedRows.map(row => (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ bgcolor: 'warning.50', borderLeft: '3px solid', borderColor: 'warning.main' }}>
                          <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth: 240 }}>
                            {row.name}
                          </Typography>
                          <Typography variant="caption" noWrap sx={{ maxWidth: 240, fontFamily: 'monospace', color: 'text.secondary', display: 'block' }}>
                            {row.targetId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={row.typeLabel} variant="outlined" />
                        </TableCell>
                        <TableCell>
                          <Tooltip title={row.globalKey}>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 200, fontFamily: 'monospace', fontSize: '0.72rem', color: 'text.secondary' }}>
                              {row.globalKey}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell padding="none" align="center">
                          <Tooltip title="View record details">
                            <IconButton size="small" onClick={() => setDetailRow(row)}>
                              <Visibility fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    {paginatedRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                          <Typography color="text.secondary">No records match the current filter.</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <TablePagination
              component="div"
              count={activeSortedRows.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={e => { setRowsPerPage(+e.target.value); setPage(0); }}
              rowsPerPageOptions={[25, 50, 100, 250]}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Record Detail Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!detailRow} onClose={() => setDetailRow(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          Record Detail
          <Chip
            size="small"
            label={detailRow?.typeLabel}
            variant="outlined"
          />
        </DialogTitle>
        <DialogContent dividers>
          {detailRow && (
            <Table size="small">
              <TableBody>
                {[
                  { label: 'Name', value: detailRow.name },
                  { label: 'Object Type', value: detailRow.objectType },
                  detailRow.sourceId
                    ? { label: 'Source ID', value: detailRow.sourceId }
                    : { label: 'Target ID', value: detailRow.targetId },
                  { label: 'Global Key', value: detailRow.globalKey, mono: true },
                  detailRow.sourceId
                    ? { label: 'Status in Source', value: '✓ Present', color: 'success.main' }
                    : { label: 'Status in Source', value: '✗ Not present', color: 'text.secondary' },
                  detailRow.sourceId
                    ? { label: 'Status in Target', value: '✗ Missing', color: 'error.main' }
                    : { label: 'Status in Target', value: '⚠ Extra record', color: 'warning.main' },
                  { label: 'Source Org', value: `${sourceAlias} (${sourceUsername})` },
                  { label: 'Target Org', value: `${targetAlias} (${targetUsername})` },
                ].map(({ label, value, mono, color }) => (
                  <TableRow key={label}>
                    <TableCell sx={{ fontWeight: 600, width: 140, color: 'text.secondary', border: 0 }}>
                      {label}
                    </TableCell>
                    <TableCell sx={{
                      fontFamily: mono ? 'monospace' : 'inherit',
                      fontSize: mono ? '0.78rem' : 'inherit',
                      color: color || 'inherit',
                      border: 0,
                      wordBreak: 'break-all',
                    }}>
                      {value}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailRow(null)}>Close</Button>
          {detailRow && !selectedIds.has(detailRow.id) && (
            <Button
              variant="contained"
              onClick={() => { toggleRow(detailRow.id); setDetailRow(null); }}
            >
              Select for Sync
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}

