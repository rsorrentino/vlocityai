import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';

const fmt = new Intl.NumberFormat();

export function formatCost(costUsd) {
  if (costUsd === null || costUsd === undefined) return '—';
  if (costUsd === 0) return '$0';
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
}

/** AI usage and estimated cost for the current user (admins: everyone). */
export default function UsageDialog({ open, onClose }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [days, setDays] = useState(30);
  const [everyone, setEveryone] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError('');
    axios.get('/api/chat/usage', { params: { days, scope: everyone ? 'all' : 'me' } })
      .then((r) => setData(r.data))
      .catch((err) => setError(err?.response?.data?.error?.message || err.message));
  }, [open, days, everyone]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>AI usage</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <Select size="small" value={days} onChange={(e) => setDays(e.target.value)}>
            {[7, 30, 90, 365].map((d) => <MenuItem key={d} value={d}>Last {d} days</MenuItem>)}
          </Select>
          {isAdmin && (
            <FormControlLabel control={<Switch checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />} label="All users" />
          )}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {!data && !error && <CircularProgress size={24} />}
        {data && (
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>{fmt.format(data.totals.messages)}</strong> answers •{' '}
              <strong>{fmt.format(data.totals.inputTokens)}</strong> input /{' '}
              <strong>{fmt.format(data.totals.outputTokens)}</strong> output tokens • estimated{' '}
              <strong>{formatCost(data.totals.costUsd)}</strong>
            </Typography>
            {data.totals.unpricedMessages > 0 && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {data.totals.unpricedMessages} answer(s) used a model without a configured price and are not included
                in the estimate. Administrators can add prices in <code>data/ai-pricing.json</code>.
              </Alert>
            )}
            <Table size="small">
              <TableHead>
                <TableRow>
                  {everyone && <TableCell>User</TableCell>}
                  <TableCell>Adapter</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell align="right">Answers</TableCell>
                  <TableCell align="right">Input tokens</TableCell>
                  <TableCell align="right">Output tokens</TableCell>
                  <TableCell align="right">Est. cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.byModel.map((r) => (
                  <TableRow key={`${r.userId}-${r.adapter}-${r.model}`}>
                    {everyone && <TableCell><code>{r.userId.slice(0, 8)}</code></TableCell>}
                    <TableCell>{r.adapter}</TableCell>
                    <TableCell>{r.model}</TableCell>
                    <TableCell align="right">{fmt.format(r.messages)}</TableCell>
                    <TableCell align="right">{fmt.format(r.inputTokens)}</TableCell>
                    <TableCell align="right">{fmt.format(r.outputTokens)}</TableCell>
                    <TableCell align="right">{r.adapter === 'copilot' ? 'Copilot plan' : formatCost(r.costUsd)}</TableCell>
                  </TableRow>
                ))}
                {data.byModel.length === 0 && (
                  <TableRow><TableCell colSpan={7}><em>No AI usage in this period.</em></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Costs are estimates from list prices; your provider’s invoice is authoritative.
            </Typography>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
