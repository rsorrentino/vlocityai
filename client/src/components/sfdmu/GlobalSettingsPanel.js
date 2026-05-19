import React from 'react';
import {
  Accordion, AccordionSummary, AccordionDetails, Typography,
  Stack, TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Switch, Grid,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';

const DEFAULT_SETTINGS = {
  simulationMode: false,
  allOrNone: false,
  concurrencyMode: 'Serial',
  bulkThreshold: 200,
  apiVersion: '',
  bulkApiVersion: '2.0',
  bulkApiV1BatchSize: 0,
  restApiBatchSize: 0,
  parallelBulkJobs: 1,
  parallelRestJobs: 1,
  csvReadFileDelimiter: ',',
  csvWriteFileDelimiter: ',',
  createTargetCSVFiles: false,
  importCSVFilesAsIs: false,
  excludeIdsFromCSVFiles: false,
  validateCSVFilesOnly: false,
  skipRecordsComparison: false,
  allowFieldTruncation: false,
  keepObjectOrderWhileExecute: false,
};

export { DEFAULT_SETTINGS };

const GlobalSettingsPanel = ({ settings, onChange }) => {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const set = (field, value) => onChange({ ...s, [field]: value });
  const toggle = (field) => set(field, !s[field]);
  const num = (field, value) => set(field, parseInt(value, 10) || 0);

  return (
    <>
      {/* ── Core ─────────────────────────────────────────────────────────── */}
      <Accordion variant="outlined" defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="subtitle2" fontWeight={600}>Core Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <FormControlLabel
                control={<Switch checked={s.simulationMode} onChange={() => toggle('simulationMode')} />}
                label="Simulation mode (dry run)"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControlLabel
                control={<Switch checked={s.allOrNone} onChange={() => toggle('allOrNone')} />}
                label="All or none (rollback on error)"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl size="small" fullWidth>
                <InputLabel>Concurrency Mode</InputLabel>
                <Select value={s.concurrencyMode} label="Concurrency Mode"
                  onChange={e => set('concurrencyMode', e.target.value)}>
                  <MenuItem value="Serial">Serial</MenuItem>
                  <MenuItem value="Parallel">Parallel</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField size="small" fullWidth label="Bulk API Threshold" type="number"
                value={s.bulkThreshold}
                onChange={e => num('bulkThreshold', e.target.value)}
                helperText="Records above this use Bulk API" />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* ── API & Batch ───────────────────────────────────────────────────── */}
      <Accordion variant="outlined">
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="subtitle2" fontWeight={600}>API &amp; Batch Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <TextField size="small" fullWidth label="API Version"
                placeholder="e.g. 59.0"
                value={s.apiVersion}
                onChange={e => set('apiVersion', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl size="small" fullWidth>
                <InputLabel>Bulk API Version</InputLabel>
                <Select value={s.bulkApiVersion || '2.0'} label="Bulk API Version"
                  onChange={e => set('bulkApiVersion', e.target.value)}>
                  <MenuItem value="1.0">1.0</MenuItem>
                  <MenuItem value="2.0">2.0</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField size="small" fullWidth label="Bulk API v1 Batch Size" type="number"
                value={s.bulkApiV1BatchSize || ''}
                placeholder="Default: 9500"
                onChange={e => num('bulkApiV1BatchSize', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField size="small" fullWidth label="REST API Batch Size" type="number"
                value={s.restApiBatchSize || ''}
                placeholder="Default: 9500"
                onChange={e => num('restApiBatchSize', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField size="small" fullWidth label="Parallel Bulk Jobs" type="number"
                value={s.parallelBulkJobs}
                onChange={e => num('parallelBulkJobs', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField size="small" fullWidth label="Parallel REST Jobs" type="number"
                value={s.parallelRestJobs}
                onChange={e => num('parallelRestJobs', e.target.value)} />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* ── CSV ──────────────────────────────────────────────────────────── */}
      <Accordion variant="outlined">
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="subtitle2" fontWeight={600}>CSV Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl size="small" fullWidth>
                <InputLabel>Read Delimiter</InputLabel>
                <Select value={s.csvReadFileDelimiter || ','} label="Read Delimiter"
                  onChange={e => set('csvReadFileDelimiter', e.target.value)}>
                  <MenuItem value=",">, (comma)</MenuItem>
                  <MenuItem value=";">; (semicolon)</MenuItem>
                  <MenuItem value="\t">Tab</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl size="small" fullWidth>
                <InputLabel>Write Delimiter</InputLabel>
                <Select value={s.csvWriteFileDelimiter || ','} label="Write Delimiter"
                  onChange={e => set('csvWriteFileDelimiter', e.target.value)}>
                  <MenuItem value=",">, (comma)</MenuItem>
                  <MenuItem value=";">; (semicolon)</MenuItem>
                  <MenuItem value="\t">Tab</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Stack spacing={1}>
                <FormControlLabel
                  control={<Switch size="small" checked={s.createTargetCSVFiles} onChange={() => toggle('createTargetCSVFiles')} />}
                  label={<Typography variant="body2">Create target CSV files</Typography>}
                />
                <FormControlLabel
                  control={<Switch size="small" checked={s.importCSVFilesAsIs} onChange={() => toggle('importCSVFilesAsIs')} />}
                  label={<Typography variant="body2">Import CSV as-is (skip validation)</Typography>}
                />
              </Stack>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Stack spacing={1}>
                <FormControlLabel
                  control={<Switch size="small" checked={s.excludeIdsFromCSVFiles} onChange={() => toggle('excludeIdsFromCSVFiles')} />}
                  label={<Typography variant="body2">Exclude IDs from CSV</Typography>}
                />
                <FormControlLabel
                  control={<Switch size="small" checked={s.validateCSVFilesOnly} onChange={() => toggle('validateCSVFilesOnly')} />}
                  label={<Typography variant="body2">Validate CSV only (no run)</Typography>}
                />
              </Stack>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* ── Behavior ─────────────────────────────────────────────────────── */}
      <Accordion variant="outlined">
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="subtitle2" fontWeight={600}>Behavior</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} flexWrap="wrap">
            <FormControlLabel
              control={<Switch checked={s.skipRecordsComparison} onChange={() => toggle('skipRecordsComparison')} />}
              label="Skip records comparison (faster)"
            />
            <FormControlLabel
              control={<Switch checked={s.allowFieldTruncation} onChange={() => toggle('allowFieldTruncation')} />}
              label="Allow field truncation"
            />
            <FormControlLabel
              control={<Switch checked={s.keepObjectOrderWhileExecute} onChange={() => toggle('keepObjectOrderWhileExecute')} />}
              label="Keep object order during execution"
            />
          </Stack>
        </AccordionDetails>
      </Accordion>
    </>
  );
};

export default GlobalSettingsPanel;
