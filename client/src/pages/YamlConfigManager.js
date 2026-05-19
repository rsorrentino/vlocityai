import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  Button,
  Grid,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
  Tabs,
  Tab,
  Checkbox,
  ButtonGroup,
  TablePagination,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  ContentCopy,
  Visibility,
  Download,
  Refresh,
  Settings,
  PlayArrow,
  SelectAll,
  Clear,
} from '@mui/icons-material';
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog';

const YamlConfigManager = () => {
  const [configs, setConfigs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: null,
  });
  
  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalConfigs, setTotalConfigs] = useState(0);
  
  // Bulk operations state
  const [selectedConfigs, setSelectedConfigs] = useState([]);
  
  // Dialog states
  const [createDialog, setCreateDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [viewDialog, setViewDialog] = useState(false);
  const [cloneDialog, setCloneDialog] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(false);
  
  // Form states
  const [selectedConfig, setSelectedConfig] = useState(null);
  const [newConfig, setNewConfig] = useState({
    name: '',
    type: 'export',
    environment: 'default',
    projectPath: './export',
    queries: [],
    settings: {
      defaultMaxParallel: 10,
      exportPacksMaxSize: 5000,
      removeInvalidMatchingKeyFields: true,
      maxDepth: 10,
    }
  });
  const [queryText, setQueryText] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [configsResponse, templatesResponse] = await Promise.all([
        axios.get(`/api/yaml/configs?limit=${rowsPerPage}&offset=${page * rowsPerPage}`),
        axios.get('/api/yaml/templates'),
      ]);
      
      setConfigs(configsResponse.data.configs || []);
      setTotalConfigs(configsResponse.data.total || configsResponse.data.configs?.length || 0);
      setTemplates(templatesResponse.data.templates || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    fetchData();
  }, [page, rowsPerPage, fetchData]);

  const handleCreateConfig = async () => {
    try {
      setError(null);
      
      // Parse queries from text
      const queries = parseQueriesFromText(queryText);
      const configData = {
        ...newConfig,
        queries,
      };
      
      await axios.post('/api/yaml/configs', configData);
      
      setCreateDialog(false);
      setSuccess('Configuration created successfully!');
      setTimeout(() => setSuccess(null), 3000);
      
      // Reset form
      setNewConfig({
        name: '',
        type: 'export',
        environment: 'default',
        projectPath: './export',
        queries: [],
        settings: {
          defaultMaxParallel: 10,
          exportPacksMaxSize: 5000,
          removeInvalidMatchingKeyFields: true,
          maxDepth: 10,
        }
      });
      setQueryText('');
      
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
  };

  const handleEditConfig = async () => {
    try {
      setError(null);
      
      const queries = parseQueriesFromText(queryText);
      const configData = {
        ...selectedConfig,
        queries,
      };
      
      await axios.put(`/api/yaml/configs/${selectedConfig.name}`, configData);
      
      setEditDialog(false);
      setSuccess('Configuration updated successfully!');
      setTimeout(() => setSuccess(null), 3000);
      
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
  };

  const handleDeleteConfig = (filename) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Configuration',
      message: `Are you sure you want to delete "${filename}"? This action cannot be undone.`,
      severity: 'error',
      onConfirm: async () => {
        try {
          setError(null);
          await axios.delete(`/api/yaml/configs/${filename}`);
          setSuccess('Configuration deleted successfully!');
          setTimeout(() => setSuccess(null), 3000);
          fetchData();
        } catch (err) {
          setError(err.response?.data?.error?.message || err.message);
        } finally {
          setConfirmDialog({ open: false, title: '', message: '', onConfirm: null });
        }
      },
    });
  };

  const handleCloneConfig = async () => {
    try {
      setError(null);
      
      await axios.post(`/api/yaml/configs/${selectedConfig.name}/clone`, {
        targetEnvironment: newConfig.environment,
      });
      
      setCloneDialog(false);
      setSuccess('Configuration cloned successfully!');
      setTimeout(() => setSuccess(null), 3000);
      
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
  };

  const handleUseTemplate = async (template) => {
    try {
      setError(null);
      
      const configData = {
        name: template.name.toLowerCase().replace(/\s+/g, '-'),
        type: template.type,
        environment: 'default',
        projectPath: template.config.projectPath,
        queries: template.config.queries,
        settings: template.config,
      };
      
      await axios.post('/api/yaml/configs', configData);
      
      setTemplateDialog(false);
      setSuccess('Configuration created from template!');
      setTimeout(() => setSuccess(null), 3000);
      
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
  };

  // Bulk operations
  const handleSelectConfig = (configName) => {
    setSelectedConfigs(prev => 
      prev.includes(configName) 
        ? prev.filter(name => name !== configName)
        : [...prev, configName]
    );
  };

  const handleSelectAll = () => {
    setSelectedConfigs(configs.map(config => config.name));
  };

  const handleClearSelection = () => {
    setSelectedConfigs([]);
  };

  const handleBulkOperation = async (operation) => {
    if (selectedConfigs.length === 0) {
      setError('Please select configurations first');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      switch (operation) {
        case 'delete':
          await axios.post('/api/yaml/bulk/delete', {
            filenames: selectedConfigs
          });
          break;
        case 'validate':
          await axios.post('/api/yaml/bulk/validate', {
            filenames: selectedConfigs
          });
          break;
        case 'export':
          await axios.post('/api/yaml/bulk/export', {
            filenames: selectedConfigs,
            format: 'yaml'
          });
          break;
        default:
          throw new Error('Unknown bulk operation');
      }

      setSuccess(`Bulk ${operation} completed!`);
      setTimeout(() => setSuccess(null), 3000);

      if (operation === 'delete') {
        fetchData();
        setSelectedConfigs([]);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  };


  const parseQueriesFromText = (text) => {
    if (!text.trim()) return [];
    
    const lines = text.split('\n').filter(line => line.trim());
    const queries = [];
    
    lines.forEach(line => {
      const trimmed = line.trim();
      
      // Simple string query
      if (trimmed.startsWith('- ')) {
        queries.push(trimmed.substring(2));
      } else if (trimmed.startsWith('VlocityDataPackType:')) {
        // Object query - would need more complex parsing
        queries.push({
          VlocityDataPackType: 'SObject',
          query: trimmed,
        });
      } else {
        // Assume it's a simple query name
        queries.push(trimmed);
      }
    });
    
    return queries;
  };

  const formatQueriesForText = (queries) => {
    if (!queries || queries.length === 0) return '';
    
    return queries.map(query => {
      if (typeof query === 'string') {
        return `- ${query}`;
      } else if (query.VlocityDataPackType) {
        return `- VlocityDataPackType: ${query.VlocityDataPackType}\n  query: ${query.query}`;
      } else {
        return `- ${JSON.stringify(query)}`;
      }
    }).join('\n');
  };

  const openEditDialog = (config) => {
    setSelectedConfig(config);
    setNewConfig({
      name: config.name,
      type: config.type,
      environment: config.environment,
      projectPath: config.projectPath,
      queries: config.queries,
      settings: config.settings,
    });
    setQueryText(formatQueriesForText(config.queries));
    setEditDialog(true);
  };

  const openViewDialog = async (config) => {
    try {
      const response = await axios.get(`/api/yaml/configs/${config.name}`);
      setSelectedConfig(response.data.config);
      setViewDialog(true);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
  };

  const openCloneDialog = (config) => {
    setSelectedConfig(config);
    setNewConfig({
      ...config,
      environment: 'uat', // Default to UAT
    });
    setCloneDialog(true);
  };

  const getTypeColor = (type) => {
    return type === 'export' ? 'primary' : 'secondary';
  };

  const getEnvironmentColor = (env) => {
    switch (env) {
      case 'prod': return 'error';
      case 'uat': return 'warning';
      case 'dev': return 'success';
      default: return 'default';
    }
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          YAML Configuration Manager
        </Typography>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading configurations...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          YAML Configuration Manager
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchData}>
              <Refresh />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<Settings />}
            onClick={() => setTemplateDialog(true)}
            sx={{ mr: 1 }}
          >
            Templates
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setCreateDialog(true)}
          >
            New Configuration
          </Button>
        </Box>
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
          <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)}>
            <Tab label={`Configurations (${configs.length})`} />
            <Tab label={`Templates (${templates.length})`} />
          </Tabs>

          {activeTab === 0 && (
            <Box sx={{ mt: 3 }}>
              {/* Bulk Operations Toolbar */}
              {selectedConfigs.length > 0 && (
                <Card sx={{ mb: 2, backgroundColor: 'primary.50' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="h6">
                        {selectedConfigs.length} configuration(s) selected
                      </Typography>
                      <ButtonGroup>
                        <Button
                          variant="outlined"
                          startIcon={<Delete />}
                          onClick={() => handleBulkOperation('delete')}
                          color="error"
                        >
                          Delete
                        </Button>
                        <Button
                          variant="outlined"
                          startIcon={<PlayArrow />}
                          onClick={() => handleBulkOperation('validate')}
                        >
                          Validate
                        </Button>
                        <Button
                          variant="outlined"
                          startIcon={<Download />}
                          onClick={() => handleBulkOperation('export')}
                        >
                          Export
                        </Button>
                        <Button
                          variant="outlined"
                          startIcon={<Clear />}
                          onClick={handleClearSelection}
                        >
                          Clear
                        </Button>
                      </ButtonGroup>
                    </Box>
                  </CardContent>
                </Card>
              )}

              {/* Selection Controls */}
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Button
                  variant="outlined"
                  startIcon={<SelectAll />}
                  onClick={handleSelectAll}
                  size="small"
                >
                  Select All
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Clear />}
                  onClick={handleClearSelection}
                  size="small"
                >
                  Clear Selection
                </Button>
              </Box>

              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          indeterminate={selectedConfigs.length > 0 && selectedConfigs.length < configs.length}
                          checked={configs.length > 0 && selectedConfigs.length === configs.length}
                          onChange={handleSelectAll}
                        />
                      </TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Environment</TableCell>
                      <TableCell>Queries</TableCell>
                      <TableCell>Modified</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {configs.map((config) => (
                      <TableRow key={config.name} hover>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={selectedConfigs.includes(config.name)}
                            onChange={() => handleSelectConfig(config.name)}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {config.name}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={config.type}
                            color={getTypeColor(config.type)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={config.environment}
                            color={getEnvironmentColor(config.environment)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {config.queries.length} queries
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {new Date(config.modified).toLocaleDateString()}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Tooltip title="View">
                              <IconButton
                                size="small"
                                onClick={() => openViewDialog(config)}
                              >
                                <Visibility />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Edit">
                              <IconButton
                                size="small"
                                onClick={() => openEditDialog(config)}
                              >
                                <Edit />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Clone">
                              <IconButton
                                size="small"
                                onClick={() => openCloneDialog(config)}
                              >
                                <ContentCopy />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                              <IconButton
                                size="small"
                                onClick={() => handleDeleteConfig(config.name)}
                                color="error"
                              >
                                <Delete />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <TablePagination
                  rowsPerPageOptions={[5, 10, 25, 50]}
                  component="div"
                  count={totalConfigs}
                  rowsPerPage={rowsPerPage}
                  page={page}
                  onPageChange={handleChangePage}
                  onRowsPerPageChange={handleChangeRowsPerPage}
                  labelRowsPerPage="Configs per page:"
                  labelDisplayedRows={({ from, to, count }) => 
                    `${from}-${to} of ${count !== -1 ? count : `more than ${to}`}`
                  }
                />
              </TableContainer>
            </Box>
          )}

          {activeTab === 1 && (
            <Box sx={{ mt: 3 }}>
              <Grid container spacing={2}>
                {templates.map((template, index) => (
                  <Grid item xs={12} md={6} key={index}>
                    <Card>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          {template.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          {template.description}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                          <Chip
                            label={template.type}
                            color={getTypeColor(template.type)}
                            size="small"
                          />
                          <Chip
                            label={`${template.config.queries.length} queries`}
                            variant="outlined"
                            size="small"
                          />
                        </Box>
                        <Button
                          variant="outlined"
                          startIcon={<Add />}
                          onClick={() => handleUseTemplate(template)}
                          fullWidth
                        >
                          Use Template
                        </Button>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Create Configuration Dialog */}
      <Dialog open={createDialog} onClose={() => setCreateDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Configuration</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Configuration Name"
                value={newConfig.name}
                onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select
                  value={newConfig.type}
                  label="Type"
                  onChange={(e) => setNewConfig({ ...newConfig, type: e.target.value })}
                >
                  <MenuItem value="export">Export</MenuItem>
                  <MenuItem value="deploy">Deploy</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Environment</InputLabel>
                <Select
                  value={newConfig.environment}
                  label="Environment"
                  onChange={(e) => setNewConfig({ ...newConfig, environment: e.target.value })}
                >
                  <MenuItem value="default">Default</MenuItem>
                  <MenuItem value="dev">Development</MenuItem>
                  <MenuItem value="uat">UAT</MenuItem>
                  <MenuItem value="prod">Production</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Project Path"
                value={newConfig.projectPath}
                onChange={(e) => setNewConfig({ ...newConfig, projectPath: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={8}
                label="Queries (one per line)"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="- Product2&#10;- VlocityPicklist&#10;- SObject_PricebookEntry"
                sx={{ fontFamily: 'monospace' }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialog(false)}>Cancel</Button>
          <Button onClick={handleCreateConfig} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Configuration Dialog */}
      <Dialog open={viewDialog} onClose={() => setViewDialog(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Configuration: {selectedConfig?.name}</DialogTitle>
        <DialogContent>
          {selectedConfig && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Configuration Details
              </Typography>
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Type</Typography>
                  <Chip label={selectedConfig.type} color={getTypeColor(selectedConfig.type)} size="small" />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Environment</Typography>
                  <Chip label={selectedConfig.environment} color={getEnvironmentColor(selectedConfig.environment)} size="small" />
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Project Path</Typography>
                  <Typography variant="body1">{selectedConfig.projectPath}</Typography>
                </Grid>
              </Grid>
              
              <Typography variant="h6" gutterBottom>
                Queries ({selectedConfig.queries?.length || 0})
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, maxHeight: 400, overflow: 'auto' }}>
                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {formatQueriesForText(selectedConfig.queries)}
                </pre>
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Configuration Dialog */}
      <Dialog open={editDialog} onClose={() => setEditDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Configuration</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Configuration Name"
                value={newConfig.name}
                onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select
                  value={newConfig.type}
                  label="Type"
                  onChange={(e) => setNewConfig({ ...newConfig, type: e.target.value })}
                >
                  <MenuItem value="export">Export</MenuItem>
                  <MenuItem value="deploy">Deploy</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Environment</InputLabel>
                <Select
                  value={newConfig.environment}
                  label="Environment"
                  onChange={(e) => setNewConfig({ ...newConfig, environment: e.target.value })}
                >
                  <MenuItem value="default">Default</MenuItem>
                  <MenuItem value="dev">Development</MenuItem>
                  <MenuItem value="uat">UAT</MenuItem>
                  <MenuItem value="prod">Production</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Project Path"
                value={newConfig.projectPath}
                onChange={(e) => setNewConfig({ ...newConfig, projectPath: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={8}
                label="Queries (one per line)"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="- Product2&#10;- VlocityPicklist&#10;- SObject_PricebookEntry"
                sx={{ fontFamily: 'monospace' }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(false)}>Cancel</Button>
          <Button onClick={handleEditConfig} variant="contained">
            Update
          </Button>
        </DialogActions>
      </Dialog>

      {/* Clone Configuration Dialog */}
      <Dialog open={cloneDialog} onClose={() => setCloneDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Clone Configuration</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Clone "{selectedConfig?.name}" to a different environment:
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Target Environment</InputLabel>
            <Select
              value={newConfig.environment}
              label="Target Environment"
              onChange={(e) => setNewConfig({ ...newConfig, environment: e.target.value })}
            >
              <MenuItem value="dev">Development</MenuItem>
              <MenuItem value="uat">UAT</MenuItem>
              <MenuItem value="prod">Production</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloneDialog(false)}>Cancel</Button>
          <Button onClick={handleCloneConfig} variant="contained">
            Clone
          </Button>
        </DialogActions>
      </Dialog>

      {/* Template Dialog */}
      <Dialog open={templateDialog} onClose={() => setTemplateDialog(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Configuration Templates</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Choose a template to create a new configuration:
          </Typography>
          <Grid container spacing={2}>
            {templates.map((template, index) => (
              <Grid item xs={12} md={6} key={index}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      {template.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {template.description}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                      <Chip
                        label={template.type}
                        color={getTypeColor(template.type)}
                        size="small"
                      />
                      <Chip
                        label={`${template.config.queries.length} queries`}
                        variant="outlined"
                        size="small"
                      />
                    </Box>
                    <Button
                      variant="outlined"
                      startIcon={<Add />}
                      onClick={() => handleUseTemplate(template)}
                      fullWidth
                    >
                      Use Template
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        severity={confirmDialog.severity || 'warning'}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ open: false, title: '', message: '', onConfirm: null })}
      />
    </Box>
  );
};

export default YamlConfigManager;
