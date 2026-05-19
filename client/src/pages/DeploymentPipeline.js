import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Grid, Chip,
  Alert, CircularProgress, IconButton, Tooltip, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import {
  Add, PlayArrow, Stop, Delete, Visibility, AccountTree
} from '@mui/icons-material';
import axios from 'axios';

const statusColor = (status) => {
  switch (status) {
    case 'running': return 'primary';
    case 'paused_awaiting_approval': return 'warning';
    case 'completed': return 'success';
    case 'failed': return 'error';
    case 'aborted': return 'default';
    default: return 'default';
  }
};

const statusLabel = (s) => s?.replace(/_/g, ' ') || 'idle';

const DeploymentPipeline = () => {
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPipeline, setNewPipeline] = useState({ name: '', description: '', stages: [{ name: 'Deploy to UAT', targetOrg: '', exportPath: './export' }] });
  const [creating, setCreating] = useState(false);

  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/pipelines');
      setPipelines(res.data.pipelines || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPipelines(); }, [fetchPipelines]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await axios.post('/api/pipelines', newPipeline);
      setCreateOpen(false);
      setNewPipeline({ name: '', description: '', stages: [{ name: 'Deploy to UAT', targetOrg: '', exportPath: './export' }] });
      fetchPipelines();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (id) => {
    try {
      await axios.post(`/api/pipelines/${id}/start`);
      fetchPipelines();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleAbort = async (id) => {
    try {
      await axios.post(`/api/pipelines/${id}/abort`, { reason: 'Aborted by user' });
      fetchPipelines();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/api/pipelines/${id}`);
      fetchPipelines();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const addStage = () => {
    setNewPipeline(prev => ({
      ...prev,
      stages: [...prev.stages, { name: `Stage ${prev.stages.length + 1}`, targetOrg: '', exportPath: './export' }]
    }));
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Deployment Pipelines</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>
          New Pipeline
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {pipelines.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <AccountTree sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography color="text.secondary" gutterBottom>No pipelines yet.</Typography>
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>
            Create Your First Pipeline
          </Button>
        </Box>
      ) : (
        <Card>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Stages</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last Run</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pipelines.map((pipeline) => (
                <TableRow key={pipeline.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">{pipeline.name}</Typography>
                    {pipeline.description && (
                      <Typography variant="caption" color="text.secondary">{pipeline.description}</Typography>
                    )}
                  </TableCell>
                  <TableCell>{pipeline.stages?.length || 0}</TableCell>
                  <TableCell>
                    <Chip
                      label={statusLabel(pipeline.status)}
                      color={statusColor(pipeline.status)}
                      size="small"
                      sx={{ textTransform: 'capitalize' }}
                    />
                  </TableCell>
                  <TableCell>
                    {pipeline.lastRunAt ? new Date(pipeline.lastRunAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="View">
                      <IconButton size="small" onClick={() => navigate(`/pipeline/${pipeline.id}`)}>
                        <Visibility />
                      </IconButton>
                    </Tooltip>
                    {['idle', 'completed', 'failed', 'aborted'].includes(pipeline.status) && (
                      <Tooltip title="Start">
                        <IconButton size="small" color="primary" onClick={() => handleStart(pipeline.id)}>
                          <PlayArrow />
                        </IconButton>
                      </Tooltip>
                    )}
                    {['running', 'paused_awaiting_approval'].includes(pipeline.status) && (
                      <Tooltip title="Abort">
                        <IconButton size="small" color="error" onClick={() => handleAbort(pipeline.id)}>
                          <Stop />
                        </IconButton>
                      </Tooltip>
                    )}
                    {['idle', 'completed', 'failed', 'aborted'].includes(pipeline.status) && (
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => handleDelete(pipeline.id)}>
                          <Delete />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Create Pipeline Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Deployment Pipeline</DialogTitle>
        <DialogContent>
          <TextField
            label="Pipeline Name"
            fullWidth
            value={newPipeline.name}
            onChange={(e) => setNewPipeline(prev => ({ ...prev, name: e.target.value }))}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            label="Description (optional)"
            fullWidth
            multiline
            rows={2}
            value={newPipeline.description}
            onChange={(e) => setNewPipeline(prev => ({ ...prev, description: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <Typography variant="subtitle2" gutterBottom>Stages</Typography>
          {newPipeline.stages.map((stage, i) => (
            <Grid container spacing={1} key={i} sx={{ mb: 1 }}>
              <Grid item xs={4}>
                <TextField
                  label={`Stage ${i + 1} Name`}
                  fullWidth
                  size="small"
                  value={stage.name}
                  onChange={(e) => {
                    const stages = [...newPipeline.stages];
                    stages[i] = { ...stages[i], name: e.target.value };
                    setNewPipeline(prev => ({ ...prev, stages }));
                  }}
                />
              </Grid>
              <Grid item xs={8}>
                <TextField
                  label="Target Org (username)"
                  fullWidth
                  size="small"
                  value={stage.targetOrg}
                  onChange={(e) => {
                    const stages = [...newPipeline.stages];
                    stages[i] = { ...stages[i], targetOrg: e.target.value };
                    setNewPipeline(prev => ({ ...prev, stages }));
                  }}
                />
              </Grid>
            </Grid>
          ))}
          <Button size="small" onClick={addStage} startIcon={<Add />}>Add Stage</Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={!newPipeline.name || creating}
            startIcon={creating ? <CircularProgress size={18} /> : null}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DeploymentPipeline;
