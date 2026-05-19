import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Button,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
  IconButton,
  Tooltip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
} from '@mui/material';
import {
  ExpandMore,
  Error,
  Warning,
  Info,
  AutoFixHigh,
  Edit,
  Download,
  ContentCopy,
  CheckCircle,
} from '@mui/icons-material';
import axios from 'axios';

/**
 * Enhanced Error Analysis Panel
 * Provides deep analysis of validation errors with value extraction and fixing capabilities
 */
const ErrorAnalysisPanel = ({ error, onFix, onAutoFix, orgUsername, orgType = 'source' }) => {
  const [expanded, setExpanded] = useState(false);
  const [fixDialogOpen, setFixDialogOpen] = useState(false);
  const [autoFixDialogOpen, setAutoFixDialogOpen] = useState(false);
  const [selectedFix, setSelectedFix] = useState(null);
  const [fixValues, setFixValues] = useState({});
  const [currentTab, setCurrentTab] = useState(0);
  const [extractedValues, setExtractedValues] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Extract values from error message
  const analyzeError = useMemo(() => {
    if (!error) return null;

    const analysis = {
      errorType: 'unknown',
      category: 'unknown',
      severity: 'error',
      extractedValues: {},
      rootCause: null,
      suggestedFixes: [],
      affectedObjects: [],
      missingFields: [],
      invalidValues: [],
      relationships: [],
    };

    const message = error.message || error.error || '';
    const details = error.details || {};

    // Extract error type
    if (message.includes('INVALID_TYPE') || message.includes('not supported')) {
      analysis.errorType = 'INVALID_TYPE';
      analysis.category = 'Object Not Available';
      analysis.severity = 'warning';
      analysis.rootCause = 'The Salesforce object is not available in this org. This may be normal for some org types.';
      analysis.suggestedFixes.push({
        type: 'skip',
        description: 'Skip validation for this object (recommended for custom objects)',
        action: 'skip_validation',
      });
    } else if (message.includes('INVALID_FIELD') || message.includes('No such column')) {
      analysis.errorType = 'INVALID_FIELD';
      analysis.category = 'Field Not Available';
      analysis.severity = 'error';
      analysis.rootCause = 'The field does not exist on the object. Check field API name or object configuration.';
      
      // Extract field name
      const fieldMatch = message.match(/column ['"]([^'"]+)['"]/i) || message.match(/field ['"]([^'"]+)['"]/i);
      if (fieldMatch) {
        analysis.extractedValues.fieldName = fieldMatch[1];
        analysis.missingFields.push(fieldMatch[1]);
      }
      
      // Extract object name
      const objectMatch = message.match(/entity ['"]([^'"]+)['"]/i) || message.match(/object ['"]([^'"]+)['"]/i);
      if (objectMatch) {
        analysis.extractedValues.objectName = objectMatch[1];
      }

      analysis.suggestedFixes.push({
        type: 'update_query',
        description: 'Update query to use correct field name',
        action: 'update_field_mapping',
        field: analysis.extractedValues.fieldName,
      });
    } else if (message.includes('Orphaned') || message.includes('missing parent') || message.includes('missing child')) {
      analysis.errorType = 'ORPHANED_RELATIONSHIP';
      analysis.category = 'Orphaned Relationship';
      analysis.severity = 'error';
      analysis.rootCause = 'A relationship references a record that does not exist.';
      
      // Extract relationship details
      if (details.relationships) {
        analysis.relationships = Array.isArray(details.relationships) ? details.relationships : [details.relationships];
      }
      
      if (details.parentId) analysis.extractedValues.parentId = details.parentId;
      if (details.childId) analysis.extractedValues.childId = details.childId;
      if (details.relationshipType) analysis.extractedValues.relationshipType = details.relationshipType;

      analysis.suggestedFixes.push({
        type: 'create_missing',
        description: 'Create missing parent/child record',
        action: 'create_related_record',
      });
      analysis.suggestedFixes.push({
        type: 'delete_orphan',
        description: 'Delete orphaned relationship',
        action: 'delete_relationship',
      });
    } else if (message.includes('missing PriceListEntry') || message.includes('missing PricingElement') || message.includes('missing PricingVariable')) {
      analysis.errorType = 'MISSING_PRICING_OBJECT';
      analysis.category = 'Missing Pricing Object';
      analysis.severity = 'error';
      analysis.rootCause = 'A product in the hierarchy is missing required pricing objects.';
      
      if (details.productId) analysis.extractedValues.productId = details.productId;
      if (details.productName) analysis.extractedValues.productName = details.productName;
      if (details.missingObjects) {
        analysis.missingFields = Array.isArray(details.missingObjects) ? details.missingObjects : [details.missingObjects];
      }

      analysis.suggestedFixes.push({
        type: 'create_pricing',
        description: 'Create missing pricing objects',
        action: 'create_pricing_objects',
      });
    } else if (message.includes('401') || message.includes('Unauthorized')) {
      analysis.errorType = 'AUTH_ERROR';
      analysis.category = 'Authentication Error';
      analysis.severity = 'error';
      analysis.rootCause = 'Your Salesforce session has expired or credentials are invalid.';
      analysis.suggestedFixes.push({
        type: 'reauthenticate',
        description: 'Re-authenticate with Salesforce',
        action: 'reauthenticate',
      });
    } else if (message.includes('duplicate') || message.includes('already exists')) {
      analysis.errorType = 'DUPLICATE';
      analysis.category = 'Duplicate Record';
      analysis.severity = 'warning';
      analysis.rootCause = 'A record with the same unique identifier already exists.';
      
      if (details.existingId) analysis.extractedValues.existingId = details.existingId;
      if (details.duplicateField) analysis.extractedValues.duplicateField = details.duplicateField;

      analysis.suggestedFixes.push({
        type: 'update_existing',
        description: 'Update existing record instead',
        action: 'update_record',
      });
      analysis.suggestedFixes.push({
        type: 'delete_duplicate',
        description: 'Delete duplicate record',
        action: 'delete_duplicate',
      });
    }

    // Extract IDs from message
    const idMatches = message.match(/([a-zA-Z0-9]{15,18})/g);
    if (idMatches) {
      analysis.extractedValues.recordIds = [...new Set(idMatches)];
    }

    // Extract object names
    const objectMatches = message.match(/([a-zA-Z_][a-zA-Z0-9_]*__c)/g);
    if (objectMatches) {
      analysis.extractedValues.objectNames = [...new Set(objectMatches)];
    }

    return analysis;
  }, [error]);

  const handleExtractValues = async () => {
    if (!error || !orgUsername) return;
    
    setAnalyzing(true);
    try {
      // Call backend to extract detailed values from Salesforce
      const response = await axios.post('/api/validation/extract-error-values', {
        error: error,
        orgUsername: orgUsername,
        orgType: orgType,
      });
      
      setExtractedValues(response.data.extractedValues || {});
    } catch (err) {
      console.error('Failed to extract values:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAutoFix = async (fix) => {
    if (!fix || !orgUsername) return;
    
    try {
      const response = await axios.post('/api/validation/auto-fix', {
        error: error,
        fix: fix,
        orgUsername: orgUsername,
        orgType: orgType,
      });
      
      if (response.data.success) {
        if (onAutoFix) onAutoFix(response.data);
        setAutoFixDialogOpen(false);
      }
    } catch (err) {
      console.error('Auto-fix failed:', err);
    }
  };

  const handleManualFix = async () => {
    if (!selectedFix || !orgUsername) return;
    
    try {
      const response = await axios.post('/api/validation/manual-fix', {
        error: error,
        fix: selectedFix,
        values: fixValues,
        orgUsername: orgUsername,
        orgType: orgType,
      });
      
      if (response.data.success) {
        if (onFix) onFix(response.data);
        setFixDialogOpen(false);
      }
    } catch (err) {
      console.error('Manual fix failed:', err);
    }
  };

  if (!error || !analyzeError) return null;

  return (
    <Accordion expanded={expanded} onChange={(e, isExpanded) => setExpanded(isExpanded)}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
          {analyzeError.severity === 'error' ? <Error color="error" /> : <Warning color="warning" />}
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle1">
              {analyzeError.category} - {analyzeError.errorType}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {error.message || error.error || 'Unknown error'}
            </Typography>
          </Box>
          <Chip
            label={analyzeError.severity.toUpperCase()}
            color={analyzeError.severity === 'error' ? 'error' : 'warning'}
            size="small"
          />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Tabs value={currentTab} onChange={(e, v) => setCurrentTab(v)} sx={{ mb: 2 }}>
          <Tab label="Analysis" />
          <Tab label="Extracted Values" />
          <Tab label="Fix Options" />
        </Tabs>

        {currentTab === 0 && (
          <Box>
            <Alert severity={analyzeError.severity} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                <strong>Root Cause:</strong>
              </Typography>
              <Typography variant="body2">
                {analyzeError.rootCause || 'Unable to determine root cause.'}
              </Typography>
            </Alert>

            {analyzeError.affectedObjects.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Affected Objects:
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {analyzeError.affectedObjects.map((obj, idx) => (
                    <Chip key={idx} label={obj} size="small" />
                  ))}
                </Box>
              </Box>
            )}

            {analyzeError.missingFields.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Missing Fields/Objects:
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {analyzeError.missingFields.map((field, idx) => (
                    <Chip key={idx} label={field} size="small" color="error" />
                  ))}
                </Box>
              </Box>
            )}

            {analyzeError.relationships.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Relationship Issues:
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Parent ID</TableCell>
                        <TableCell>Child ID</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analyzeError.relationships.map((rel, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{rel.parentId || 'N/A'}</TableCell>
                          <TableCell>{rel.childId || 'N/A'}</TableCell>
                          <TableCell>{rel.type || 'N/A'}</TableCell>
                          <TableCell>
                            <Chip label="Orphaned" size="small" color="error" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        )}

        {currentTab === 1 && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="subtitle1">Extracted Values</Typography>
              <Button
                size="small"
                startIcon={<Download />}
                onClick={handleExtractValues}
                disabled={analyzing || !orgUsername}
              >
                {analyzing ? 'Extracting...' : 'Extract from Salesforce'}
              </Button>
            </Box>

            {extractedValues && Object.keys(extractedValues).length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Field</TableCell>
                      <TableCell>Value</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(extractedValues).map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell>
                          <strong>{key}</strong>
                        </TableCell>
                        <TableCell>
                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                        </TableCell>
                        <TableCell>
                          <Tooltip title="Copy value">
                            <IconButton
                              size="small"
                              onClick={() => navigator.clipboard.writeText(String(value))}
                            >
                              <ContentCopy fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">
                Click "Extract from Salesforce" to retrieve detailed values from the org.
              </Alert>
            )}

            {analyzeError.extractedValues && Object.keys(analyzeError.extractedValues).length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Values Extracted from Error Message:
                </Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
                  <Table size="small">
                    <TableBody>
                      {Object.entries(analyzeError.extractedValues).map(([key, value]) => (
                        <TableRow key={key}>
                          <TableCell>
                            <strong>{key}</strong>
                          </TableCell>
                          <TableCell>
                            {Array.isArray(value) ? value.join(', ') : String(value)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        )}

        {currentTab === 2 && (
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Suggested Fixes
            </Typography>

            {analyzeError.suggestedFixes.length > 0 ? (
              <Grid container spacing={2} sx={{ mt: 1 }}>
                {analyzeError.suggestedFixes.map((fix, idx) => (
                  <Grid item xs={12} key={idx}>
                    <Card variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          <Box sx={{ flexGrow: 1 }}>
                            <Typography variant="subtitle2" gutterBottom>
                              {fix.description}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Type: {fix.type} | Action: {fix.action}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            {fix.type === 'skip' || fix.type === 'reauthenticate' ? (
                              <Tooltip title="This fix will be applied automatically">
                                <Chip
                                  icon={<Info />}
                                  label="Auto"
                                  size="small"
                                  color="info"
                                />
                              </Tooltip>
                            ) : (
                              <>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<AutoFixHigh />}
                                  onClick={() => {
                                    setSelectedFix(fix);
                                    setAutoFixDialogOpen(true);
                                  }}
                                  disabled={!orgUsername}
                                >
                                  Auto-Fix
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<Edit />}
                                  onClick={() => {
                                    setSelectedFix(fix);
                                    setFixDialogOpen(true);
                                  }}
                                  disabled={!orgUsername}
                                >
                                  Manual Fix
                                </Button>
                              </>
                            )}
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Alert severity="warning">
                No automatic fixes available for this error. Please review the error details and fix manually.
              </Alert>
            )}
          </Box>
        )}
      </AccordionDetails>

      {/* Auto-Fix Dialog */}
      <Dialog open={autoFixDialogOpen} onClose={() => setAutoFixDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoFixHigh color="primary" />
            Auto-Fix Error
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            The system will attempt to automatically fix this error using Vlocity/Salesforce CLI commands.
          </Alert>
          <Typography variant="body2" gutterBottom>
            <strong>Fix Type:</strong> {selectedFix?.type}
          </Typography>
          <Typography variant="body2" gutterBottom>
            <strong>Action:</strong> {selectedFix?.action}
          </Typography>
          <Typography variant="body2" sx={{ mt: 2 }}>
            <strong>Description:</strong> {selectedFix?.description}
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            This will make changes to the {orgType} environment ({orgUsername}). Are you sure?
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAutoFixDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AutoFixHigh />}
            onClick={() => handleAutoFix(selectedFix)}
          >
            Apply Auto-Fix
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manual Fix Dialog */}
      <Dialog open={fixDialogOpen} onClose={() => setFixDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Edit color="primary" />
            Manual Fix Error
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom sx={{ mb: 2 }}>
            <strong>Fix Type:</strong> {selectedFix?.type}
          </Typography>
          
          {selectedFix?.action === 'create_related_record' && (
            <Box>
              <TextField
                fullWidth
                label="Record Name"
                value={fixValues.name || ''}
                onChange={(e) => setFixValues({ ...fixValues, name: e.target.value })}
                sx={{ mb: 2 }}
              />
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Object Type</InputLabel>
                <Select
                  value={fixValues.objectType || ''}
                  label="Object Type"
                  onChange={(e) => setFixValues({ ...fixValues, objectType: e.target.value })}
                >
                  <MenuItem value="Product2">Product</MenuItem>
                  <MenuItem value="vlocity_cmt__PriceListEntry__c">Price List Entry</MenuItem>
                  <MenuItem value="vlocity_cmt__PricingElement__c">Pricing Element</MenuItem>
                  <MenuItem value="vlocity_cmt__PricingVariable__c">Pricing Variable</MenuItem>
                </Select>
              </FormControl>
            </Box>
          )}

          {selectedFix?.action === 'update_field_mapping' && (
            <TextField
              fullWidth
              label="New Field Name"
              value={fixValues.newFieldName || ''}
              onChange={(e) => setFixValues({ ...fixValues, newFieldName: e.target.value })}
              helperText="Enter the correct field API name"
              sx={{ mb: 2 }}
            />
          )}

          <Alert severity="warning" sx={{ mt: 2 }}>
            Changes will be committed to {orgType} environment ({orgUsername}).
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFixDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<CheckCircle />}
            onClick={handleManualFix}
            disabled={!selectedFix}
          >
            Apply Fix & Commit
          </Button>
        </DialogActions>
      </Dialog>
    </Accordion>
  );
};

export default ErrorAnalysisPanel;

