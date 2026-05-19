import React, { useState, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Grid, Chip,
  LinearProgress, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Alert, CircularProgress,
  TextField, Accordion, AccordionSummary, AccordionDetails,
  Tooltip, IconButton
} from '@mui/material';
import {
  ExpandMore, CheckCircle, Warning, Error, Refresh,
  Download, HealthAndSafety
} from '@mui/icons-material';
import axios from 'axios';

const scoreColor = (score) => {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
};

const deployabilityLabel = (d) => {
  switch (d) {
    case 'deployable': return { label: 'Deployable', color: 'success', icon: <CheckCircle /> };
    case 'caution': return { label: 'Caution', color: 'warning', icon: <Warning /> };
    default: return { label: 'Not Ready', color: 'error', icon: <Error /> };
  }
};

const statusIcon = (status) => {
  switch (status) {
    case 'present': return <CheckCircle color="success" fontSize="small" />;
    case 'missing': return <Error color="error" fontSize="small" />;
    default: return <Warning color="warning" fontSize="small" />;
  }
};

const ExportHealthPage = () => {
  const [exportPath, setExportPath] = useState('./export');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/export-health/scan', {
        params: { exportPath }
      });
      setReport(res.data.report);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [exportPath]);

  const handleDownload = (format) => {
    const jobId = 'manual';
    window.open(`/api/export-health/report/${jobId}?format=${format}&exportPath=${encodeURIComponent(exportPath)}`, '_blank');
  };

  const deployBadge = report ? deployabilityLabel(report.deployability) : null;
  const color = report ? scoreColor(report.healthScore) : 'primary';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Export Health</Typography>
      </Box>

      {/* Scan Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              label="Export Path"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              placeholder="./export"
            />
            <Button
              variant="contained"
              onClick={handleScan}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} /> : <Refresh />}
            >
              {loading ? 'Scanning...' : 'Scan Now'}
            </Button>
            {report && (
              <>
                <Tooltip title="Download JSON report">
                  <IconButton onClick={() => handleDownload('json')}>
                    <Download />
                  </IconButton>
                </Tooltip>
                <Button size="small" variant="outlined" onClick={() => handleDownload('csv')}>
                  CSV
                </Button>
              </>
            )}
          </Box>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {report && (
        <>
          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ textAlign: 'center', p: 2 }}>
                <Typography variant="h4" color={`${color}.main`} fontWeight="bold">
                  {report.healthScore}
                </Typography>
                <Typography variant="caption" color="text.secondary">Health Score</Typography>
                <LinearProgress
                  variant="determinate"
                  value={report.healthScore}
                  color={color}
                  sx={{ mt: 1, height: 6, borderRadius: 3 }}
                />
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ textAlign: 'center', p: 2 }}>
                {deployBadge && (
                  <>
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                      <Chip
                        icon={deployBadge.icon}
                        label={deployBadge.label}
                        color={deployBadge.color}
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary">Deployability</Typography>
                  </>
                )}
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ textAlign: 'center', p: 2 }}>
                <Typography variant="h4" fontWeight="bold">
                  {report.summary?.exportedTypes || 0}
                  <Typography component="span" variant="body2" color="text.secondary">
                    /{report.summary?.expectedTypes || 0}
                  </Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary">Types Coverage</Typography>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ textAlign: 'center', p: 2 }}>
                <Typography variant="h4" color={report.summary?.crossRefIssues > 0 ? 'error.main' : 'success.main'} fontWeight="bold">
                  {report.summary?.crossRefIssues || 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">Cross-Ref Issues</Typography>
              </Card>
            </Grid>
          </Grid>

          {/* DataPack Coverage */}
          {report.coverage?.length > 0 && (
            <Accordion defaultExpanded sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography fontWeight="medium">DataPack Coverage ({report.coverage.length} types)</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Records</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Expected</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.coverage.map((row) => (
                        <TableRow key={row.type} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{row.type}</TableCell>
                          <TableCell align="right">{row.count.toLocaleString()}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              {statusIcon(row.status)}
                              <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>{row.status}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            {row.isExpectedType
                              ? <CheckCircle color="success" fontSize="small" />
                              : <Typography variant="caption" color="text.secondary">Custom</Typography>
                            }
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          )}

          {/* Cross-reference Issues */}
          {report.crossRefIssues?.length > 0 && (
            <Accordion sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography fontWeight="medium">
                  Cross-Reference Issues ({report.crossRefIssues.length})
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <Alert severity="warning" sx={{ m: 1 }}>
                  These records reference DataPack types not present in the export directory.
                  Add the missing types to your export job to resolve them.
                </Alert>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 350, m: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Source Record</TableCell>
                        <TableCell>Referenced Type</TableCell>
                        <TableCell>Referenced Name</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.crossRefIssues.map((issue, i) => (
                        <TableRow key={i} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{issue.source}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{issue.referencedType}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{issue.referencedName}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          )}

          {/* Missing Types */}
          {report.missingTypes?.length > 0 && (
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography fontWeight="medium">
                  Missing Expected Types ({report.missingTypes.length})
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Alert severity="info" sx={{ mb: 1 }}>
                  These standard DataPack types were not found in the export directory.
                </Alert>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {report.missingTypes.map((t) => (
                    <Chip key={t} label={t} size="small" variant="outlined" color="default" />
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            Scanned: {report.scannedAt ? new Date(report.scannedAt).toLocaleString() : ''}
            {' '}&bull;{' '}{report.exportPath}
          </Typography>
        </>
      )}

      {!report && !loading && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <HealthAndSafety sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography color="text.secondary">
            Enter an export path and click "Scan Now" to analyze your export directory.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default ExportHealthPage;
