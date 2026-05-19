import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Switch, Tabs, Tab, Box, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Chip, Typography, Stack, Grid,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';

const OPERATIONS = ['Upsert', 'Insert', 'Update', 'Delete', 'Readonly', 'DeleteSource', 'DeleteHierarchy', 'HardDelete'];

const MOCK_PATTERNS = [
  { value: 'string_mask', label: 'String mask (randomise text)' },
  { value: 'email_mask', label: 'Email mask' },
  { value: 'phone_mask', label: 'Phone mask' },
  { value: 'credit_card_mask', label: 'Credit card mask' },
  { value: 'random_string', label: 'Random string' },
  { value: 'static_value', label: 'Static value (replace with constant)' },
  { value: 'custom_regex', label: 'Custom regex pattern' },
];

const DEFAULT_OBJECT = {
  sObjectType: '',
  operation: 'Upsert',
  externalId: 'Name',
  query: '',
  // Advanced query
  orderBy: '',
  limit: 0,
  offset: 0,
  useQueryAll: false,
  // Operation
  deleteOldData: false,
  deleteQuery: '',
  skipExistingRecords: false,
  // Field control
  excludedFields: [],
  excludedFromUpdateFields: [],
  // Field mapping
  useFieldMapping: false,
  fieldMapping: [],
  // Anonymization
  updateWithMockData: false,
  mockFields: [],
};

export { DEFAULT_OBJECT };

function TabPanel({ children, value, index }) {
  return (
    <Box role="tabpanel" hidden={value !== index} sx={{ pt: 2 }}>
      {value === index && children}
    </Box>
  );
}

// Chips input for comma-separated field lists
function ChipsInput({ label, value = [], onChange }) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput('');
  };

  const remove = (chip) => onChange(value.filter(v => v !== chip));

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>{label}</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
        {value.map(chip => (
          <Chip key={chip} label={chip} size="small" onDelete={() => remove(chip)} sx={{ mb: 0.5 }} />
        ))}
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          placeholder="Field API name"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          sx={{ flex: 1 }}
        />
        <Button size="small" variant="outlined" onClick={add} disabled={!input.trim()}>Add</Button>
      </Stack>
    </Box>
  );
}

const SfdmuObjectDialog = ({ open, object: objectProp, onSave, onClose }) => {
  const [obj, setObj] = useState({ ...DEFAULT_OBJECT });
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (open) {
      setObj({ ...DEFAULT_OBJECT, ...(objectProp || {}) });
      setTab(0);
    }
  }, [open, objectProp]);

  const set = (field, value) => setObj(prev => ({ ...prev, [field]: value }));
  const toggle = (field) => setObj(prev => ({ ...prev, [field]: !prev[field] }));

  const handleSave = () => {
    if (!obj.sObjectType.trim() && !obj.query.trim()) return;
    onSave({ ...obj });
  };

  // Field mapping rows
  const addMapping = () => set('fieldMapping', [...obj.fieldMapping, { sourceField: '', targetField: '' }]);
  const updateMapping = (i, field, val) =>
    set('fieldMapping', obj.fieldMapping.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  const removeMapping = (i) => set('fieldMapping', obj.fieldMapping.filter((_, idx) => idx !== i));

  // Mock field rows
  const addMock = () => set('mockFields', [...obj.mockFields, { name: '', pattern: 'string_mask', excludedRegex: '', includedRegex: '' }]);
  const updateMock = (i, field, val) =>
    set('mockFields', obj.mockFields.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  const removeMock = (i) => set('mockFields', obj.mockFields.filter((_, idx) => idx !== i));

  const isExternalIdDisabled = ['Insert', 'Delete', 'HardDelete', 'DeleteSource', 'DeleteHierarchy'].includes(obj.operation);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {objectProp ? `Edit: ${objectProp.sObjectType || 'Object'}` : 'Add Object'}
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tab label="Basic" />
          <Tab label="Advanced" />
          <Tab label={`Field Mapping${obj.fieldMapping?.length ? ` (${obj.fieldMapping.length})` : ''}`} />
          <Tab label={`Anonymization${obj.mockFields?.length ? ` (${obj.mockFields.length})` : ''}`} />
        </Tabs>

        <Box sx={{ px: 3, pb: 2 }}>
          {/* ── Tab 0: Basic ─────────────────────────────────────────────── */}
          <TabPanel value={tab} index={0}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  size="small" fullWidth required label="sObject API Name"
                  placeholder="e.g. Account"
                  value={obj.sObjectType}
                  onChange={e => set('sObjectType', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Operation</InputLabel>
                  <Select value={obj.operation} label="Operation"
                    onChange={e => set('operation', e.target.value)}>
                    {OPERATIONS.map(op => <MenuItem key={op} value={op}>{op}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  size="small" fullWidth label="External ID"
                  placeholder="Name"
                  value={obj.externalId}
                  onChange={e => set('externalId', e.target.value)}
                  disabled={isExternalIdDisabled}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  size="small" fullWidth multiline rows={4}
                  label="SOQL Query (optional — overrides sObject name)"
                  placeholder={'SELECT Id, Name, IsActive FROM Account WHERE IsActive = true'}
                  value={obj.query}
                  onChange={e => set('query', e.target.value)}
                  helperText="Leave empty to auto-generate SELECT ALL FROM {sObjectType}"
                />
              </Grid>
            </Grid>
          </TabPanel>

          {/* ── Tab 1: Advanced ──────────────────────────────────────────── */}
          <TabPanel value={tab} index={1}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>Query Options</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField size="small" fullWidth label="ORDER BY"
                  placeholder="e.g. Name ASC"
                  value={obj.orderBy}
                  onChange={e => set('orderBy', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField size="small" fullWidth label="LIMIT" type="number"
                  value={obj.limit || ''}
                  placeholder="0 = no limit"
                  onChange={e => set('limit', parseInt(e.target.value, 10) || 0)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField size="small" fullWidth label="OFFSET" type="number"
                  value={obj.offset || ''}
                  onChange={e => set('offset', parseInt(e.target.value, 10) || 0)} />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch size="small" checked={obj.useQueryAll} onChange={() => toggle('useQueryAll')} />}
                  label={<Typography variant="body2">Use queryAll (include deleted/archived records)</Typography>}
                />
              </Grid>

              <Grid item xs={12} sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>Operation Options</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControlLabel
                  control={<Switch size="small" checked={obj.deleteOldData} onChange={() => toggle('deleteOldData')} />}
                  label={<Typography variant="body2">Delete old target data before insert</Typography>}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControlLabel
                  control={<Switch size="small" checked={obj.skipExistingRecords} onChange={() => toggle('skipExistingRecords')} />}
                  label={<Typography variant="body2">Skip existing records</Typography>}
                />
              </Grid>
              {obj.deleteOldData && (
                <Grid item xs={12}>
                  <TextField size="small" fullWidth label="Delete Query (optional)"
                    placeholder="SOQL for records to delete — leave empty to delete all"
                    value={obj.deleteQuery}
                    onChange={e => set('deleteQuery', e.target.value)} />
                </Grid>
              )}

              <Grid item xs={12} sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>Field Control</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <ChipsInput
                  label="Excluded Fields (skip during migration)"
                  value={obj.excludedFields}
                  onChange={v => set('excludedFields', v)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <ChipsInput
                  label="Excluded from Update Fields (query but don't write)"
                  value={obj.excludedFromUpdateFields}
                  onChange={v => set('excludedFromUpdateFields', v)}
                />
              </Grid>
            </Grid>
          </TabPanel>

          {/* ── Tab 2: Field Mapping ─────────────────────────────────────── */}
          <TabPanel value={tab} index={2}>
            <Stack spacing={2}>
              <FormControlLabel
                control={<Switch checked={obj.useFieldMapping} onChange={() => toggle('useFieldMapping')} />}
                label="Enable field mapping (map source fields to differently-named target fields)"
              />

              {obj.useFieldMapping && (
                <>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: 'grey.50' }}>
                          <TableCell sx={{ fontWeight: 600 }}>Source Field</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Target Field</TableCell>
                          <TableCell sx={{ width: 48 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {obj.fieldMapping.map((m, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <TextField size="small" fullWidth placeholder="SourceField__c"
                                value={m.sourceField}
                                onChange={e => updateMapping(i, 'sourceField', e.target.value)} />
                            </TableCell>
                            <TableCell>
                              <TextField size="small" fullWidth placeholder="TargetField__c"
                                value={m.targetField}
                                onChange={e => updateMapping(i, 'targetField', e.target.value)} />
                            </TableCell>
                            <TableCell>
                              <Tooltip title="Remove">
                                <IconButton size="small" color="error" onClick={() => removeMapping(i)}>
                                  <Delete fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                        {obj.fieldMapping.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} align="center">
                              <Typography variant="caption" color="text.secondary">No mappings yet. Click Add to create one.</Typography>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Box>
                    <Button size="small" startIcon={<Add />} onClick={addMapping} variant="outlined">
                      Add Mapping
                    </Button>
                  </Box>
                </>
              )}
            </Stack>
          </TabPanel>

          {/* ── Tab 3: Anonymization ─────────────────────────────────────── */}
          <TabPanel value={tab} index={3}>
            <Stack spacing={2}>
              <FormControlLabel
                control={<Switch checked={obj.updateWithMockData} onChange={() => toggle('updateWithMockData')} />}
                label="Enable data anonymization (replace field values with mock data)"
              />

              {obj.updateWithMockData && (
                <>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: 'grey.50' }}>
                          <TableCell sx={{ fontWeight: 600 }}>Field API Name</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Pattern</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Exclude if matches (regex)</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Include only if matches (regex)</TableCell>
                          <TableCell sx={{ width: 48 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {obj.mockFields.map((m, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <TextField size="small" fullWidth placeholder="Email"
                                value={m.name}
                                onChange={e => updateMock(i, 'name', e.target.value)} />
                            </TableCell>
                            <TableCell>
                              <FormControl size="small" sx={{ minWidth: 180 }}>
                                <Select value={m.pattern || 'string_mask'}
                                  onChange={e => updateMock(i, 'pattern', e.target.value)}>
                                  {MOCK_PATTERNS.map(p => (
                                    <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </TableCell>
                            <TableCell>
                              <TextField size="small" fullWidth placeholder="^admin"
                                value={m.excludedRegex || ''}
                                onChange={e => updateMock(i, 'excludedRegex', e.target.value)} />
                            </TableCell>
                            <TableCell>
                              <TextField size="small" fullWidth placeholder="@company.com"
                                value={m.includedRegex || ''}
                                onChange={e => updateMock(i, 'includedRegex', e.target.value)} />
                            </TableCell>
                            <TableCell>
                              <Tooltip title="Remove">
                                <IconButton size="small" color="error" onClick={() => removeMock(i)}>
                                  <Delete fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                        {obj.mockFields.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} align="center">
                              <Typography variant="caption" color="text.secondary">No mock fields yet. Click Add to create one.</Typography>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Box>
                    <Button size="small" startIcon={<Add />} onClick={addMock} variant="outlined">
                      Add Mock Field
                    </Button>
                  </Box>
                </>
              )}
            </Stack>
          </TabPanel>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!obj.sObjectType.trim() && !obj.query.trim()}
        >
          {objectProp ? 'Update' : 'Add Object'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SfdmuObjectDialog;
