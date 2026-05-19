import React, { useState, useEffect } from 'react';
import {
  Box, Card, Typography, Grid, Chip, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Paper, Button,
  Alert, CircularProgress, Tooltip, IconButton
} from '@mui/material';
import {
  ExpandMore, CheckCircle, Error, Warning, Download, Info
} from '@mui/icons-material';
import axios from 'axios';

const statusColor = (successRate) => {
  if (successRate >= 80) return 'success';
  if (successRate >= 50) return 'warning';
  return 'error';
};

const statusIcon = (status) => {
  switch (status) {
    case 'complete': return <CheckCircle color="success" fontSize="small" />;
    case 'blocked': return <Error color="error" fontSize="small" />;
    case 'remaining': return <Warning color="warning" fontSize="small" />;
    default: return <Info color="info" fontSize="small" />;
  }
};

const SummaryCard = ({ label, value, color }) => (
  <Card variant="outlined" sx={{ textAlign: 'center', p: 1 }}>
    <Typography variant="h5" color={`${color}.main`} fontWeight="bold">
      {typeof value === 'number' ? value.toLocaleString() : value}
    </Typography>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
  </Card>
);

const BuildLogAnalyzer = ({ jobId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    axios.get(`/api/exports/${jobId}/build-analysis`)
      .then(res => {
        setAnalysis(res.data.analysis);
        setLoading(false);
      })
      .catch(err => {
        const msg = err.response?.data?.message || err.message;
        setError(msg);
        setLoading(false);
      });
  }, [jobId]);

  const handleDownload = (format) => {
    const url = format === 'csv'
      ? `/api/exports/${jobId}/build-analysis?format=csv`
      : `/api/exports/${jobId}/build-analysis?download=true`;
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="info" sx={{ mt: 1 }}>
        Build analysis not available: {error}
      </Alert>
    );
  }

  if (!analysis) return null;

  const { summary, byType, errorCategories, missingReferences } = analysis;
  const color = statusColor(summary?.successRate || 0);

  return (
    <Box>
      {/* Header row */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {summary?.org && `Org: ${summary.org}`}
          {summary?.duration && ` • Duration: ${summary.duration}`}
          {summary?.packageVersion && ` • Package: ${summary.packageVersion}`}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Download JSON">
            <IconButton size="small" onClick={() => handleDownload('json')}>
              <Download fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button size="small" variant="outlined" onClick={() => handleDownload('csv')}>
            CSV
          </Button>
        </Box>
      </Box>

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <SummaryCard label="Exported" value={summary?.success || 0} color="success" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard label="Errors" value={summary?.error || 0} color="error" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard label="Remaining" value={summary?.remaining || 0} color="warning" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard label="Health Score" value={`${summary?.successRate || 0}%`} color={color} />
        </Grid>
      </Grid>

      {/* Health bar */}
      <Box sx={{ mb: 3 }}>
        <LinearProgress
          variant="determinate"
          value={summary?.successRate || 0}
          color={color}
          sx={{ height: 10, borderRadius: 5 }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {summary?.total?.toLocaleString()} total records
          </Typography>
          <Chip
            label={`${summary?.successRate || 0}% success`}
            color={color}
            size="small"
          />
        </Box>
      </Box>

      {/* By DataPack Type */}
      {byType?.length > 0 && (
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography fontWeight="medium">By DataPack Type ({byType.length})</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">Exported</TableCell>
                    <TableCell align="right">Errors</TableCell>
                    <TableCell align="right">Remaining</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {byType.map((row) => (
                    <TableRow key={row.type} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{row.type}</TableCell>
                      <TableCell align="right" sx={{ color: row.success > 0 ? 'success.main' : 'inherit' }}>
                        {row.success.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ color: row.error > 0 ? 'error.main' : 'inherit' }}>
                        {row.error.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ color: row.remaining > 0 ? 'warning.main' : 'inherit' }}>
                        {row.remaining.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {statusIcon(row.status)}
                          <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>
                            {row.status}
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Error Categories */}
      {errorCategories?.length > 0 && (
        <Accordion sx={{ mt: 1 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography fontWeight="medium">
              Error Categories ({errorCategories.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {errorCategories.map((cat) => (
              <Accordion key={cat.category} variant="outlined" sx={{ mb: 1 }}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <Typography flex={1}>{cat.category}</Typography>
                    <Chip label={cat.count.toLocaleString()} size="small" color="error" />
                    {cat.types?.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        ({cat.types.join(', ')})
                      </Typography>
                    )}
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Alert severity="info" sx={{ mb: 1 }}>
                    <strong>Remediation:</strong> {cat.remediation}
                  </Alert>
                  {cat.examples?.length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                        Examples:
                      </Typography>
                      {cat.examples.map((ex, i) => (
                        <Typography
                          key={i}
                          variant="caption"
                          component="pre"
                          sx={{
                            display: 'block',
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            bgcolor: 'grey.100',
                            p: 1,
                            borderRadius: 1,
                            mb: 0.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all'
                          }}
                        >
                          {ex}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            ))}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Missing References */}
      {missingReferences?.length > 0 && (
        <Accordion sx={{ mt: 1 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography fontWeight="medium">
              Missing Cross-References ({missingReferences.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Source</TableCell>
                    <TableCell>Referenced Type</TableCell>
                    <TableCell>Referenced Name</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {missingReferences.slice(0, 200).map((ref, i) => (
                    <TableRow key={i} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{ref.source}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{ref.referencedType}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{ref.referencedName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {missingReferences.length > 200 && (
              <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>
                Showing 200 of {missingReferences.length} missing references
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
};

export default BuildLogAnalyzer;
