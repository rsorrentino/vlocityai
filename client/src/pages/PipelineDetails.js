import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Grid, Chip,
  Alert, CircularProgress, LinearProgress, Divider,
  Stepper, Step, StepLabel, StepContent
} from '@mui/material';
import {
  ArrowBack, PlayArrow, Stop, CheckCircle, HourglassTop,
  ThumbUp
} from '@mui/icons-material';
import axios from 'axios';

const stageStatusIcon = (status) => {
  switch (status) {
    case 'completed': return <CheckCircle color="success" />;
    case 'awaiting_approval': return <HourglassTop color="warning" />;
    case 'running': return <CircularProgress size={20} />;
    case 'failed': return <Stop color="error" />;
    default: return null;
  }
};

const stageStatusColor = (status) => {
  switch (status) {
    case 'completed': return 'success';
    case 'awaiting_approval': return 'warning';
    case 'running': return 'primary';
    case 'failed': return 'error';
    default: return 'default';
  }
};

const PipelineDetails = () => {
  const { pipelineId } = useParams();
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await axios.get(`/api/pipelines/${pipelineId}`);
      setPipeline(res.data.pipeline);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  // Poll while running
  useEffect(() => {
    if (!pipeline) return;
    if (!['running', 'paused_awaiting_approval'].includes(pipeline.status)) return;
    const timer = setInterval(fetchPipeline, 5000);
    return () => clearInterval(timer);
  }, [pipeline, fetchPipeline]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await axios.post(`/api/pipelines/${pipelineId}/start`);
      fetchPipeline();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAbort = async () => {
    setActionLoading(true);
    try {
      await axios.post(`/api/pipelines/${pipelineId}/abort`, { reason: 'Aborted by user' });
      fetchPipeline();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (stageIndex) => {
    setActionLoading(true);
    try {
      await axios.post(`/api/pipelines/${pipelineId}/stages/${stageIndex}/approve`);
      fetchPipeline();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;
  if (!pipeline) return <Alert severity="error">Pipeline not found</Alert>;

  const isRunning = ['running', 'paused_awaiting_approval'].includes(pipeline.status);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button onClick={() => navigate('/pipeline')} startIcon={<ArrowBack />} size="small">
            Pipelines
          </Button>
          <Typography variant="h4">{pipeline.name}</Typography>
        </Box>
        <Chip
          label={pipeline.status?.replace(/_/g, ' ')}
          color={stageStatusColor(pipeline.status)}
          sx={{ textTransform: 'capitalize' }}
        />
        {['idle', 'completed', 'failed', 'aborted'].includes(pipeline.status) && (
          <Button
            variant="contained"
            startIcon={actionLoading ? <CircularProgress size={18} /> : <PlayArrow />}
            onClick={handleStart}
            disabled={actionLoading}
          >
            Start
          </Button>
        )}
        {isRunning && (
          <Button
            variant="outlined"
            color="error"
            startIcon={<Stop />}
            onClick={handleAbort}
            disabled={actionLoading}
          >
            Abort
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {pipeline.description && (
        <Typography color="text.secondary" sx={{ mb: 3 }}>{pipeline.description}</Typography>
      )}

      {isRunning && <LinearProgress sx={{ mb: 3, borderRadius: 2 }} />}

      {/* Stages */}
      <Stepper orientation="vertical" nonLinear activeStep={pipeline.currentStageIndex}>
        {pipeline.stages.map((stage, index) => (
          <Step key={index} completed={stage.status === 'completed'}>
            <StepLabel
              icon={stageStatusIcon(stage.status) || (index + 1)}
              optional={
                <Chip
                  label={stage.status?.replace(/_/g, ' ') || 'pending'}
                  color={stageStatusColor(stage.status)}
                  size="small"
                  sx={{ textTransform: 'capitalize' }}
                />
              }
            >
              <Typography fontWeight="medium">{stage.name}</Typography>
            </StepLabel>
            <StepContent>
              <Card variant="outlined" sx={{ mb: 1 }}><CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" color="text.secondary">Target Org</Typography>
                    <Typography variant="body2">{stage.targetOrg || '—'}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" color="text.secondary">Export Path</Typography>
                    <Typography variant="body2">{stage.exportPath || './export'}</Typography>
                  </Grid>
                  {stage.preValidationResult && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">Pre-validation</Typography>
                      <Chip label={stage.preValidationResult.status} size="small" sx={{ ml: 1 }} />
                    </Grid>
                  )}
                  {stage.deployJobId && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">Deploy Job</Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {stage.deployJobId}
                      </Typography>
                    </Grid>
                  )}
                  {stage.postValidationResult && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">Post-validation</Typography>
                      <Chip label={stage.postValidationResult.status} size="small" sx={{ ml: 1 }} />
                    </Grid>
                  )}
                  {stage.approvedBy && (
                    <Grid item xs={12}>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="caption" color="success.main">
                        Approved by {stage.approvedBy} at {stage.approvedAt ? new Date(stage.approvedAt).toLocaleString() : ''}
                      </Typography>
                    </Grid>
                  )}
                </Grid>

                {stage.status === 'awaiting_approval' && (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      Stage complete — review results and approve to continue to the next stage.
                    </Alert>
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={actionLoading ? <CircularProgress size={18} /> : <ThumbUp />}
                      onClick={() => handleApprove(index)}
                      disabled={actionLoading}
                    >
                      Approve &amp; Proceed
                    </Button>
                  </Box>
                )}
              </CardContent></Card>
            </StepContent>
          </Step>
        ))}
      </Stepper>

      {pipeline.status === 'completed' && (
        <Alert severity="success" sx={{ mt: 3 }}>
          Pipeline completed successfully. All {pipeline.stages.length} stages executed and approved.
        </Alert>
      )}
      {pipeline.status === 'failed' && (
        <Alert severity="error" sx={{ mt: 3 }}>
          Pipeline failed. Review the stage details above for error information.
        </Alert>
      )}
    </Box>
  );
};

export default PipelineDetails;
