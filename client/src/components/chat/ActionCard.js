import React, { useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { EditNote as EditNoteIcon } from '@mui/icons-material';

const STATUS = {
  pending: { label: 'Waiting for your approval', color: 'warning' },
  applying: { label: 'Applying…', color: 'info' },
  applied: { label: 'Applied', color: 'success' },
  rejected: { label: 'Rejected', color: 'default' },
  failed: { label: 'Failed', color: 'error' },
};

function show(value) {
  if (value === null || value === undefined) return <em>empty</em>;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function errorMessage(err) {
  const data = err?.response?.data;
  return data?.error?.message || data?.error || err?.message || 'Request failed';
}

/**
 * A change proposed by the AI assistant. Nothing is written to Salesforce
 * until the user approves it here.
 */
export default function ActionCard({ action, onDecided }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const args = action.args || {};
  const before = args.before || null;
  const status = STATUS[action.status] || { label: action.status, color: 'default' };

  const decide = async (approve) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post(`/api/chat/actions/${action.id}/${approve ? 'approve' : 'reject'}`);
      onDecided?.(data.action);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, borderColor: action.status === 'pending' ? 'warning.main' : 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <EditNoteIcon color="warning" />
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          Proposed change: {args.sobject} {args.recordName ? `“${args.recordName}”` : ''} <code>{args.recordId}</code>
        </Typography>
        <Chip size="small" color={status.color} label={status.label} />
      </Box>
      {args.reason && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {args.reason}
        </Typography>
      )}
      <Table size="small" sx={{ mb: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Field</TableCell>
            <TableCell>Current</TableCell>
            <TableCell>Proposed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {Object.entries(args.fields || {}).map(([field, value]) => (
            <TableRow key={field}>
              <TableCell><code>{field}</code></TableCell>
              <TableCell>{before ? show(before[field]) : <em>unknown</em>}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{show(value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary" display="block">
        Org: {action.orgUsername || 'selected org'}
        {action.decidedBy ? ` • ${action.status} by ${action.decidedBy}` : ''}
      </Typography>
      {action.status === 'failed' && action.result?.error && (
        <Alert severity="error" sx={{ mt: 1 }}>{action.result.error}</Alert>
      )}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {action.status === 'pending' && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button variant="contained" color="warning" onClick={() => decide(true)} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : 'Approve and apply'}
          </Button>
          <Button variant="outlined" onClick={() => decide(false)} disabled={busy}>
            Reject
          </Button>
        </Stack>
      )}
    </Paper>
  );
}
