import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stepper,
  Step,
  StepLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  Checkbox,
  FormControlLabel,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Save,
  Cancel,
  Add,
  Delete,
  Edit,
  CheckCircle,
  Warning,
  Info,
  Visibility,
  Build,
} from '@mui/icons-material';
import axios from 'axios';

/**
 * Pricing Object Editor Component
 * Allows editing of pricelists, pricing elements, pricing variables, and promotions
 * with data integrity validation and commit to source/target environments
 */
const PricingObjectEditor = ({ 
  objectType, 
  objectId, 
  orgUsername, 
  orgType = 'source',
  onSave,
  onCancel 
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [objectData, setObjectData] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentTab, setCurrentTab] = useState(0);
  const [requiredFields, setRequiredFields] = useState([]);
  const [relatedObjects, setRelatedObjects] = useState([]);

  const objectTypes = {
    'PriceList': {
      label: 'Price List',
      apiName: 'vlocity_cmt__PriceList__c',
      requiredFields: ['Name', 'vlocity_cmt__IsActive__c'],
      relatedObjects: ['PriceListEntry', 'PricingPlan'],
    },
    'PriceListEntry': {
      label: 'Price List Entry',
      apiName: 'vlocity_cmt__PriceListEntry__c',
      requiredFields: ['vlocity_cmt__PriceListId__c', 'vlocity_cmt__ProductId__c', 'vlocity_cmt__Price__c'],
      relatedObjects: ['Product', 'PriceList'],
    },
    'PricingElement': {
      label: 'Pricing Element',
      apiName: 'vlocity_cmt__PricingElement__c',
      requiredFields: ['Name', 'vlocity_cmt__PricingVariableId__c'],
      relatedObjects: ['PricingVariable', 'PricingPlan'],
    },
    'PricingVariable': {
      label: 'Pricing Variable',
      apiName: 'vlocity_cmt__PricingVariable__c',
      requiredFields: ['Name', 'vlocity_cmt__Code__c'],
      relatedObjects: ['PricingElement'],
    },
    'Promotion': {
      label: 'Promotion',
      apiName: 'vlocity_cmt__Promotion__c',
      requiredFields: ['Name', 'vlocity_cmt__IsActive__c'],
      relatedObjects: ['PromotionRule', 'PriceList'],
    },
  };

  const steps = ['Load Object', 'Edit Data', 'Validate', 'Review & Commit'];

  useEffect(() => {
    if (objectType && objectId && orgUsername) {
      loadObject();
    }
  }, [objectType, objectId, orgUsername]);

  const loadObject = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`/api/pricing/objects/${objectType}/${objectId}`, {
        params: { username: orgUsername }
      });
      
      const data = response.data.object || response.data;
      setObjectData(data);
      setEditedData({ ...data });
      setRequiredFields(objectTypes[objectType]?.requiredFields || []);
      setCurrentStep(1);
    } catch (err) {
      setError(`Failed to load ${objectType}: ${err.response?.data?.error?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const validateData = async () => {
    if (!editedData || !orgUsername) return;

    setLoading(true);
    setValidationErrors([]);
    setValidationWarnings([]);

    try {
      const response = await axios.post('/api/pricing/validate-object', {
        objectType,
        objectData: editedData,
        orgUsername,
        orgType,
      });

      const validation = response.data.validation || {};
      setValidationErrors(validation.errors || []);
      setValidationWarnings(validation.warnings || []);

      if (validation.errors.length === 0) {
        setCurrentStep(3); // Move to review step
      } else {
        setCurrentStep(2); // Stay on validation step
      }
    } catch (err) {
      setError(`Validation failed: ${err.response?.data?.error?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const createRelatedObjects = async () => {
    if (!editedData || !orgUsername) return;

    setLoading(true);
    try {
      const response = await axios.post('/api/pricing/create-related-objects', {
        objectType,
        objectData: editedData,
        orgUsername,
        orgType,
      });

      if (response.data.success) {
        setSuccess(`Created ${response.data.createdCount || 0} related objects`);
        return response.data;
      }
    } catch (err) {
      setError(`Failed to create related objects: ${err.response?.data?.error?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editedData || !orgUsername) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // First validate
      await validateData();
      if (validationErrors.length > 0) {
        setSaving(false);
        return;
      }

      // Create related objects if needed
      if (validationWarnings.some(w => w.type === 'missing_related')) {
        await createRelatedObjects();
      }

      // Save the object
      const response = await axios.post('/api/pricing/save-object', {
        objectType,
        objectId,
        objectData: editedData,
        orgUsername,
        orgType,
        commit: true, // Commit changes to Salesforce
      });

      if (response.data.success) {
        setSuccess(`Successfully saved and committed ${objectType} to ${orgType} environment`);
        if (onSave) {
          onSave(response.data);
        }
        setTimeout(() => {
          if (onCancel) onCancel();
        }, 2000);
      }
    } catch (err) {
      setError(`Failed to save: ${err.response?.data?.error?.message || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (field, value) => {
    setEditedData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const renderEditForm = () => {
    if (!editedData || !objectTypes[objectType]) return null;

    const fields = Object.keys(editedData).filter(key => 
      !key.startsWith('attributes') && 
      key !== 'Id' && 
      typeof editedData[key] !== 'object'
    );

    return (
      <Grid container spacing={2}>
        {fields.map(field => {
          const isRequired = requiredFields.includes(field);
          const value = editedData[field];
          
          return (
            <Grid item xs={12} sm={6} key={field}>
              <TextField
                fullWidth
                label={field}
                value={value || ''}
                onChange={(e) => handleFieldChange(field, e.target.value)}
                required={isRequired}
                error={isRequired && !value}
                helperText={isRequired && !value ? 'This field is required' : ''}
                type={typeof value === 'number' ? 'number' : 'text'}
              />
            </Grid>
          );
        })}
      </Grid>
    );
  };

  if (loading && !objectData) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading {objectType}...</Typography>
      </Box>
    );
  }

  return (
    <Dialog open={true} onClose={onCancel} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Edit color="primary" />
          Edit {objectTypes[objectType]?.label || objectType}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Stepper activeStep={currentStep}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>

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

        <Tabs value={currentTab} onChange={(e, v) => setCurrentTab(v)} sx={{ mb: 2 }}>
          <Tab label="Edit" />
          <Tab label="Validation" />
          <Tab label="Related Objects" />
        </Tabs>

        {currentTab === 0 && (
          <Box>
            {currentStep >= 1 && renderEditForm()}
            {currentStep === 0 && (
              <Alert severity="info">
                Click "Load Object" to start editing.
              </Alert>
            )}
          </Box>
        )}

        {currentTab === 1 && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="subtitle1">Data Validation</Typography>
              <Button
                variant="outlined"
                startIcon={<CheckCircle />}
                onClick={validateData}
                disabled={!editedData || loading}
              >
                Validate
              </Button>
            </Box>

            {validationErrors.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Validation Errors ({validationErrors.length})
                </Typography>
                <Box component="ul" sx={{ pl: 2, mb: 0 }}>
                  {validationErrors.map((err, idx) => (
                    <li key={idx}>
                      <Typography variant="body2">{err.message}</Typography>
                      {err.field && (
                        <Typography variant="caption" color="text.secondary">
                          Field: {err.field}
                        </Typography>
                      )}
                    </li>
                  ))}
                </Box>
              </Alert>
            )}

            {validationWarnings.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Warnings ({validationWarnings.length})
                </Typography>
                <Box component="ul" sx={{ pl: 2, mb: 0 }}>
                  {validationWarnings.map((warn, idx) => (
                    <li key={idx}>
                      <Typography variant="body2">{warn.message}</Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}

            {validationErrors.length === 0 && validationWarnings.length === 0 && currentStep >= 2 && (
              <Alert severity="success">
                All validations passed! Ready to commit.
              </Alert>
            )}
          </Box>
        )}

        {currentTab === 2 && (
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Related Objects
            </Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
              The system will automatically create or update related objects to ensure data integrity.
            </Alert>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Object Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(objectTypes[objectType]?.relatedObjects || []).map((relObj, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{relObj}</TableCell>
                      <TableCell>
                        <Chip label="Will be created/updated" size="small" color="info" />
                      </TableCell>
                      <TableCell>
                        <Tooltip title="System will ensure this object exists">
                          <Info fontSize="small" />
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {currentStep === 3 && (
          <Box sx={{ mt: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Ready to Commit
              </Typography>
              <Typography variant="body2">
                Changes will be committed to <strong>{orgType}</strong> environment ({orgUsername}).
                All required fields are set and related objects will be created automatically.
              </Typography>
            </Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {currentStep === 0 && (
          <Button onClick={loadObject} variant="outlined" disabled={loading}>
            Load Object
          </Button>
        )}
        {currentStep >= 1 && currentStep < 3 && (
          <Button
            onClick={validateData}
            variant="outlined"
            disabled={loading || !editedData}
          >
            Validate & Continue
          </Button>
        )}
        {currentStep === 3 && (
          <Button
            onClick={handleSave}
            variant="contained"
            color="primary"
            startIcon={<Save />}
            disabled={saving || validationErrors.length > 0}
          >
            {saving ? 'Saving...' : 'Save & Commit'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default PricingObjectEditor;

