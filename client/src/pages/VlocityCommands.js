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
  Switch,
  FormControlLabel,
  IconButton,
  Tooltip,
  ListSubheader,
} from '@mui/material';
import {
  PlayArrow,
  Refresh,
  Help,
  CheckCircle,
  Error as ErrorIcon,
  Code,
  Description,
  Build,
} from '@mui/icons-material';
import axios from 'axios';

const VlocityCommands = () => {
  const [commands, setCommands] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedCommand, setSelectedCommand] = useState('');
  const [commandOptions, setCommandOptions] = useState({});
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [commandDoc, setCommandDoc] = useState(null);
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [tabValue, setTabValue] = useState(0);

  const fetchOrgs = useCallback(async () => {
    try {
      const response = await axios.get('/api/orgs/list');
      const orgsList = response.data.orgs || [];
      setOrgs(orgsList);
      if (orgsList.length > 0 && !selectedOrg) {
        setSelectedOrg(orgsList[0].username);
      }
    } catch (err) {
      setError(`Failed to load organizations: ${err.response?.data?.error || err.message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrg]);

  useEffect(() => {
    fetchCommands();
    fetchOrgs();
  }, [fetchOrgs]);

  useEffect(() => {
    if (selectedCommand) {
      fetchCommandDoc(selectedCommand);
    }
  }, [selectedCommand]);

  const fetchCommands = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/vlocity-commands');
      setCommands(response.data.commands);
    } catch (err) {
      setError(`Failed to load commands: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };


  const fetchCommandDoc = async (command) => {
    try {
      const response = await axios.get(`/api/vlocity-commands/${command}`);
      setCommandDoc(response.data.documentation);
    } catch (err) {
      // Command might not have documentation, that's okay
      setCommandDoc(null);
    }
  };

  const handleCommandSelect = (command) => {
    setSelectedCommand(command);
    setCommandOptions({});
    setError(null);
    setSuccess(null);
  };

  const handleExecute = async () => {
    if (!selectedOrg || !selectedCommand) {
      setError('Please select an organization and a command');
      return;
    }

    try {
      setExecuting(true);
      setError(null);
      setSuccess(null);

      // Build job file path if not provided
      const jobFile = commandOptions.jobFile || `./jobs/${selectedCommand}_${Date.now()}.yaml`;

      const response = await axios.post(`/api/vlocity-commands/${selectedCommand}/execute`, {
        username: selectedOrg,
        options: {
          ...commandOptions,
          jobFile,
        },
      });

      // Command execution started asynchronously - show job info
      setExecutionResult({
        success: true,
        jobId: response.data.jobId,
        command: response.data.command,
        message: response.data.message,
        job: response.data.job,
      });
      setResultDialogOpen(true);
      setSuccess(`Command '${selectedCommand}' started. Monitoring via WebSocket...`);
      
      // Optionally navigate to job monitor or show job status
      if (response.data.jobId) {
        // You can add WebSocket connection here to monitor progress
        // For now, just show the job ID
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Command execution failed');
      if (err.response?.data?.details) {
        setExecutionResult({
          success: false,
          error: err.response.data.error,
          details: err.response.data.details,
        });
        setResultDialogOpen(true);
      }
    } finally {
      setExecuting(false);
    }
  };


  const renderCommandForm = () => {
    if (!selectedCommand) {
      return (
        <Alert severity="info">
          Please select a command from the list to see its options
        </Alert>
      );
    }

    const commonFields = (
      <>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Job File Path (optional)"
            value={commandOptions.jobFile || ''}
            onChange={(e) => setCommandOptions({ ...commandOptions, jobFile: e.target.value })}
            placeholder="Leave empty to auto-generate"
            helperText="Path to YAML job file. If empty, will be auto-generated."
          />
        </Grid>
      </>
    );

    switch (selectedCommand) {
      case 'packExportSingle':
        return (
          <>
            {commonFields}
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="DataPack Type"
                value={commandOptions.type || ''}
                onChange={(e) => setCommandOptions({ ...commandOptions, type: e.target.value })}
                required
                placeholder="e.g., Product2, OmniScript"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Salesforce ID"
                value={commandOptions.id || ''}
                onChange={(e) => setCommandOptions({ ...commandOptions, id: e.target.value })}
                required
                placeholder="e.g., 01t..."
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                type="number"
                label="Depth (optional)"
                value={commandOptions.depth || ''}
                onChange={(e) => setCommandOptions({ ...commandOptions, depth: e.target.value })}
                helperText="Max depth for dependencies (0 = no dependencies)"
              />
            </Grid>
          </>
        );

      case 'runJavaScript':
        return (
          <>
            {commonFields}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Script Path"
                value={commandOptions.scriptPath || ''}
                onChange={(e) => setCommandOptions({ ...commandOptions, scriptPath: e.target.value })}
                required
                placeholder="/path/to/script.js"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Script Arguments (JSON)"
                value={commandOptions.scriptArgs ? JSON.stringify(commandOptions.scriptArgs) : ''}
                onChange={(e) => {
                  try {
                    const args = e.target.value ? JSON.parse(e.target.value) : {};
                    setCommandOptions({ ...commandOptions, scriptArgs: args });
                  } catch (err) {
                    // Invalid JSON, ignore
                  }
                }}
                placeholder='{"key": "value"}'
                helperText="Optional JSON object with script arguments"
              />
            </Grid>
          </>
        );

      case 'runApex':
        return (
          <>
            {commonFields}
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={6}
                label="Apex Code"
                value={commandOptions.apexCode || ''}
                onChange={(e) => setCommandOptions({ ...commandOptions, apexCode: e.target.value })}
                required
                placeholder="System.debug('Hello World');"
              />
            </Grid>
          </>
        );

      case 'installDPsfromStaticResource':
        return (
          <>
            {commonFields}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Static Resource Name"
                value={commandOptions.staticResourceName || ''}
                onChange={(e) => setCommandOptions({ ...commandOptions, staticResourceName: e.target.value })}
                required
                placeholder="MyDataPackResource"
              />
            </Grid>
          </>
        );

      case 'validateLocalData':
        return (
          <>
            {commonFields}
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={commandOptions.fixLocalGlobalKeys || false}
                    onChange={(e) => setCommandOptions({ ...commandOptions, fixLocalGlobalKeys: e.target.checked })}
                  />
                }
                label="Fix Local Global Keys"
              />
            </Grid>
          </>
        );

      default:
        return commonFields;
    }
  };

  if (loading && !commands) {
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2, textAlign: 'center' }}>
          Loading Vlocity commands...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Vlocity Commands</Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => {
            fetchCommands();
            fetchOrgs();
          }}
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
          <Tab label="Primary Commands" />
          <Tab label="Troubleshooting" />
          <Tab label="Additional Commands" />
        </Tabs>
      </Box>

      <Grid container spacing={3}>
        {/* Command List */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Available Commands
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              {tabValue === 0 && commands?.primary && (
                <List dense>
                  {commands.primary.map((cmd) => {
                    const commandName = typeof cmd === 'string' ? cmd : cmd.name;
                    const commandDesc = typeof cmd === 'object' ? cmd.description : null;
                    return (
                      <ListItem
                        key={commandName}
                        button
                        selected={selectedCommand === commandName}
                        onClick={() => handleCommandSelect(commandName)}
                        sx={{
                          borderRadius: 1,
                          mb: 0.5,
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          '&.Mui-selected': {
                            bgcolor: 'primary.light',
                            '&:hover': {
                              bgcolor: 'primary.light',
                            },
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <PlayArrow />
                          </ListItemIcon>
                          <ListItemText 
                            primary={commandName}
                            secondary={commandDesc}
                            primaryTypographyProps={{ fontWeight: selectedCommand === commandName ? 600 : 400 }}
                            secondaryTypographyProps={{ 
                              variant: 'caption',
                              sx: { 
                                mt: 0.5,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }
                            }}
                          />
                          <Chip
                            label="Primary"
                            color="primary"
                            size="small"
                            sx={{ ml: 1 }}
                          />
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
              )}

              {tabValue === 1 && commands?.troubleshooting && (
                <List dense>
                  {commands.troubleshooting.map((cmd) => {
                    const commandName = typeof cmd === 'string' ? cmd : cmd.name;
                    const commandDesc = typeof cmd === 'object' ? cmd.description : null;
                    return (
                      <ListItem
                        key={commandName}
                        button
                        selected={selectedCommand === commandName}
                        onClick={() => handleCommandSelect(commandName)}
                        sx={{
                          borderRadius: 1,
                          mb: 0.5,
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          '&.Mui-selected': {
                            bgcolor: 'warning.light',
                            '&:hover': {
                              bgcolor: 'warning.light',
                            },
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <Build />
                          </ListItemIcon>
                          <ListItemText 
                            primary={commandName}
                            secondary={commandDesc}
                            primaryTypographyProps={{ fontWeight: selectedCommand === commandName ? 600 : 400 }}
                            secondaryTypographyProps={{ 
                              variant: 'caption',
                              sx: { 
                                mt: 0.5,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }
                            }}
                          />
                          <Chip
                            label="Troubleshooting"
                            color="warning"
                            size="small"
                            sx={{ ml: 1 }}
                          />
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
              )}

              {tabValue === 2 && commands?.additional && (
                <List dense>
                  {commands.additional.map((cmd) => {
                    const commandName = typeof cmd === 'string' ? cmd : cmd.name;
                    const commandDesc = typeof cmd === 'object' ? cmd.description : null;
                    return (
                      <ListItem
                        key={commandName}
                        button
                        selected={selectedCommand === commandName}
                        onClick={() => handleCommandSelect(commandName)}
                        sx={{
                          borderRadius: 1,
                          mb: 0.5,
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          '&.Mui-selected': {
                            bgcolor: 'info.light',
                            '&:hover': {
                              bgcolor: 'info.light',
                            },
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <Code />
                          </ListItemIcon>
                          <ListItemText 
                            primary={commandName}
                            secondary={commandDesc}
                            primaryTypographyProps={{ fontWeight: selectedCommand === commandName ? 600 : 400 }}
                            secondaryTypographyProps={{ 
                              variant: 'caption',
                              sx: { 
                                mt: 0.5,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }
                            }}
                          />
                          <Chip
                            label="Additional"
                            color="info"
                            size="small"
                            sx={{ ml: 1 }}
                          />
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Command Execution Form */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  {selectedCommand ? `Execute: ${selectedCommand}` : 'Select a Command'}
                </Typography>
                {selectedCommand && (
                  <Tooltip title="View Documentation">
                    <IconButton onClick={() => setDocDialogOpen(true)}>
                      <Help />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              <Divider sx={{ mb: 3 }} />

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Organization</InputLabel>
                    <Select
                      value={selectedOrg}
                      label="Organization"
                      onChange={(e) => setSelectedOrg(e.target.value)}
                    >
                      {orgs.map((org) => (
                        <MenuItem key={org.username} value={org.username}>
                          {org.alias || org.username}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Command</InputLabel>
                    <Select
                      value={selectedCommand}
                      label="Command"
                      onChange={(e) => handleCommandSelect(e.target.value)}
                    >
                      {[
                        { key: 'primary', label: 'Primary Commands', cmds: commands?.primary },
                        { key: 'troubleshooting', label: 'Troubleshooting', cmds: commands?.troubleshooting },
                        { key: 'additional', label: 'Additional Commands', cmds: commands?.additional },
                      ].flatMap(({ key, label, cmds }) => {
                        if (!cmds?.length) return [];
                        return [
                          <ListSubheader key={`${key}-header`}>{label}</ListSubheader>,
                          ...cmds.map(cmd => {
                            const commandName = typeof cmd === 'string' ? cmd : cmd.name;
                            const commandDesc = typeof cmd === 'object' ? cmd.description : null;
                            return (
                              <MenuItem key={commandName} value={commandName}>
                                <Box>
                                  <Typography variant="body2">{commandName}</Typography>
                                  {commandDesc && (
                                    <Typography variant="caption" color="text.secondary" display="block">
                                      {commandDesc}
                                    </Typography>
                                  )}
                                </Box>
                              </MenuItem>
                            );
                          }),
                        ];
                      })}
                    </Select>
                  </FormControl>
                </Grid>

                {renderCommandForm()}

                <Grid item xs={12}>
                  <Button
                    variant="contained"
                    startIcon={<PlayArrow />}
                    onClick={handleExecute}
                    disabled={!selectedOrg || !selectedCommand || executing}
                    fullWidth
                    size="large"
                  >
                    {executing ? 'Executing...' : 'Execute Command'}
                  </Button>
                  {executing && (
                    <Box sx={{ mt: 2 }}>
                      <LinearProgress />
                    </Box>
                  )}
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Documentation Dialog */}
      <Dialog open={docDialogOpen} onClose={() => setDocDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Description />
            <Typography variant="h6">{selectedCommand} Documentation</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {commandDoc ? (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Description
              </Typography>
              <Typography variant="body2" paragraph>
                {commandDoc.description}
              </Typography>
              
              {commandDoc.usage && (
                <>
                  <Typography variant="subtitle1" gutterBottom>
                    Usage
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'grey.100', fontFamily: 'monospace', mb: 2 }}>
                    {commandDoc.usage}
                  </Paper>
                </>
              )}

              {commandDoc.parameters && (
                <>
                  <Typography variant="subtitle1" gutterBottom>
                    Parameters
                  </Typography>
                  <List dense>
                    {Object.entries(commandDoc.parameters).map(([key, value]) => (
                      <ListItem key={key}>
                        <ListItemText
                          primary={<strong>{key}</strong>}
                          secondary={value}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
            </Box>
          ) : (
            <Alert severity="info">
              No documentation available for this command.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDocDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Result Dialog */}
      <Dialog open={resultDialogOpen} onClose={() => setResultDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {executionResult?.success ? (
              <CheckCircle color="success" />
            ) : (
              <ErrorIcon color="error" />
            )}
            <Typography variant="h6">
              Execution Result: {selectedCommand}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {executionResult && (
            <Box>
              {executionResult.jobId && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Job ID: {executionResult.jobId}
                </Alert>
              )}

              {executionResult.success ? (
                <>
                  {executionResult.result?.stdout && (
                    <>
                      <Typography variant="subtitle1" gutterBottom>
                        Output
                      </Typography>
                      <Paper sx={{ p: 2, bgcolor: 'grey.100', fontFamily: 'monospace', mb: 2, maxHeight: 400, overflow: 'auto' }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                          {executionResult.result.stdout}
                        </pre>
                      </Paper>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {executionResult.error}
                  </Alert>
                  {executionResult.details && (
                    <Paper sx={{ p: 2, bgcolor: 'error.light', fontFamily: 'monospace', maxHeight: 400, overflow: 'auto' }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {executionResult.details}
                      </pre>
                    </Paper>
                  )}
                </>
              )}

              {executionResult.result?.stderr && (
                <>
                  <Typography variant="subtitle1" gutterBottom>
                    Errors/Warnings
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'warning.light', fontFamily: 'monospace', maxHeight: 400, overflow: 'auto' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                      {executionResult.result.stderr}
                    </pre>
                  </Paper>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResultDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VlocityCommands;

