import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Paper,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import {
  CheckCircle,
  Error,
  Warning,
  Info,
  ExpandMore,
  Refresh,
  Science,
  Security,
  Speed,
  Lightbulb,
} from '@mui/icons-material';
import axios from 'axios';

const ConfigTester = () => {
  const [configs, setConfigs] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Test state
  const [selectedConfig, setSelectedConfig] = useState('');
  const [selectedOrg, setSelectedOrg] = useState('');
  const [testResults, setTestResults] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [activeStep, setActiveStep] = useState(0);
  const [testDialog, setTestDialog] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [configsResponse, orgsResponse] = await Promise.all([
        axios.get('/api/yaml/configs'),
        axios.get('/api/orgs/list'),
      ]);
      
      setConfigs(configsResponse.data.configs || []);
      setOrgs(orgsResponse.data.orgs || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const runTest = async () => {
    if (!selectedConfig || !selectedOrg) {
      setError('Please select both a configuration and an org');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setTestResults(null);
      setRecommendations([]);
      setActiveStep(0);
      setTestDialog(true);

      const response = await axios.post(`/api/yaml/configs/${selectedConfig}/test`, {
        username: selectedOrg,
      });

      setTestResults(response.data.testResults);
      setRecommendations(response.data.recommendations || []);

      const failedCount = (response.data.testResults?.tests || []).filter(t => t.status === 'failed').length;
      if (failedCount > 0) {
        setError(`Test completed with ${failedCount} failure${failedCount > 1 ? 's' : ''}. Review results below.`);
      } else {
        setSuccess('All tests passed successfully!');
      }

      // Simulate step progression
      const steps = ['YAML Validation', 'Connection Test', 'Query Validation', 'Permission Check'];
      steps.forEach((step, index) => {
        setTimeout(() => {
          setActiveStep(index + 1);
        }, (index + 1) * 1000);
      });

    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const getTestIcon = (status) => {
    switch (status) {
      case 'passed':
        return <CheckCircle color="success" />;
      case 'failed':
        return <Error color="error" />;
      case 'skipped':
        return <Info color="info" />;
      default:
        return <Warning color="warning" />;
    }
  };

  const getTestColor = (status) => {
    switch (status) {
      case 'passed':
        return 'success';
      case 'failed':
        return 'error';
      case 'skipped':
        return 'info';
      default:
        return 'warning';
    }
  };

  const getRecommendationIcon = (type) => {
    switch (type) {
      case 'performance':
        return <Speed color="warning" />;
      case 'security':
        return <Security color="error" />;
      case 'best_practice':
        return <Lightbulb color="info" />;
      default:
        return <Info color="info" />;
    }
  };

  const getRecommendationColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'info';
      default:
        return 'default';
    }
  };

  const closeTestDialog = () => {
    setTestDialog(false);
    setTestResults(null);
    setRecommendations([]);
    setActiveStep(0);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Configuration Tester
        </Typography>
        <Tooltip title="Refresh Data">
          <IconButton onClick={fetchData}>
            <Refresh />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Test Configuration
          </Typography>
          
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Select Configuration</InputLabel>
                <Select
                  value={selectedConfig}
                  label="Select Configuration"
                  onChange={(e) => setSelectedConfig(e.target.value)}
                >
                  {configs.map((config) => (
                    <MenuItem key={config.name} value={config.name}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={config.type}
                          color={config.type === 'export' ? 'primary' : 'secondary'}
                          size="small"
                        />
                        <Typography variant="body2">
                          {config.name} ({config.environment})
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Select Org</InputLabel>
                <Select
                  value={selectedOrg}
                  label="Select Org"
                  onChange={(e) => setSelectedOrg(e.target.value)}
                >
                  {orgs.map((org) => (
                    <MenuItem key={org.id} value={org.username}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {org.alias}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ({org.username})
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12}>
              <Button
                variant="contained"
                size="large"
                startIcon={<Science />}
                onClick={runTest}
                disabled={loading || !selectedConfig || !selectedOrg}
                fullWidth
              >
                {loading ? 'Running Tests...' : 'Run Configuration Test'}
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Test Results Dialog */}
      <Dialog open={testDialog} onClose={closeTestDialog} maxWidth="lg" fullWidth>
        <DialogTitle>
          Configuration Test Results
          {testResults && (
            <Chip
              label={testResults.valid ? 'Valid' : 'Invalid'}
              color={testResults.valid ? 'success' : 'error'}
              size="small"
              sx={{ ml: 2 }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          {loading && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Running Tests...
              </Typography>
              <Stepper activeStep={activeStep} orientation="vertical">
                <Step>
                  <StepLabel>YAML Structure Validation</StepLabel>
                </Step>
                <Step>
                  <StepLabel>Salesforce Connection Test</StepLabel>
                </Step>
                <Step>
                  <StepLabel>SOQL Query Validation</StepLabel>
                </Step>
                <Step>
                  <StepLabel>Object Permission Check</StepLabel>
                </Step>
              </Stepper>
              <LinearProgress sx={{ mt: 2 }} />
            </Box>
          )}

          {testResults && (
            <Box>
              {/* Test Results Summary */}
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Test Summary
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={3}>
                      <Typography variant="body2" color="text.secondary">Total Tests</Typography>
                      <Typography variant="h6">{testResults.tests.length}</Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="body2" color="text.secondary">Passed</Typography>
                      <Typography variant="h6" color="success.main">
                        {testResults.tests.filter(t => t.status === 'passed').length}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="body2" color="text.secondary">Failed</Typography>
                      <Typography variant="h6" color="error.main">
                        {testResults.tests.filter(t => t.status === 'failed').length}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="body2" color="text.secondary">Skipped</Typography>
                      <Typography variant="h6" color="info.main">
                        {testResults.tests.filter(t => t.status === 'skipped').length}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* Detailed Test Results */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="h6">Detailed Test Results</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <List>
                    {testResults.tests.map((test, index) => (
                      <React.Fragment key={index}>
                        <ListItem>
                          <ListItemIcon>
                            {getTestIcon(test.status)}
                          </ListItemIcon>
                          <ListItemText
                            primary={test.name}
                            secondary={test.details}
                          />
                          <Chip
                            label={test.status}
                            color={getTestColor(test.status)}
                            size="small"
                          />
                        </ListItem>
                        {index < testResults.tests.length - 1 && <Divider />}
                      </React.Fragment>
                    ))}
                  </List>
                </AccordionDetails>
              </Accordion>

              {/* Recommendations */}
              {recommendations.length > 0 && (
                <Accordion sx={{ mt: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="h6">
                      Recommendations ({recommendations.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <List>
                      {recommendations.map((rec, index) => (
                        <React.Fragment key={index}>
                          <ListItem>
                            <ListItemIcon>
                              {getRecommendationIcon(rec.type)}
                            </ListItemIcon>
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body1">{rec.message}</Typography>
                                  <Chip
                                    label={rec.priority}
                                    color={getRecommendationColor(rec.priority)}
                                    size="small"
                                  />
                                </Box>
                              }
                              secondary={
                                <Box>
                                  <Typography variant="body2" color="text.secondary">
                                    {rec.suggestion}
                                  </Typography>
                                  <Chip
                                    label={rec.type}
                                    variant="outlined"
                                    size="small"
                                    sx={{ mt: 1 }}
                                  />
                                </Box>
                              }
                            />
                          </ListItem>
                          {index < recommendations.length - 1 && <Divider />}
                        </React.Fragment>
                      ))}
                    </List>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Errors */}
              {testResults.errors && testResults.errors.length > 0 && (
                <Accordion sx={{ mt: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="h6" color="error">
                      Errors ({testResults.errors.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      {testResults.errors.map((error, index) => (
                        <Alert key={index} severity="error" sx={{ mb: 1 }}>
                          {error}
                        </Alert>
                      ))}
                    </Paper>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Warnings */}
              {testResults.warnings && testResults.warnings.length > 0 && (
                <Accordion sx={{ mt: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="h6" color="warning.main">
                      Warnings ({testResults.warnings.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      {testResults.warnings.map((warning, index) => (
                        <Alert key={index} severity="warning" sx={{ mb: 1 }}>
                          {warning}
                        </Alert>
                      ))}
                    </Paper>
                  </AccordionDetails>
                </Accordion>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeTestDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ConfigTester;

