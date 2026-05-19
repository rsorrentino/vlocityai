import React, { useState, useEffect, useCallback } from 'react';
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
  Chip,
  Alert,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Paper,
  TablePagination,
} from '@mui/material';
import {
  PlayArrow,
  CloudUpload,
  Refresh,
  Warning,
  Description,
  Transform,
  Api,
  Calculate,
  ViewModule,
  TouchApp,
  Functions,
  Web,
  List as ListIcon,
  AttachFile,
  Inventory,
} from '@mui/icons-material';
import axios from 'axios';

const VlocityManagement = () => {
  const [metadataTypes, setMetadataTypes] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedMetadataType, setSelectedMetadataType] = useState('');
  const [metadataItems, setMetadataItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [orgAnalysis, setOrgAnalysis] = useState(null);
  const [tabValue, setTabValue] = useState(0);
  
  // Pagination for metadata items
  const [metadataItemsPage, setMetadataItemsPage] = useState(0);
  const [metadataItemsRowsPerPage, setMetadataItemsRowsPerPage] = useState(25);

  const [deployConfig, setDeployConfig] = useState({
    sourceOrg: '',
    targetOrg: '',
    metadataType: '',
    metadataName: '',
  });
  const [, setDeployDialogOpen] = useState(false);

  const fetchInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [metadataResponse, orgsResponse] = await Promise.all([
        axios.get('/api/vlocity/metadata-types'),
        axios.get('/api/orgs/list'),
      ]);

      setMetadataTypes(metadataResponse.data.metadataTypes || []);
      const orgsList = orgsResponse.data.orgs || [];
      setOrgs(orgsList);
      
      // Auto-select first org if available
      if (orgsList.length > 0 && !selectedOrg) {
        setSelectedOrg(orgsList[0].username);
      }

    } catch (err) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(`Failed to load initial data: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

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

  const analyzeOrg = async (orgUsername) => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`/api/vlocity/org-analysis/${orgUsername}`);
      setOrgAnalysis(response.data.analysis);
      setAnalysisDialogOpen(true);
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(`Failed to analyze org: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const deployMetadata = async () => {
    try {
      setLoading(true);
      setError(null);
      await axios.post('/api/vlocity/deploy-metadata', {
        sourceOrg: deployConfig.sourceOrg,
        targetOrg: deployConfig.targetOrg,
        metadataType: deployConfig.metadataType,
        metadataName: deployConfig.metadataName || null
      });
      
      // Show success message
      setSuccess('Deployment initiated successfully! Note: For reliable metadata transfer, use Export/Deploy Jobs instead.');
      setTimeout(() => setSuccess(null), 5000);
      
      setDeployDialogOpen(false);
      setDeployConfig({
        sourceOrg: '',
        targetOrg: '',
        metadataType: '',
        metadataName: '',
      });
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(`Deployment failed: ${errorMessage}`);
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

  const TabPanel = ({ children, value, index, ...other }) => (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`vlocity-tabpanel-${index}`}
      aria-labelledby={`vlocity-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );

  if (loading && !metadataTypes.length) {
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading Vlocity management...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Vlocity Management</Typography>
        <Button
          variant="contained"
          startIcon={<Refresh />}
          onClick={fetchInitialData}
        >
          Refresh
        </Button>
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

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
          <Tab label="Metadata Types" />
          <Tab label="Org Analysis" />
          <Tab label="Deploy Metadata" />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Metadata Types */}
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

          {/* Metadata Browser */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Browse Metadata
                </Typography>
                
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Select Org</InputLabel>
                  <Select
                    value={selectedOrg}
                    label="Select Org"
                    onChange={(e) => {
                      const newOrg = e.target.value;
                      setSelectedOrg(newOrg);
                      setMetadataItems([]);
                      setSelectedMetadataType('');
                      setError(null);
                      // Auto-fetch if metadata type is already selected
                      if (selectedMetadataType) {
                        fetchMetadata(newOrg, selectedMetadataType);
                      }
                    }}
                  >
                    {Array.isArray(orgs) && orgs.map((org) => (
                      <MenuItem key={org.username} value={org.username}>
                        {org.alias || org.username}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

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
                                <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
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
                                  {item.lastModifiedDate && (
                                    <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                      Modified: {new Date(item.lastModifiedDate).toLocaleDateString()}
                                    </Typography>
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
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Org Analysis
                </Typography>
                
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Select Org to Analyze</InputLabel>
                  <Select
                    value={selectedOrg}
                    label="Select Org to Analyze"
                    onChange={(e) => {
                      setSelectedOrg(e.target.value);
                      setError(null);
                    }}
                  >
                    {Array.isArray(orgs) && orgs.map((org) => (
                      <MenuItem key={org.username} value={org.username}>
                        {org.alias || org.username}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Button
                  variant="contained"
                  onClick={() => analyzeOrg(selectedOrg)}
                  disabled={!selectedOrg || loading}
                  startIcon={<PlayArrow />}
                  sx={{ mt: 2 }}
                >
                  {loading ? 'Analyzing...' : 'Analyze Org'}
                </Button>

                {loading && (
                  <Box sx={{ mt: 2 }}>
                    <LinearProgress />
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Deploy Metadata Between Orgs
                </Typography>
                
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Source Org</InputLabel>
                      <Select
                        value={deployConfig.sourceOrg}
                        label="Source Org"
                        onChange={(e) => setDeployConfig({ ...deployConfig, sourceOrg: e.target.value })}
                      >
                        {Array.isArray(orgs) && orgs.map((org) => (
                          <MenuItem key={org.username} value={org.username}>
                            {org.alias || org.username} ({org.username})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Target Org</InputLabel>
                      <Select
                        value={deployConfig.targetOrg}
                        label="Target Org"
                        onChange={(e) => setDeployConfig({ ...deployConfig, targetOrg: e.target.value })}
                      >
                        {Array.isArray(orgs) && orgs.map((org) => (
                          <MenuItem key={org.username} value={org.username}>
                            {org.alias || org.username} ({org.username})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Metadata Type</InputLabel>
                      <Select
                        value={deployConfig.metadataType}
                        label="Metadata Type"
                        onChange={(e) => setDeployConfig({ ...deployConfig, metadataType: e.target.value })}
                      >
                        {Array.isArray(metadataTypes) && metadataTypes.map((type) => (
                          <MenuItem key={type.name} value={type.name}>
                            {type.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Metadata Name (optional)"
                      value={deployConfig.metadataName}
                      onChange={(e) => setDeployConfig({ ...deployConfig, metadataName: e.target.value })}
                      placeholder="Leave empty to deploy all of this type"
                    />
                  </Grid>
                </Grid>

                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="contained"
                    onClick={deployMetadata}
                    disabled={!deployConfig.sourceOrg || !deployConfig.targetOrg || !deployConfig.metadataType || loading}
                    startIcon={<CloudUpload />}
                  >
                    {loading ? 'Deploying...' : 'Deploy Metadata'}
                  </Button>
                  {loading && (
                    <Box sx={{ mt: 2 }}>
                      <LinearProgress />
                    </Box>
                  )}
                  <Alert severity="info" sx={{ mt: 2 }}>
                    <Typography variant="body2">
                      <strong>Note:</strong> For reliable metadata transfer, use the Export/Deploy Jobs feature instead.
                      This endpoint is for basic metadata operations only.
                    </Typography>
                  </Alert>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      {/* Org Analysis Dialog */}
      <Dialog open={analysisDialogOpen} onClose={() => setAnalysisDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h5">Org Analysis Results</Typography>
            {orgAnalysis?.orgInfo && (
              <Chip 
                label={orgAnalysis.orgInfo.orgType || 'Unknown'} 
                color={orgAnalysis.orgInfo.orgType === 'Production' ? 'error' : 'default'}
                size="small"
              />
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {loading && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <LinearProgress sx={{ mb: 2 }} />
              <Typography>Analyzing org...</Typography>
            </Box>
          )}

          {orgAnalysis && !loading && (
            <Box>
              {/* Org Info */}
              {orgAnalysis.orgInfo && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Organization Information
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Username</Typography>
                      <Typography variant="body1">{orgAnalysis.orgInfo.username}</Typography>
                    </Grid>
                    {orgAnalysis.orgInfo.orgId && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">Org ID</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                          {orgAnalysis.orgInfo.orgId}
                        </Typography>
                      </Grid>
                    )}
                    {orgAnalysis.orgInfo.instanceUrl && (
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary">Instance URL</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                          {orgAnalysis.orgInfo.instanceUrl}
                        </Typography>
                      </Grid>
                    )}
                  </Grid>
                </Box>
              )}

              {/* Metadata Counts */}
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                Metadata Counts
              </Typography>
              <Grid container spacing={2} sx={{ mb: 3 }}>
                {Object.entries(orgAnalysis.metadataCounts || {})
                  .filter(([key]) => key !== 'total')
                  .map(([key, value]) => {
                    // Format key name for display
                    const displayName = key
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/^./, str => str.toUpperCase())
                      .trim();
                    
                    return (
                      <Grid item xs={6} sm={4} md={3} key={key}>
                        <Paper sx={{ p: 2, textAlign: 'center', height: '100%' }}>
                          <Typography variant="h4" color="primary">
                            {value}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 0.5 }}>
                            {displayName}
                          </Typography>
                        </Paper>
                      </Grid>
                    );
                  })}
                {orgAnalysis.metadataCounts?.total && (
                  <Grid item xs={12}>
                    <Paper sx={{ p: 2, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
                      <Typography variant="h5" align="center">
                        Total: {orgAnalysis.metadataCounts.total} components
                      </Typography>
                    </Paper>
                  </Grid>
                )}
              </Grid>

              {/* Configurations */}
              {orgAnalysis.configurations && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Configuration Status
                  </Typography>
                  <Grid container spacing={2}>
                    {Object.entries(orgAnalysis.configurations).map(([key, config]) => (
                      <Grid item xs={12} sm={6} md={4} key={key}>
                        <Paper 
                          sx={{ 
                            p: 2, 
                            border: '1px solid',
                            borderColor: config.configured ? 'success.main' : 'warning.main',
                            bgcolor: config.configured ? 'success.light' : 'warning.light',
                            opacity: 0.8
                          }}
                        >
                          <Typography variant="subtitle1" sx={{ textTransform: 'capitalize', mb: 1 }}>
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </Typography>
                          <Chip 
                            label={config.configured ? 'Configured' : 'Not Configured'}
                            color={config.configured ? 'success' : 'warning'}
                            size="small"
                            sx={{ mb: 1 }}
                          />
                          {config.products !== undefined && (
                            <Typography variant="body2">Products: {config.products}</Typography>
                          )}
                          {config.attributes !== undefined && (
                            <Typography variant="body2">Attributes: {config.attributes}</Typography>
                          )}
                          {config.priceLists !== undefined && (
                            <Typography variant="body2">Price Lists: {config.priceLists}</Typography>
                          )}
                          {config.contracts !== undefined && (
                            <Typography variant="body2">Contracts: {config.contracts}</Typography>
                          )}
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )}

              {/* Dependencies */}
              {orgAnalysis.dependencies && (
                orgAnalysis.dependencies.criticalDependencies?.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Critical Dependencies
                    </Typography>
                    <List dense>
                      {orgAnalysis.dependencies.criticalDependencies.slice(0, 10).map((dep, index) => (
                        <ListItem key={index}>
                          <ListItemIcon>
                            <Warning color="warning" />
                          </ListItemIcon>
                          <ListItemText primary={dep} />
                        </ListItem>
                      ))}
                      {orgAnalysis.dependencies.criticalDependencies.length > 10 && (
                        <Typography variant="caption" color="text.secondary" sx={{ pl: 4 }}>
                          ...and {orgAnalysis.dependencies.criticalDependencies.length - 10} more
                        </Typography>
                      )}
                    </List>
                  </Box>
                )
              )}

              {/* Recommendations */}
              <Typography variant="h6" gutterBottom>
                Recommendations
              </Typography>
              {orgAnalysis.recommendations && orgAnalysis.recommendations.length > 0 ? (
                <List>
                  {orgAnalysis.recommendations.map((rec, index) => (
                    <ListItem key={index}>
                      <ListItemIcon>
                        <Warning color="warning" />
                      </ListItemIcon>
                      <ListItemText primary={rec} />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Alert severity="success">
                  No specific recommendations. Your Vlocity configuration looks good!
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnalysisDialogOpen(false)} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VlocityManagement;
