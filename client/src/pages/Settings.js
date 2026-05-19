import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  TextField,
  Button,
  Grid,
  MenuItem,
  Switch,
  FormControlLabel,
  IconButton,
  Tooltip,
  LinearProgress,
  Chip,
} from '@mui/material';
import {
  Save,
  Refresh,
  Settings as SettingsIcon,
  Security,
  Speed,
  RestartAlt,
  CheckCircle,
  Error,
  Warning,
  Computer,
} from '@mui/icons-material';
import CircularProgress from '@mui/material/CircularProgress';
import axios from 'axios';

const Settings = () => {
  const [settings, setSettings] = useState({});
  const [systemStatus, setSystemStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [settingsResponse, statusResponse] = await Promise.all([
        axios.get('/api/config/settings'),
        axios.get('/api/system/status').catch(() => ({ data: { components: [], overall: 'unknown' } })),
      ]);

      setSettings(settingsResponse.data.settings || {});
      setSystemStatus(statusResponse.data);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshSystemStatus = async () => {
    try {
      await axios.post('/api/system/refresh-status');
      const statusResponse = await axios.get('/api/system/status');
      setSystemStatus(statusResponse.data);
      setSuccess('System status refreshed successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to refresh system status: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy': return <CheckCircle color="success" fontSize="small" />;
      case 'warning': return <Warning color="warning" fontSize="small" />;
      case 'error': return <Error color="error" fontSize="small" />;
      default: return <Warning color="disabled" fontSize="small" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'success';
      case 'warning': return 'warning';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  const getComponentLabel = (component) => {
    const labels = {
      'vlocity-cli': 'Vlocity CLI',
      'salesforce-cli': 'Salesforce CLI',
      'sfdmu-plugin': 'SFDMU Plugin (sf sfdmu run)',
      'database': 'Database',
      'redis': 'Cache (Redis)',
      'filesystem': 'File System',
    };
    return labels[component] || component;
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setError(null);
      
      await axios.post('/api/config/settings', { settings });
      
      setSuccess('Settings saved successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshApplication = async () => {
    try {
      setSaving(true);
      setError(null);
      
      await axios.post('/api/config/refresh');
      
      setSuccess('Application refreshed successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Settings
        </Typography>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading settings...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Settings
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Tooltip title="Refresh Settings">
            <IconButton onClick={fetchSettings}>
              <Refresh />
            </IconButton>
          </Tooltip>
          <Tooltip title="Restart Application">
            <Button
              variant="outlined"
              startIcon={<RestartAlt />}
              onClick={handleRefreshApplication}
              disabled={saving}
            >
              Restart App
            </Button>
          </Tooltip>
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

      <Grid container spacing={3}>
        {/* System Status */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Computer sx={{ mr: 1 }} />
                  <Typography variant="h6">System Status</Typography>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Refresh />}
                  onClick={refreshSystemStatus}
                >
                  Refresh Status
                </Button>
              </Box>
              
              {systemStatus && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Chip
                      icon={getStatusIcon(systemStatus.overall)}
                      label={`Overall: ${systemStatus.overall || 'unknown'}`}
                      color={getStatusColor(systemStatus.overall)}
                      size="small"
                    />
                    {systemStatus.timestamp && (
                      <Typography variant="caption" color="text.secondary">
                        Last checked: {new Date(systemStatus.timestamp).toLocaleString()}
                      </Typography>
                    )}
                  </Box>
                  
                  <Grid container spacing={2}>
                    {systemStatus.components && systemStatus.components.length > 0 ? (
                      systemStatus.components.map((component) => {
                        const isOptional = component.component === 'redis';
                        const isCritical = component.component === 'salesforce-cli' || component.component === 'vlocity-cli' || component.component === 'database' || component.component === 'filesystem';
                        return (
                          <Grid item xs={12} sm={6} md={4} key={component.component}>
                            <Box
                              sx={{
                                p: 2,
                                border: '1px solid',
                                borderColor: component.status === 'error' && isCritical ? 'error.main' : 'divider',
                                borderRadius: 1,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 1,
                                bgcolor: component.status === 'error' && isCritical ? 'error.light' : 'background.paper',
                              }}
                            >
                              {getStatusIcon(component.status)}
                              <Box sx={{ flexGrow: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                  <Typography variant="body2" fontWeight="medium">
                                    {getComponentLabel(component.component)}
                                  </Typography>
                                  {isOptional && (
                                    <Chip label="Optional" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                                  )}
                                  {isCritical && (
                                    <Chip label="Critical" size="small" color="error" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                                  )}
                                </Box>
                                {component.metadata?.version && (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    Version: {component.metadata.version}
                                  </Typography>
                                )}
                                {component.metadata?.command && (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    Command: {component.metadata.command}
                                  </Typography>
                                )}
                                {component.message && (
                                  <Typography 
                                    variant="caption" 
                                    color={component.status === 'error' ? 'error.main' : 'text.secondary'} 
                                    sx={{ display: 'block', mt: 0.5 }}
                                  >
                                    {component.message}
                                  </Typography>
                                )}
                                {component.metadata?.installCommand && component.status === 'error' && (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace' }}>
                                    Install: {component.metadata.installCommand}
                                  </Typography>
                                )}
                              </Box>
                              <Chip
                                label={component.status}
                                color={getStatusColor(component.status)}
                                size="small"
                                variant="outlined"
                              />
                            </Box>
                          </Grid>
                        );
                      })
                    ) : (
                      <Grid item xs={12}>
                        <Alert severity="info">
                          No system status information available. Click "Refresh Status" to check system components.
                          <br />
                          <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                            The system will check: Salesforce CLI, Vlocity CLI (optional), Database, Redis Cache (optional), and File System access.
                          </Typography>
                        </Alert>
                      </Grid>
                    )}
                  </Grid>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Application Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <SettingsIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Application Settings</Typography>
              </Box>
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Vlocity Version"
                    value={settings.vlocityVersion || ''}
                    onChange={(e) => updateSetting('vlocityVersion', e.target.value)}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Vlocity Timeout (ms)"
                    type="number"
                    value={settings.vlocityTimeout || ''}
                    onChange={(e) => updateSetting('vlocityTimeout', parseInt(e.target.value))}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Default Max Parallel"
                    type="number"
                    value={settings.defaultMaxParallel || ''}
                    onChange={(e) => updateSetting('defaultMaxParallel', parseInt(e.target.value))}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Export Packs Max Size"
                    type="number"
                    value={settings.defaultExportPacksMaxSize || ''}
                    onChange={(e) => updateSetting('defaultExportPacksMaxSize', parseInt(e.target.value))}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.prealignSettings || false}
                        onChange={(e) => updateSetting('prealignSettings', e.target.checked)}
                      />
                    }
                    label="Pre-align Settings"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Security Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Security sx={{ mr: 1 }} />
                <Typography variant="h6">Security Settings</Typography>
              </Box>
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Rate Limit Window (ms)"
                    type="number"
                    value={settings.rateLimitWindowMs || ''}
                    onChange={(e) => updateSetting('rateLimitWindowMs', parseInt(e.target.value))}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Rate Limit Max Requests"
                    type="number"
                    value={settings.rateLimitMaxRequests || ''}
                    onChange={(e) => updateSetting('rateLimitMaxRequests', parseInt(e.target.value))}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Log Level"
                    select
                    value={settings.logLevel || 'info'}
                    onChange={(e) => updateSetting('logLevel', e.target.value)}
                  >
                    <MenuItem value="error">Error</MenuItem>
                    <MenuItem value="warn">Warning</MenuItem>
                    <MenuItem value="info">Info</MenuItem>
                    <MenuItem value="debug">Debug</MenuItem>
                  </TextField>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Performance Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Speed sx={{ mr: 1 }} />
                <Typography variant="h6">Performance Settings</Typography>
              </Box>
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Max File Size"
                    value={settings.maxFileSize || ''}
                    onChange={(e) => updateSetting('maxFileSize', e.target.value)}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Upload Path"
                    value={settings.uploadPath || ''}
                    onChange={(e) => updateSetting('uploadPath', e.target.value)}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Default Max Depth"
                    type="number"
                    value={settings.defaultMaxDepth || ''}
                    onChange={(e) => updateSetting('defaultMaxDepth', parseInt(e.target.value))}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Default Max Iterations"
                    type="number"
                    value={settings.defaultMaxIterations || ''}
                    onChange={(e) => updateSetting('defaultMaxIterations', parseInt(e.target.value))}
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Save Button */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <Save />}
                  onClick={handleSaveSettings}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

    </Box>
  );
};

export default Settings;
