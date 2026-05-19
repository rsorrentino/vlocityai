import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, LinearProgress, CircularProgress, Alert,
  Button, IconButton, Tooltip, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Dialog, DialogTitle,
  DialogContent, DialogActions, FormControl, InputLabel, Select,
  MenuItem, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails,
  TablePagination, List, ListItem, ListItemText,
  ListItemIcon, Divider, Radio, RadioGroup, FormControlLabel, Snackbar
} from '@mui/material';
import {
  Download, Visibility, CheckCircle, Error, Warning,
  ExpandMore, Assessment, BugReport, DataObject, PlayArrow,
  Description, Transform, Api, Calculate, ViewModule, TouchApp, Functions,
  Web, List as ListIcon, AttachFile, Inventory, HelpOutline, InfoOutlined, Close,
  AutoFixHigh, FindReplace, BuildCircle
} from '@mui/icons-material';
import axios from 'axios';
import ValidationProgress from '../components/ValidationProgress';

/** Convert PascalCase or camelCase to spaced readable label */
const formatLabel = (name) => {
  if (!name) return '';
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^[\s_]+/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
};

/**
 * Client-side fix registry. Maps the raw check name stored in validation results
 * to the fix kind ('simple' or 'review') and a human-readable label.
 */
const CLIENT_FIX_REGISTRY = {
  // ── Type A: assign global keys (simple, non-destructive) ──────────────────
  Product2MissingGlobalKey:             { kind: 'simple', label: 'Assign Global Keys to Products' },
  PriceListMissingGlobalKey:            { kind: 'simple', label: 'Assign Global Keys to Price Lists' },
  PriceListEntryMissingGlobalKey:       { kind: 'simple', label: 'Assign Global Keys to Price List Entries' },
  PricingElementMissingGlobalKey:       { kind: 'simple', label: 'Assign Global Keys to Pricing Elements' },
  AttributeMissingGlobalKey:            { kind: 'simple', label: 'Assign Global Keys to Attributes' },
  AttributeCategoryMissingGlobalKey:    { kind: 'simple', label: 'Assign Global Keys to Attribute Categories' },
  PicklistMissingGlobalKey:             { kind: 'simple', label: 'Assign Global Keys to Picklists' },
  ProductChildItemMissingGlobalKey:     { kind: 'simple', label: 'Assign Global Keys to Product Child Items' },
  AttributeAssignmentMissingGlobalKey:  { kind: 'simple', label: 'Assign Global Keys to Attribute Assignments' },
  RuleMissingGlobalKey:                 { kind: 'simple', label: 'Assign Global Keys to Rules' },
  CalculationMatrixMissingGlobalKey:    { kind: 'simple', label: 'Assign Global Keys to Calculation Matrices' },
  ObjectLayoutMissingGlobalKey:         { kind: 'simple', label: 'Assign Global Keys to Object Layouts' },
  UISectionMissingGlobalKey:            { kind: 'simple', label: 'Assign Global Keys to UI Sections' },
  UIFacetMissingGlobalKey:              { kind: 'simple', label: 'Assign Global Keys to UI Facets' },
  ObjectClassMissingGlobalKey:          { kind: 'simple', label: 'Assign Global Keys to Object Classes' },
  // ── Type B: delete orphaned (simple, destructive but deterministic) ────────
  OrphanedProductChildItems:            { kind: 'simple', label: 'Delete orphaned Product Child Items' },
  OrphanedCatalogProductRelationships:  { kind: 'simple', label: 'Delete orphaned Catalog-Product Relationships' },
  OrphanedAttributeAssignments:         { kind: 'simple', label: 'Delete orphaned Attribute Assignments' },
  OrphanedPicklistValues:               { kind: 'simple', label: 'Delete orphaned Picklist Values' },
  PriceListEntriesWithoutProduct:       { kind: 'simple', label: 'Delete PLEs without a Product' },
  PriceListEntriesWithoutPriceList:     { kind: 'simple', label: 'Delete PLEs without a Price List' },
  ObjectLayoutWithoutObjectClass:       { kind: 'simple', label: 'Delete Object Layouts without an Object Class' },
  UISectionWithoutObjectLayout:         { kind: 'simple', label: 'Delete UI Sections without an Object Layout' },
  UIFacetWithoutUISection:              { kind: 'simple', label: 'Delete UI Facets without a UI Section' },
  // ── Type C: duplicate review (interactive dialog) ─────────────────────────
  DuplicateProductChildItems:           { kind: 'review', label: 'Duplicate Product Child Items' },
  DuplicateCatalogProductRelationships: { kind: 'review', label: 'Duplicate Catalog-Product Relationships' },
  DuplicateAttributeAssignments:        { kind: 'review', label: 'Duplicate Attribute Assignments' },
  DuplicatePriceListEntries:            { kind: 'review', label: 'Duplicate Price List Entries' },
  DuplicateObjectLayoutsPerObjectClass: { kind: 'review', label: 'Duplicate Object Layouts per Object Class' },
  DuplicateUISection:                   { kind: 'review', label: 'Duplicate UI Sections' },
  DuplicatePricingElements:             { kind: 'review', label: 'Duplicate Pricing Elements' },
  DuplicatePicklists:                   { kind: 'review', label: 'Duplicate Picklists' },
  DuplicatePriceLists:                  { kind: 'review', label: 'Duplicate Price Lists' },
  DuplicatePricingVariables:            { kind: 'review', label: 'Duplicate Pricing Variables' },
  DuplicateAttributes:                  { kind: 'review', label: 'Duplicate Attributes' },
  DuplicateAttributeCategories:         { kind: 'review', label: 'Duplicate Attribute Categories' },
};

/**
 * Render structured details for a validation issue.
 * Handles DuplicateCompositeValue, UnexpectedRecords, and DuplicateValue types.
 */
function SfLink({ id, label, instanceUrl }) {
  if (!instanceUrl) {
    return <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{label || id}</Typography>;
  }
  return (
    <a href={`${instanceUrl}/${id}`} target="_blank" rel="noopener noreferrer"
       style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1976d2', textDecoration: 'none' }}>
      {label || id}
    </a>
  );
}

function ValidationDetails({ details, instanceUrl }) {
  if (!details || Object.keys(details).length === 0) {
    return <Typography variant="body2" color="text.secondary">No additional details available.</Typography>;
  }

  if (details.type === 'DuplicateCompositeValue') {
    const labels = details.fieldLabels || details.fields || [];
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Duplicate <strong>{labels.join(' + ')}</strong> combinations ({details.duplicateKeys?.length} shown):
        </Typography>
        <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: '#fafafa' }}>
                {labels.map(l => <TableCell key={l}><strong>{l}</strong></TableCell>)}
                <TableCell><strong>Duplicate Records</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(details.duplicateKeys || []).map(key => {
                const parts = key.split('::');
                const recs = details.duplicateDetails?.[key] || [];
                return (
                  <TableRow key={key}>
                    {parts.map((p, i) => (
                      <TableCell key={i}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{p}</Typography>
                      </TableCell>
                    ))}
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {recs.map(r => r.name || r.id).join(', ')} ({recs.length})
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Box>
    );
  }

  if (details.type === 'UnexpectedRecords') {
    const records = details.records || [];
    const totalCount = details.count ?? records.length;
    const allSameName = records.length > 1 && records.every(r => r.name === records[0].name);
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {totalCount} violation{totalCount !== 1 ? 's' : ''} found
          {records.length < totalCount ? ` (showing first ${records.length})` : ''}:
          {allSameName && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              — all named "{records[0]?.name}", showing IDs
            </Typography>
          )}
        </Typography>
        <Box sx={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: '#fafafa' }}>
                <TableCell sx={{ width: '45%' }}><strong>Salesforce ID</strong></TableCell>
                <TableCell><strong>Name</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <SfLink id={r.id} label={r.id} instanceUrl={instanceUrl} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{r.name || '—'}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Box>
    );
  }

  if (details.type === 'DuplicateValue') {
    const values = details.values || [];
    const records = details.records || [];
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {values.length} duplicate <strong>{details.fieldLabel || details.field}</strong> value{values.length !== 1 ? 's' : ''}:
        </Typography>
        <Box sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: '#fafafa' }}>
                <TableCell><strong>Duplicate Value</strong></TableCell>
                <TableCell><strong>Records</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {values.map(v => {
                const affected = records.filter(r => r.name === v);
                return (
                  <TableRow key={v} hover>
                    <TableCell><Typography variant="body2">{v}</Typography></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {affected.length > 0
                          ? affected.map(r => (
                              <SfLink key={r.id} id={r.id} label={r.name || r.id} instanceUrl={instanceUrl} />
                            ))
                          : <Typography variant="caption" color="text.secondary">—</Typography>
                        }
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Box>
    );
  }

  // Fallback: compact JSON
  return (
    <pre style={{ fontSize: '11px', backgroundColor: '#f5f5f5', padding: '10px', borderRadius: '4px', overflow: 'auto', maxHeight: '250px', margin: 0 }}>
      {JSON.stringify(details, null, 2)}
    </pre>
  );
}

function ValidationDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [countries, setCountries] = useState([]);
  const [validationResults, setValidationResults] = useState(null);
  const [currentTab, setCurrentTab] = useState(0);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [validationProgress, setValidationProgress] = useState({
    isRunning: false,
    currentStep: 0,
    totalSteps: 12,
    currentStepName: null,
    currentStepDescription: null,
  });
  // Pagination state for different tabs
  const [errorsPage, setErrorsPage] = useState(0);
  const [errorsRowsPerPage, setErrorsRowsPerPage] = useState(10);
  const [passedPage, setPassedPage] = useState(0);
  const [passedRowsPerPage, setPassedRowsPerPage] = useState(10);
  const [warningsPage, setWarningsPage] = useState(0);
  const [warningsRowsPerPage, setWarningsRowsPerPage] = useState(10);
  const [recommendationsPage, setRecommendationsPage] = useState(0);
  const [recommendationsRowsPerPage, setRecommendationsRowsPerPage] = useState(10);
  
  const [instanceUrl, setInstanceUrl] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [yamlTestDefs, setYamlTestDefs] = useState({});

  // Expanded error row for details
  const [expandedError, setExpandedError] = useState(null);
  const [expandedPassed, setExpandedPassed] = useState(null);

  // ── Fix state ──────────────────────────────────────────────────────────────
  const [fixSnackbar, setFixSnackbar] = useState(null);           // { message, severity }
  const [simpleFix, setSimpleFix] = useState(null);               // { checkName, label, count } — open = truthy
  const [simpleFixApplying, setSimpleFixApplying] = useState(false);
  const [fixLoadingCheck, setFixLoadingCheck] = useState(null);   // checkName currently previewing
  const [fixAllApplying, setFixAllApplying] = useState(false);
  const [reviewDialog, setReviewDialog] = useState(null);         // { checkName, label } — open = truthy
  const [dupGroups, setDupGroups] = useState([]);                 // loaded duplicate groups
  const [dupGroupsLoading, setDupGroupsLoading] = useState(false);
  const [keeperMap, setKeeperMap] = useState({});                 // { groupKey: recordId } keeper per group
  const [resolving, setResolving] = useState(false);

  // Vlocity Management state
  const [metadataTypes, setMetadataTypes] = useState([]);
  const [selectedMetadataType, setSelectedMetadataType] = useState('');
  const [metadataItems, setMetadataItems] = useState([]);
  const [metadataItemsPage, setMetadataItemsPage] = useState(0);
  const [metadataItemsRowsPerPage, setMetadataItemsRowsPerPage] = useState(25);
  const [mainTab, setMainTab] = useState(0); // Main tab: Validation (0), Metadata (1), Org Analysis (2)

  // Load organizations and countries on component mount
  useEffect(() => {
    fetchOrganizations();
    fetchMetadataTypes();
    fetchCountries();
    axios.get('/api/validation/test-definitions')
      .then(r => setYamlTestDefs(r.data.data?.definitions || {}))
      .catch(() => {});
  }, []);

  const fetchMetadataTypes = async () => {
    try {
      const response = await axios.get('/api/vlocity/metadata-types');
      setMetadataTypes(response.data.metadataTypes || []);
    } catch (err) {
      // Silently fail - metadata types are optional
      console.error('Failed to fetch metadata types:', err);
    }
  };

  const fetchCountries = async () => {
    try {
      const response = await axios.get('/api/validation/countries');
      setCountries(response.data.data || []);
    } catch (err) {
      // Non-fatal — country selector will just be empty
    }
  };

  const fetchOrganizations = async () => {
    try {
      const response = await axios.get('/api/orgs/list');
      const orgsData = response.data.orgs || response.data || [];
      setOrgs(Array.isArray(orgsData) ? orgsData : []);
      if (Array.isArray(orgsData) && orgsData.length > 0) {
        setSelectedOrg(orgsData[0].username);
      }
    } catch (err) {
      setError('Failed to load organizations: ' + err.message);
    }
  };

  /**
   * Merge rule-engine results (from /api/validation/pricing|deployment) into
   * the existing YAML-based validationResults shape so the dashboard renders them
   * alongside the YAML checks without any UI changes.
   *
   * Rule-engine shape per result entry:
   *   { ruleId, category, passed, errors: [{message, details, ...}], warnings: [{...}] }
   *
   * YAML shape per error/warning:
   *   { category, check, message, severity, ... }
   */
  const mergeRuleEngineResults = (base, engineData) => {
    if (!engineData?.results?.length) return base;

    const merged = {
      ...base,
      errors:   [...(base.errors   || [])],
      warnings: [...(base.warnings || [])],
      totalChecks:  (base.totalChecks  || 0),
      passedChecks: (base.passedChecks || 0),
      failedChecks: (base.failedChecks || 0),
      summary: {
        ...base.summary,
        categories: [...(base.summary?.categories || [])],
      },
    };

    for (const result of engineData.results) {
      merged.totalChecks += 1;

      if (result.executionError) continue; // rule failed to run — don't count

      if (result.passed) {
        merged.passedChecks += 1;
      } else {
        merged.failedChecks += 1;
      }

      // Append errors
      for (const e of (result.errors || [])) {
        merged.errors.push({
          category: result.category,
          check:    result.ruleId,
          message:  e.message,
          severity: 'error',
          details:  e.details || {},
        });
      }

      // Append warnings
      for (const w of (result.warnings || [])) {
        merged.warnings.push({
          category: result.category,
          check:    result.ruleId,
          message:  w.message,
          severity: 'warning',
          details:  w.details || {},
          autoCorrect: w.autoCorrect,
        });
      }

      // Update or insert category summary row
      const catName   = result.category;
      const existing  = merged.summary.categories.find(c => c.name === catName);
      const errCount  = (result.errors   || []).length;
      const warnCount = (result.warnings || []).length;

      if (existing) {
        existing.errors   = (existing.errors   || 0) + errCount;
        existing.warnings = (existing.warnings || 0) + warnCount;
        if (errCount > 0)  existing.status = 'FAIL';
        else if (warnCount > 0 && existing.status === 'PASS') existing.status = 'WARNING';
      } else {
        merged.summary.categories.push({
          name:     catName,
          status:   errCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARNING' : 'PASS',
          errors:   errCount,
          warnings: warnCount,
          checks:   [],
        });
      }
    }

    // Recompute overall status
    merged.summary.overallStatus = merged.failedChecks > 0 ? 'FAIL'
      : merged.warnings.length > 0 ? 'WARNING'
      : 'PASS';

    return merged;
  };

  const runValidation = useCallback(async () => {
    if (!selectedOrg) {
      setError('Please select an organization first');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const progressSteps = [
      { step: 0,  name: 'Initializing',              description: 'Preparing validation environment and connecting to Salesforce' },
      { step: 1,  name: 'Products',                   description: 'Validating product configurations and relationships' },
      { step: 2,  name: 'Product Hierarchy',          description: 'Checking product parent-child relationships and pricing objects' },
      { step: 3,  name: 'Price Lists',                description: 'Validating price list configurations and entries' },
      { step: 4,  name: 'Pricing Plans',              description: 'Checking pricing plan configurations and steps' },
      { step: 5,  name: 'Pricing Variables',          description: 'Validating pricing variable definitions' },
      { step: 6,  name: 'Pricing Elements',           description: 'Checking pricing element configurations' },
      { step: 7,  name: 'Promotions',                 description: 'Validating promotion rules and configurations' },
      { step: 8,  name: 'Rate Codes',                 description: 'Checking rate code definitions' },
      { step: 9,  name: 'Rate Tables',                description: 'Validating rate table configurations' },
      { step: 10, name: 'Staging Area',               description: 'Checking staging area records (if available)' },
      { step: 11, name: 'Object Layouts & GT',        description: 'Checking GT object page layouts via Tooling API' },
      { step: 12, name: 'Finalizing',                 description: 'Compiling results and generating report' },
    ];

    setValidationProgress({
      isRunning: true,
      currentStep: 0,
      totalSteps: progressSteps.length,
      currentStepName: progressSteps[0].name,
      currentStepDescription: progressSteps[0].description,
    });

    const updateProgress = (stepIndex) => {
      if (stepIndex < progressSteps.length) {
        const s = progressSteps[stepIndex];
        setValidationProgress({
          isRunning: true,
          currentStep: stepIndex,
          totalSteps: progressSteps.length,
          currentStepName: s.name,
          currentStepDescription: s.description,
        });
      }
    };

    try {
      // Steps 0-10: show progress while YAML tests run
      for (let i = 0; i <= 10; i++) {
        updateProgress(i);
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      // ── Phase 1: YAML-based test suite (existing) ────────────────────────
      const countryParam = selectedCountry ? `&countryCode=${encodeURIComponent(selectedCountry)}` : '';
      const yamlResponse = await axios.get(
        `/api/validation/run?username=${encodeURIComponent(selectedOrg)}&isSandbox=false${countryParam}`
      );

      if (!yamlResponse.data.success) throw new Error('Validation run failed');

      let results      = yamlResponse.data.data;
      const instanceUrlValue = results.instanceUrl || null;
      setInstanceUrl(instanceUrlValue);

      // ── Phase 2: Tooling API checks (Rule 8 only) ────────────────────────
      // Rules 11 (InactiveCalculationProcedures) and 14 (AsyncApexJobFailures)
      // are now covered by DeploymentReadiness.yaml in Phase 1.
      // Rule 8 (missing GT object layouts) requires the Tooling API and cannot
      // be expressed as a SOQL-based YAML test, so it stays here.

      updateProgress(11);
      const [deploymentRes] = await Promise.allSettled([
        axios.post('/api/validation/deployment', {
          username:    selectedOrg,
          countryCode: selectedCountry || undefined,
          context:     { targetUsername: selectedOrg },
          rules:       ['deployment.missing-gt-object-layout'],
        }),
      ]);

      if (deploymentRes.status === 'fulfilled' && deploymentRes.value.data?.success) {
        results = mergeRuleEngineResults(results, deploymentRes.value.data.data);
      }

      updateProgress(12);
      setValidationResults(results);
      setValidationProgress({
        isRunning: false,
        currentStep: progressSteps.length - 1,
        totalSteps: progressSteps.length,
        currentStepName: 'Completed',
        currentStepDescription: 'Validation completed successfully',
      });
      setSuccess('Validation completed successfully! Review the results below.');
      setTimeout(() => setSuccess(null), 8000);

    } catch (err) {
      setValidationProgress({
        isRunning: false,
        currentStep: 0,
        totalSteps: progressSteps.length,
        currentStepName: 'Failed',
        currentStepDescription: `Validation failed: ${err.response?.data?.error?.message || err.message}`,
      });
      setError(`Validation failed: ${err.response?.data?.error?.message || err.message}. Please check your Salesforce connection and try again.`);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, selectedCountry]);

  const handleTabChange = (event, newValue) => {
    setCurrentTab(newValue);
  };

  const handleViewDetails = (category) => {
    setSelectedCategory(category);
    setDetailsDialogOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailsDialogOpen(false);
    setSelectedCategory(null);
  };

  const handleDownloadReport = async () => {
    if (!selectedOrg) return;

    try {
      const response = await axios.get(`/api/validation/report?username=${encodeURIComponent(selectedOrg)}&format=csv`, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `validation-report-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError('Failed to download report: ' + err.message);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PASS': return 'success';
      case 'FAIL': return 'error';
      case 'WARNING': return 'warning';
      default: return 'default';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'PASS': return <CheckCircle />;
      case 'FAIL': return <Error />;
      case 'WARNING': return <Warning />;
      default: return <BugReport />;
    }
  };

  const renderOverviewTab = () => {
    if (!validationResults) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" color="text.secondary">
            Click "Run Validation" to start
          </Typography>
        </Box>
      );
    }

    const { summary } = validationResults;
    const healthScore = calculateHealthScore(validationResults);

    return (
      <Box>
        {/* Health Score Card */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Assessment sx={{ mr: 1 }} />
                <Typography variant="h6">System Health Score</Typography>
              </Box>
              {/* Country scope badge */}
              {validationResults?.countryCode ? (
                <Chip
                  label={`${validationResults.countryName || validationResults.countryCode} only`}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              ) : (
                <Chip label="All Countries" size="small" variant="outlined" />
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ flexGrow: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={healthScore}
                  sx={{ height: 20, borderRadius: 10 }}
                  color={healthScore >= 80 ? 'success' : healthScore >= 60 ? 'warning' : 'error'}
                />
              </Box>
              <Typography variant="h4" color={healthScore >= 80 ? 'success.main' : healthScore >= 60 ? 'warning.main' : 'error.main'}>
                {healthScore}%
              </Typography>
            </Box>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <CheckCircle color="success" sx={{ mr: 1 }} />
                  <Typography variant="h6">{validationResults.passedChecks}</Typography>
                </Box>
                <Typography color="text.secondary">Passed Checks</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Error color="error" sx={{ mr: 1 }} />
                  <Typography variant="h6">{validationResults.failedChecks}</Typography>
                </Box>
                <Typography color="text.secondary">Failed Checks</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Warning color="warning" sx={{ mr: 1 }} />
                  <Typography variant="h6">{validationResults.warnings.length}</Typography>
                </Box>
                <Typography color="text.secondary">Warnings</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <DataObject color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">{validationResults.totalChecks}</Typography>
                </Box>
                <Typography color="text.secondary">Total Checks</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Categories Status */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Validation Categories
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Errors</TableCell>
                    <TableCell>Warnings</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.categories.map((category) => (
                    <TableRow key={category.name}>
                      <TableCell>{formatLabel(category.name)}</TableCell>
                      <TableCell>
                        <Chip
                          icon={getStatusIcon(category.status)}
                          label={category.status}
                          color={getStatusColor(category.status)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{category.errors}</TableCell>
                      <TableCell>{category.warnings}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="View Details">
                          <IconButton
                            size="small"
                            onClick={() => handleViewDetails(category)}
                          >
                            <Visibility />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>
    );
  };

  const renderPassedTab = () => {
    if (!validationResults || !validationResults.passed || validationResults.passed.length === 0) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" color="text.secondary">
            No passed checks to display
          </Typography>
        </Box>
      );
    }

    const passedToShow = validationResults.passed.slice(
      passedPage * passedRowsPerPage,
      passedPage * passedRowsPerPage + passedRowsPerPage
    );

    return (
      <Box>
        <TableContainer sx={{ mb: 2 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell width="5%"></TableCell>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell><strong>Check</strong></TableCell>
                <TableCell><strong>Message</strong></TableCell>
                <TableCell><strong>Timestamp</strong></TableCell>
                <TableCell width="10%" align="center"><strong>Details</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {passedToShow.map((passed, index) => {
                const passedIndex = passedPage * passedRowsPerPage + index;
                const isExpanded = expandedPassed === passedIndex;
                return (
                  <React.Fragment key={passedIndex}>
                    <TableRow hover>
                      <TableCell>
                        <CheckCircle color="success" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{passed.category}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{passed.check}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ maxWidth: 400 }}>
                          {passed.message}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {passed.timestamp ? new Date(passed.timestamp).toLocaleString() : 'N/A'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          size="small"
                          onClick={() => setExpandedPassed(isExpanded ? null : passedIndex)}
                        >
                          <ExpandMore 
                            sx={{ 
                              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              transition: 'transform 0.3s'
                            }} 
                          />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={6} sx={{ py: 2, backgroundColor: '#f0f9f0' }}>
                          <Box>
                            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold' }}>
                              Check Details:
                            </Typography>
                            {passed.details && Object.keys(passed.details).length > 0 ? (
                              <Box sx={{ mt: 1 }}>
                                <pre style={{ 
                                  fontSize: '12px', 
                                  backgroundColor: '#f5f5f5', 
                                  padding: '12px', 
                                  borderRadius: '4px',
                                  overflow: 'auto',
                                  maxHeight: '300px'
                                }}>
                                  {JSON.stringify(passed.details, null, 2)}
                                </pre>
                              </Box>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                No additional details available.
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={validationResults.passed.length}
          page={passedPage}
          onPageChange={(e, newPage) => setPassedPage(newPage)}
          rowsPerPage={passedRowsPerPage}
          onRowsPerPageChange={(e) => {
            setPassedRowsPerPage(parseInt(e.target.value, 10));
            setPassedPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Box>
    );
  };

  // ── Fix handlers ────────────────────────────────────────────────────────────

  const handleSimpleFixClick = async (checkName) => {
    setFixLoadingCheck(checkName);
    try {
      const res = await axios.post('/api/validation/preview-fix', { username: selectedOrg, checkName });
      const { count, label, fixType } = res.data.data;
      setSimpleFix({ checkName, label, count, fixType });
    } catch (err) {
      setFixSnackbar({ message: `Preview failed: ${err.response?.data?.message || err.message}`, severity: 'error' });
    } finally {
      setFixLoadingCheck(null);
    }
  };

  const handleSimpleFixApply = async () => {
    if (!simpleFix) return;
    setSimpleFixApplying(true);
    try {
      const res = await axios.post('/api/validation/fix', { username: selectedOrg, checkName: simpleFix.checkName });
      const { message } = res.data.data;
      setFixSnackbar({ message: `✓ ${message}`, severity: 'success' });
      // Optimistically remove the fixed check from the results
      if (validationResults) {
        setValidationResults(prev => ({
          ...prev,
          errors: prev.errors.filter(e => e.check !== simpleFix.checkName),
          warnings: prev.warnings.filter(w => w.check !== simpleFix.checkName),
        }));
      }
    } catch (err) {
      setFixSnackbar({ message: `Fix failed: ${err.response?.data?.message || err.message}`, severity: 'error' });
    } finally {
      setSimpleFixApplying(false);
      setSimpleFix(null);
    }
  };

  const handleFixAllSimple = async () => {
    if (!validationResults) return;
    const simpleChecks = validationResults.errors
      .filter(e => CLIENT_FIX_REGISTRY[e.check]?.kind === 'simple')
      .map(e => e.check);
    if (simpleChecks.length === 0) return;

    setFixAllApplying(true);
    let appliedCount = 0;
    let affectedTotal = 0;
    const fixedChecks = new Set();
    for (const checkName of simpleChecks) {
      try {
        const res = await axios.post('/api/validation/fix', { username: selectedOrg, checkName });
        affectedTotal += res.data.data?.recordsAffected || 0;
        fixedChecks.add(checkName);
        appliedCount++;
      } catch (err) {
        console.warn('Fix failed for', checkName, err.message);
      }
    }
    if (appliedCount > 0 && validationResults) {
      setValidationResults(prev => ({
        ...prev,
        errors: prev.errors.filter(e => !fixedChecks.has(e.check)),
        warnings: prev.warnings.filter(w => !fixedChecks.has(w.check)),
      }));
    }
    setFixSnackbar({ message: `✓ Applied ${appliedCount} fixes — ${affectedTotal} records affected`, severity: 'success' });
    setFixAllApplying(false);
  };

  const handleOpenReview = async (checkName) => {
    const cfg = CLIENT_FIX_REGISTRY[checkName];
    setReviewDialog({ checkName, label: cfg?.label || formatLabel(checkName) });
    setDupGroups([]);
    setKeeperMap({});
    setDupGroupsLoading(true);
    try {
      const res = await axios.get('/api/validation/duplicate-groups', { params: { username: selectedOrg, checkName } });
      const { groups } = res.data.data;
      setDupGroups(groups);
      // Default: keep the first record in each group (oldest, since query is ORDER BY CreatedDate ASC)
      const defaultKeepers = {};
      groups.forEach(g => { defaultKeepers[g.key] = g.records[0]?.id; });
      setKeeperMap(defaultKeepers);
    } catch (err) {
      setFixSnackbar({ message: `Failed to load groups: ${err.response?.data?.message || err.message}`, severity: 'error' });
      setReviewDialog(null);
    } finally {
      setDupGroupsLoading(false);
    }
  };

  const handleSelectAllOldest = () => {
    const defaultKeepers = {};
    dupGroups.forEach(g => { defaultKeepers[g.key] = g.records[0]?.id; });
    setKeeperMap(defaultKeepers);
  };

  const handleResolve = async () => {
    if (!reviewDialog) return;
    const deleteIds = [];
    dupGroups.forEach(g => {
      const keepId = keeperMap[g.key];
      g.records.forEach(r => { if (r.id !== keepId) deleteIds.push(r.id); });
    });
    if (deleteIds.length === 0) {
      setFixSnackbar({ message: 'No records selected for deletion', severity: 'info' });
      return;
    }
    setResolving(true);
    try {
      const res = await axios.post('/api/validation/resolve-duplicates', {
        username: selectedOrg,
        checkName: reviewDialog.checkName,
        deleteIds,
      });
      const { message } = res.data.data;
      setFixSnackbar({ message: `✓ ${message}`, severity: 'success' });
      if (validationResults) {
        setValidationResults(prev => ({
          ...prev,
          errors: prev.errors.filter(e => e.check !== reviewDialog.checkName),
          warnings: prev.warnings.filter(w => w.check !== reviewDialog.checkName),
        }));
      }
      setReviewDialog(null);
    } catch (err) {
      setFixSnackbar({ message: `Resolve failed: ${err.response?.data?.message || err.message}`, severity: 'error' });
    } finally {
      setResolving(false);
    }
  };

  // ── Derived fix stats ────────────────────────────────────────────────────────

  const simpleFixableErrors = validationResults
    ? validationResults.errors.filter(e => CLIENT_FIX_REGISTRY[e.check]?.kind === 'simple')
    : [];

  const renderErrorsTab = () => {
    if (!validationResults || validationResults.errors.length === 0) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CheckCircle color="success" sx={{ fontSize: 48, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No errors found!
          </Typography>
        </Box>
      );
    }

    const errorsToShow = validationResults.errors.slice(
      errorsPage * errorsRowsPerPage,
      errorsPage * errorsRowsPerPage + errorsRowsPerPage
    );

    return (
      <Box>
        {/* Fix All Simple bar */}
        {simpleFixableErrors.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, p: 1, backgroundColor: '#e8f5e9', borderRadius: 1, border: '1px solid #c8e6c9' }}>
            <AutoFixHigh color="success" fontSize="small" />
            <Typography variant="body2" sx={{ flex: 1 }}>
              <strong>{simpleFixableErrors.length}</strong> issue{simpleFixableErrors.length !== 1 ? 's' : ''} can be fixed automatically
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={fixAllApplying ? <CircularProgress size={14} color="inherit" /> : <AutoFixHigh />}
              onClick={handleFixAllSimple}
              disabled={fixAllApplying}
            >
              Fix All Simple ({simpleFixableErrors.length})
            </Button>
          </Box>
        )}
        <TableContainer sx={{ mb: 2 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell width="5%"></TableCell>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell><strong>Check</strong></TableCell>
                <TableCell><strong>Message</strong></TableCell>
                <TableCell><strong>Timestamp</strong></TableCell>
                <TableCell width="8%" align="center"><strong>Fix</strong></TableCell>
                <TableCell width="8%" align="center"><strong>Details</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {errorsToShow.map((error, index) => {
                const errorIndex = errorsPage * errorsRowsPerPage + index;
                const isExpanded = expandedError === errorIndex;
                const fixCfg = CLIENT_FIX_REGISTRY[error.check];
                const isLoadingThis = fixLoadingCheck === error.check;
                return (
                  <React.Fragment key={errorIndex}>
                    <TableRow hover>
                      <TableCell>
                        <Error color="error" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{formatLabel(error.category)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{formatLabel(error.check)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ maxWidth: 400 }}>
                          {error.message}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {error.timestamp ? new Date(error.timestamp).toLocaleString() : 'N/A'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        {fixCfg?.kind === 'simple' && (
                          <Tooltip title={`Auto-fix: ${fixCfg.label}`}>
                            <IconButton
                              size="small"
                              color="success"
                              onClick={() => handleSimpleFixClick(error.check)}
                              disabled={isLoadingThis || fixAllApplying}
                            >
                              {isLoadingThis ? <CircularProgress size={16} color="inherit" /> : <AutoFixHigh />}
                            </IconButton>
                          </Tooltip>
                        )}
                        {fixCfg?.kind === 'review' && (
                          <Tooltip title={`Review & fix duplicates: ${fixCfg.label}`}>
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() => handleOpenReview(error.check)}
                              disabled={fixAllApplying}
                            >
                              <FindReplace />
                            </IconButton>
                          </Tooltip>
                        )}
                        {!fixCfg && (
                          <Tooltip title="Cannot be auto-fixed — manual intervention required">
                            <span>
                              <IconButton size="small" disabled>
                                <BuildCircle />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          size="small"
                          onClick={() => setExpandedError(isExpanded ? null : errorIndex)}
                        >
                          <ExpandMore
                            sx={{
                              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              transition: 'transform 0.3s'
                            }}
                          />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 2, px: 3, backgroundColor: '#f9f9f9' }}>
                          <ValidationDetails details={error.details} instanceUrl={instanceUrl} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={validationResults.errors.length}
          page={errorsPage}
          onPageChange={(e, newPage) => setErrorsPage(newPage)}
          rowsPerPage={errorsRowsPerPage}
          onRowsPerPageChange={(e) => {
            setErrorsRowsPerPage(parseInt(e.target.value, 10));
            setErrorsPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Box>
    );
  };

  const renderWarningsTab = () => {
    if (!validationResults || validationResults.warnings.length === 0) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CheckCircle color="success" sx={{ fontSize: 48, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No warnings found!
          </Typography>
        </Box>
      );
    }

    const warningsToShow = validationResults.warnings.slice(
      warningsPage * warningsRowsPerPage,
      warningsPage * warningsRowsPerPage + warningsRowsPerPage
    );

    return (
      <Box>
        {warningsToShow.map((warning, index) => (
          <Accordion key={warningsPage * warningsRowsPerPage + index}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <Warning color="warning" sx={{ mr: 1 }} />
                <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                  {formatLabel(warning.category)} — {formatLabel(warning.check)}
                </Typography>
                <Chip label="WARNING" color="warning" size="small" />
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {warning.message}
              </Typography>
              {warning.details && <ValidationDetails details={warning.details} instanceUrl={instanceUrl} />}
            </AccordionDetails>
          </Accordion>
        ))}
        <TablePagination
          component="div"
          count={validationResults.warnings.length}
          page={warningsPage}
          onPageChange={(e, newPage) => setWarningsPage(newPage)}
          rowsPerPage={warningsRowsPerPage}
          onRowsPerPageChange={(e) => {
            setWarningsRowsPerPage(parseInt(e.target.value, 10));
            setWarningsPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Box>
    );
  };

  const renderRecommendationsTab = () => {
    if (!validationResults || !validationResults.summary.recommendations) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" color="text.secondary">
            No recommendations available
          </Typography>
        </Box>
      );
    }

    const recommendationsToShow = validationResults.summary.recommendations.slice(
      recommendationsPage * recommendationsRowsPerPage,
      recommendationsPage * recommendationsRowsPerPage + recommendationsRowsPerPage
    );

    return (
      <Box>
        {recommendationsToShow.map((rec, index) => (
          <Card key={recommendationsPage * recommendationsRowsPerPage + index} sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Chip
                  label={rec.priority}
                  color={rec.priority === 'HIGH' ? 'error' : rec.priority === 'MEDIUM' ? 'warning' : 'info'}
                  size="small"
                  sx={{ mr: 1 }}
                />
                <Typography variant="h6">{rec.title}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {rec.description}
              </Typography>
              <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                Action: {rec.action}
              </Typography>
            </CardContent>
          </Card>
        ))}
        <TablePagination
          component="div"
          count={validationResults.summary.recommendations.length}
          page={recommendationsPage}
          onPageChange={(e, newPage) => setRecommendationsPage(newPage)}
          rowsPerPage={recommendationsRowsPerPage}
          onRowsPerPageChange={(e) => {
            setRecommendationsRowsPerPage(parseInt(e.target.value, 10));
            setRecommendationsPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Box>
    );
  };

  // Vlocity Management functions
  const fetchMetadata = async (orgUsername, metadataType) => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`/api/vlocity/metadata/${metadataType}`, {
        params: { username: orgUsername }
      });
      
      setMetadataItems(response.data.result || []);
      if (response.data.result && response.data.result.length === 0) {
        setError(`No ${metadataType} metadata found in the selected org.`);
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(`Failed to fetch metadata: ${errorMessage}`);
      setMetadataItems([]);
    } finally {
      setLoading(false);
    }
  };

  const getMetadataIcon = (type) => {
    const iconMap = {
      OmniScript: <Description />,
      DataRaptor: <Transform />,
      IntegrationProcedure: <Api />,
      CalculationProcedure: <Calculate />,
      FlexCard: <ViewModule />,
      VlocityCard: <ViewModule />,
      VlocityAction: <TouchApp />,
      VlocityFunction: <Functions />,
      VlocityUITemplate: <Web />,
      VlocityPicklist: <ListIcon />,
      VlocityAttachment: <AttachFile />,
      VlocityCMT: <Inventory />,
    };
    return iconMap[type] || <Description />;
  };

  const getMetadataColor = (category) => {
    const colorMap = {
      UI: 'primary',
      Data: 'secondary',
      Integration: 'success',
      Logic: 'warning',
      Catalog: 'info',
    };
    return colorMap[category] || 'default';
  };

  const calculateHealthScore = (results) => {
    const totalChecks = results.totalChecks;
    const failedChecks = results.failedChecks;
    const warnings = results.warnings.length;

    if (totalChecks === 0) return 0;

    const score = Math.max(0, ((totalChecks - failedChecks - (warnings * 0.5)) / totalChecks) * 100);
    return Math.round(score);
  };

  // Rendering functions for Vlocity Management tabs
  const renderMetadataTab = () => (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Available Metadata Types
            </Typography>
            <List>
              {metadataTypes.map((type, index) => (
                <React.Fragment key={index}>
                  <ListItem>
                    <ListItemIcon>
                      {getMetadataIcon(type.name)}
                    </ListItemIcon>
                    <ListItemText
                      primary={type.name}
                      secondary={type.description}
                    />
                    <Chip
                      label={type.category}
                      color={getMetadataColor(type.category)}
                      size="small"
                    />
                  </ListItem>
                  {index < metadataTypes.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Browse Metadata
            </Typography>
            
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Metadata Type</InputLabel>
              <Select
                value={selectedMetadataType}
                label="Metadata Type"
                onChange={(e) => {
                  setSelectedMetadataType(e.target.value);
                  if (selectedOrg) {
                    fetchMetadata(selectedOrg, e.target.value);
                  }
                }}
                disabled={!selectedOrg}
              >
                {Array.isArray(metadataTypes) && metadataTypes.map((type) => (
                  <MenuItem key={type.name} value={type.name}>
                    {type.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {loading && selectedOrg && selectedMetadataType && (
              <Box sx={{ mt: 2 }}>
                <LinearProgress />
                <Typography variant="body2" sx={{ mt: 1, textAlign: 'center' }}>
                  Loading metadata...
                </Typography>
              </Box>
            )}

            {!loading && selectedOrg && selectedMetadataType && metadataItems.length === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                No {selectedMetadataType} metadata found in the selected org.
              </Alert>
            )}

            {metadataItems.length > 0 && (
              <Box>
                <Typography variant="subtitle1" gutterBottom>
                  Found {metadataItems.length} {selectedMetadataType} items
                </Typography>
                <List dense>
                  {metadataItems
                    .slice(
                      metadataItemsPage * metadataItemsRowsPerPage,
                      metadataItemsPage * metadataItemsRowsPerPage + metadataItemsRowsPerPage
                    )
                    .map((item, index) => (
                      <ListItem 
                        key={item.id || metadataItemsPage * metadataItemsRowsPerPage + index}
                        sx={{ 
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          '&:hover': { bgcolor: 'action.hover' }
                        }}
                      >
                        <ListItemIcon>
                          {getMetadataIcon(selectedMetadataType)}
                        </ListItemIcon>
                        <ListItemText
                          primary={item.name || item.fullName || item.id}
                          secondaryTypographyProps={{ component: 'div' }}
                          secondary={
                            <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                              {item.type && (
                                <Chip
                                  label={item.type}
                                  size="small"
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              )}
                              {item.subType && (
                                <Chip
                                  label={item.subType}
                                  size="small"
                                  variant="outlined"
                                  color="secondary"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              )}
                              {item.language && (
                                <Chip
                                  label={item.language}
                                  size="small"
                                  variant="outlined"
                                  color="info"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              )}
                              {item.isActive !== undefined && (
                                <Chip
                                  label={item.isActive ? 'Active' : 'Inactive'}
                                  size="small"
                                  color={item.isActive ? 'success' : 'default'}
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              )}
                            </Box>
                          }
                        />
                      </ListItem>
                    ))}
                </List>
                <TablePagination
                  component="div"
                  count={metadataItems.length}
                  page={metadataItemsPage}
                  onPageChange={(e, newPage) => setMetadataItemsPage(newPage)}
                  rowsPerPage={metadataItemsRowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setMetadataItemsRowsPerPage(parseInt(e.target.value, 10));
                    setMetadataItemsPage(0);
                  }}
                  rowsPerPageOptions={[10, 25, 50, 100]}
                />
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Vlocity Validation</Typography>
      </Box>

      {/* Organization Selection */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl sx={{ minWidth: 300 }}>
              <InputLabel>Select Org</InputLabel>
              <Select
                value={selectedOrg}
                label="Select Org"
                onChange={(e) => setSelectedOrg(e.target.value)}
              >
                {Array.isArray(orgs) && orgs.map((org) => {
                  // Build a descriptive label
                  let label = org.alias || org.username;
                  const parts = [];
                  
                  // Add environment if available
                  if (org.environment) {
                    parts.push(org.environment.toUpperCase());
                  }
                  
                  // Add type indicators
                  if (org.isDefault) parts.push('Default');
                  if (org.isSource) parts.push('Source');
                  if (org.isTarget) parts.push('Target');
                  
                  // Only flag sandboxes explicitly; "Production" is the default and adds noise
                  if (org.isSandbox) {
                    parts.push('Sandbox');
                  }
                  
                  if (parts.length > 0) {
                    label += ` (${parts.join(', ')})`;
                  }
                  
                  return (
                    <MenuItem key={org.username} value={org.username}>
                      {label}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>

            {/* Country filter — scopes all YAML queries and rule-engine checks */}
            <FormControl sx={{ minWidth: 160 }}>
              <InputLabel>Country</InputLabel>
              <Select
                value={selectedCountry}
                label="Country"
                onChange={(e) => setSelectedCountry(e.target.value)}
              >
                <MenuItem value=""><em>All Countries</em></MenuItem>
                {countries.map(c => (
                  <MenuItem key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {mainTab === 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
                  onClick={runValidation}
                  disabled={loading || !selectedOrg}
                  sx={{ minWidth: 150 }}
                >
                  {loading ? 'Running...' : 'Run Validation'}
                </Button>
                <Tooltip title={legendOpen ? 'Hide validation legend' : 'View all checks that will be run'} arrow>
                  <IconButton size="small" onClick={() => setLegendOpen(v => !v)} color={legendOpen ? 'primary' : 'default'}>
                    <InfoOutlined />
                  </IconButton>
                </Tooltip>
                {!selectedOrg && (
                  <Tooltip title="Please select a Salesforce organization to run validation. This will check your pricing system configuration for issues." arrow>
                    <IconButton size="small">
                      <HelpOutline />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            )}
            
            {validationResults && (
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={handleDownloadReport}
              >
                Download Report
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Error and Success Messages */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Validation Legend */}
      {legendOpen && mainTab === 0 && (() => {
        const BUILTIN_CATEGORIES = [
          { name: 'Products', description: 'Active products: required fields, duplicate codes, GlobalKey presence' },
          { name: 'Product Hierarchy', description: 'ProductChildItem relationships: orphaned refs, duplicate parent+child pairs' },
          { name: 'Price Lists', description: 'Active price lists: required fields, duplicate codes, date ranges, primary coverage' },
          { name: 'Pricing Elements', description: 'Active pricing elements: required fields, duplicate names, null amounts' },
          { name: 'Pricing Variables', description: 'Pricing variables: required fields, duplicate codes' },
          { name: 'Pricing Plans', description: 'Pricing plan steps and their references' },
          { name: 'Promotions', description: 'Promotion rules: validity periods, product references' },
          { name: 'Rate Codes', description: 'Rate code definitions and required fields' },
          { name: 'Rate Tables', description: 'Rate table configurations and entry completeness' },
          { name: 'Staging Area', description: 'Staging area records (if applicable to this org)' },
          { name: 'Price List Coverage', description: 'Every product in each commercial offer hierarchy has a "One Time Std Price" entry in the same price list' },
        ];

        const severityColor = (s) => s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'default';
        const yamlGroups = Object.entries(yamlTestDefs);
        const totalYaml = yamlGroups.reduce((n, [, tests]) => n + tests.length, 0);
        const totalBuiltin = BUILTIN_CATEGORIES.length;

        return (
          <Card variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, backgroundColor: 'primary.main', color: 'white' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <InfoOutlined fontSize="small" />
                <Typography variant="subtitle1" fontWeight={600}>
                  Validation Legend — {totalBuiltin + totalYaml} checks across {BUILTIN_CATEGORIES.length + yamlGroups.length} categories
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => setLegendOpen(false)} sx={{ color: 'white' }}>
                <Close fontSize="small" />
              </IconButton>
            </Box>

            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {/* Built-in checks */}
              <Accordion disableGutters defaultExpanded={false}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={totalBuiltin} size="small" color="primary" />
                    <Typography variant="subtitle2">Built-in Validations</Typography>
                    <Typography variant="caption" color="text.secondary">— deep checks on pricing system integrity</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: '#fafafa' }}>
                        <TableCell sx={{ width: '25%' }}><strong>Category</strong></TableCell>
                        <TableCell><strong>What is checked</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {BUILTIN_CATEGORIES.map(cat => (
                        <TableRow key={cat.name} hover>
                          <TableCell><Typography variant="body2" fontWeight={500}>{cat.name}</Typography></TableCell>
                          <TableCell><Typography variant="body2" color="text.secondary">{cat.description}</Typography></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionDetails>
              </Accordion>

              {/* YAML-based checks */}
              {yamlGroups.map(([groupName, tests]) => (
                <Accordion key={groupName} disableGutters defaultExpanded={false}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip label={tests.length} size="small" color="secondary" />
                      <Typography variant="subtitle2">{formatLabel(groupName)}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {tests.filter(t => t.severity === 'error').length > 0 && (
                          <Chip label={`${tests.filter(t => t.severity === 'error').length} errors`} size="small" color="error" variant="outlined" />
                        )}
                        {tests.filter(t => t.severity === 'warning').length > 0 && (
                          <Chip label={`${tests.filter(t => t.severity === 'warning').length} warnings`} size="small" color="warning" variant="outlined" />
                        )}
                      </Box>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: '#fafafa' }}>
                          <TableCell sx={{ width: '30%' }}><strong>Check</strong></TableCell>
                          <TableCell><strong>Description</strong></TableCell>
                          <TableCell sx={{ width: '100px' }} align="center"><strong>Severity</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {tests.map(t => (
                          <TableRow key={t.name} hover>
                            <TableCell><Typography variant="body2" fontWeight={500}>{formatLabel(t.name)}</Typography></TableCell>
                            <TableCell><Typography variant="body2" color="text.secondary">{t.description}</Typography></TableCell>
                            <TableCell align="center">
                              <Chip label={t.severity} size="small" color={severityColor(t.severity)} variant="outlined" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          </Card>
        );
      })()}

      {/* Validation Progress Indicator */}
      {validationProgress.isRunning && (
        <ValidationProgress
          isRunning={validationProgress.isRunning}
          currentStep={validationProgress.currentStep}
          totalSteps={validationProgress.totalSteps}
          currentStepName={validationProgress.currentStepName}
          currentStepDescription={validationProgress.currentStepDescription}
        />
      )}

      {loading && !validationProgress.isRunning && <LinearProgress sx={{ mb: 2 }} />}

      {/* Main Tabs */}
      <Card>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={mainTab} onChange={(e, newValue) => setMainTab(newValue)}>
            <Tab label="Validation Checks" icon={<Assessment />} iconPosition="start" />
            <Tab label="Metadata Browser" icon={<DataObject />} iconPosition="start" />
          </Tabs>
        </Box>
        
        <CardContent>
          {mainTab === 0 && (
            <>
              {validationResults ? (
                <Box>
                  <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                    <Tabs value={currentTab} onChange={handleTabChange}>
                      <Tab label="Overview" />
                      <Tab label="Errors" />
                      <Tab label="Passed Checks" />
                      <Tab label="Warnings" />
                      <Tab label="Recommendations" />
                    </Tabs>
                  </Box>
                  {currentTab === 0 && renderOverviewTab()}
                  {currentTab === 1 && renderErrorsTab()}
                  {currentTab === 2 && renderPassedTab()}
                  {currentTab === 3 && renderWarningsTab()}
                  {currentTab === 4 && renderRecommendationsTab()}
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="h6" color="text.secondary">
                    Click "Run Validation" to start
                  </Typography>
                </Box>
              )}
            </>
          )}
          {mainTab === 1 && renderMetadataTab()}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={handleCloseDetails}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {formatLabel(selectedCategory?.name)}
          {selectedCategory && (
            <Chip label={selectedCategory.status} color={getStatusColor(selectedCategory.status)} size="small" />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {selectedCategory && validationResults && (() => {
            const catName = selectedCategory.name;
            const catErrors = validationResults.errors.filter(e => e.category === catName);
            const catWarnings = validationResults.warnings.filter(w => w.category === catName);
            const catPassed = validationResults.passed.filter(p => p.category === catName);
            return (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Summary row */}
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Chip icon={<Error />} label={`${catErrors.length} error${catErrors.length !== 1 ? 's' : ''}`} color="error" size="small" variant={catErrors.length ? 'filled' : 'outlined'} />
                  <Chip icon={<Warning />} label={`${catWarnings.length} warning${catWarnings.length !== 1 ? 's' : ''}`} color="warning" size="small" variant={catWarnings.length ? 'filled' : 'outlined'} />
                  <Chip icon={<CheckCircle />} label={`${catPassed.length} passed`} color="success" size="small" variant={catPassed.length ? 'filled' : 'outlined'} />
                </Box>

                {/* Errors */}
                {catErrors.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" color="error" gutterBottom>Errors</Typography>
                    {catErrors.map((e, i) => (
                      <Box key={i} sx={{ mb: 2, p: 1.5, border: '1px solid #ffcdd2', borderRadius: 1, backgroundColor: '#fff8f8' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{formatLabel(e.check)}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: e.details ? 1 : 0 }}>{e.message}</Typography>
                        {e.details && <ValidationDetails details={e.details} instanceUrl={instanceUrl} />}
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Warnings */}
                {catWarnings.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" color="warning.main" gutterBottom>Warnings</Typography>
                    {catWarnings.map((w, i) => (
                      <Box key={i} sx={{ mb: 1.5, p: 1.5, border: '1px solid #ffe0b2', borderRadius: 1, backgroundColor: '#fffbf5' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{formatLabel(w.check)}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: w.details ? 1 : 0 }}>{w.message}</Typography>
                        {w.details && <ValidationDetails details={w.details} instanceUrl={instanceUrl} />}
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Passed */}
                {catPassed.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" color="success.main" gutterBottom>Passed Checks</Typography>
                    {catPassed.map((p, i) => (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <CheckCircle color="success" sx={{ fontSize: 16 }} />
                        <Typography variant="body2">{formatLabel(p.check)}</Typography>
                        <Typography variant="caption" color="text.secondary">— {p.message}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDetails}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ── Simple Fix Confirmation Dialog ───────────────────────────────── */}
      <Dialog open={!!simpleFix} onClose={() => !simpleFixApplying && setSimpleFix(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHigh color="success" />
          Auto-Fix
        </DialogTitle>
        <DialogContent>
          {simpleFix && (
            <Box>
              <Typography variant="body1" gutterBottom>{simpleFix.label}</Typography>
              <Alert severity={simpleFix.fixType === 'delete_orphaned' ? 'warning' : 'info'} sx={{ mt: 1 }}>
                This will affect <strong>{simpleFix.count}</strong> record{simpleFix.count !== 1 ? 's' : ''}.
                {simpleFix.count === 0 && ' No action needed.'}
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSimpleFix(null)} disabled={simpleFixApplying}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleSimpleFixApply}
            disabled={simpleFixApplying || simpleFix?.count === 0}
            startIcon={simpleFixApplying ? <CircularProgress size={16} color="inherit" /> : <AutoFixHigh />}
          >
            {simpleFixApplying ? 'Applying…' : 'Apply Fix'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Duplicate Review Dialog ───────────────────────────────────────── */}
      <Dialog
        open={!!reviewDialog}
        onClose={() => !resolving && setReviewDialog(null)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { minHeight: '60vh' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FindReplace color="warning" />
            <Typography variant="h6">Review Duplicates — {reviewDialog?.label}</Typography>
          </Box>
          <IconButton size="small" onClick={() => setReviewDialog(null)} disabled={resolving}>
            <Close />
          </IconButton>
        </DialogTitle>
        {resolving && <LinearProgress />}
        <DialogContent dividers>
          {dupGroupsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          )}
          {!dupGroupsLoading && dupGroups.length === 0 && (
            <Alert severity="success">No duplicate groups found.</Alert>
          )}
          {!dupGroupsLoading && dupGroups.length > 0 && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {dupGroups.length} duplicate group{dupGroups.length !== 1 ? 's' : ''} found.
                  Select which record to <strong>keep</strong> in each group. All others will be deleted.
                </Typography>
                <Button size="small" variant="outlined" onClick={handleSelectAllOldest}>
                  Select Oldest in All Groups
                </Button>
              </Box>
              {dupGroups.map((group) => {
                const deleteCount = group.records.filter(r => r.id !== keeperMap[group.key]).length;
                return (
                  <Accordion key={group.key} defaultExpanded={dupGroups.length <= 20} sx={{ mb: 0.5 }}>
                    <AccordionSummary expandIcon={<ExpandMore />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1 }}>
                          {group.keyLabel}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${group.records.length} records — deleting ${deleteCount}`}
                          color={deleteCount > 0 ? 'error' : 'default'}
                          variant="outlined"
                        />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ p: 0 }}>
                      <RadioGroup
                        value={keeperMap[group.key] || ''}
                        onChange={(e) => setKeeperMap(prev => ({ ...prev, [group.key]: e.target.value }))}
                      >
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={{ backgroundColor: '#fafafa' }}>
                              <TableCell padding="checkbox"><strong>Keep</strong></TableCell>
                              <TableCell><strong>Name / ID</strong></TableCell>
                              <TableCell><strong>Created</strong></TableCell>
                              <TableCell><strong>Modified</strong></TableCell>
                              {group.records[0]?.fields && Object.keys(group.records[0].fields)
                                .filter(f => f !== 'Name' && f !== 'CreatedDate' && f !== 'LastModifiedDate')
                                .map(f => (
                                  <TableCell key={f}><strong>{f.replace(/^vlocity_cmt__/, '').replace(/__c$/, '')}</strong></TableCell>
                                ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {group.records.map((rec, ri) => {
                              const isKeeper = keeperMap[group.key] === rec.id;
                              return (
                                <TableRow
                                  key={rec.id}
                                  sx={{
                                    backgroundColor: isKeeper ? '#f1f8e9' : ri > 0 ? '#fff8f8' : undefined,
                                    '&:hover': { backgroundColor: isKeeper ? '#dcedc8' : '#ffebee' },
                                  }}
                                >
                                  <TableCell padding="checkbox">
                                    <FormControlLabel
                                      value={rec.id}
                                      control={<Radio size="small" />}
                                      label=""
                                      sx={{ m: 0 }}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Box>
                                      <Typography variant="body2" sx={{ fontWeight: isKeeper ? 600 : 400 }}>
                                        {rec.name}
                                      </Typography>
                                      {instanceUrl ? (
                                        <a href={`${instanceUrl}/${rec.id}`} target="_blank" rel="noopener noreferrer"
                                          style={{ fontSize: '11px', color: '#1976d2', fontFamily: 'monospace' }}>
                                          {rec.id}
                                        </a>
                                      ) : (
                                        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                                          {rec.id}
                                        </Typography>
                                      )}
                                    </Box>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption">
                                      {rec.createdDate ? new Date(rec.createdDate).toLocaleString() : '—'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption">
                                      {rec.lastModifiedDate ? new Date(rec.lastModifiedDate).toLocaleString() : '—'}
                                    </Typography>
                                  </TableCell>
                                  {Object.entries(rec.fields || {})
                                    .filter(([f]) => f !== 'Name' && f !== 'CreatedDate' && f !== 'LastModifiedDate')
                                    .map(([f, v]) => (
                                      <TableCell key={f}>
                                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                          {v == null ? '—' : String(v)}
                                        </Typography>
                                      </TableCell>
                                    ))}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </RadioGroup>
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
          <Box>
            {dupGroups.length > 0 && (() => {
              const totalDelete = dupGroups.reduce((sum, g) => {
                return sum + g.records.filter(r => r.id !== keeperMap[g.key]).length;
              }, 0);
              return (
                <Chip
                  icon={<Error />}
                  label={`Will delete ${totalDelete} record${totalDelete !== 1 ? 's' : ''}`}
                  color={totalDelete > 0 ? 'error' : 'default'}
                  variant="outlined"
                />
              );
            })()}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={() => setReviewDialog(null)} disabled={resolving}>Cancel</Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleResolve}
              disabled={resolving || dupGroups.length === 0}
              startIcon={resolving ? <CircularProgress size={16} color="inherit" /> : <FindReplace />}
            >
              {resolving ? 'Deleting…' : 'Delete Selected'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* ── Fix Result Snackbar ───────────────────────────────────────────── */}
      <Snackbar
        open={!!fixSnackbar}
        autoHideDuration={5000}
        onClose={() => setFixSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {fixSnackbar && (
          <Alert onClose={() => setFixSnackbar(null)} severity={fixSnackbar.severity} variant="filled" sx={{ minWidth: 300 }}>
            {fixSnackbar.message}
          </Alert>
        )}
      </Snackbar>
    </Box>
  );
}

export default ValidationDashboard;
