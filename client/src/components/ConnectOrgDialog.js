import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';

const LOGIN_URLS = [
  { value: 'https://login.salesforce.com', label: 'Production / Developer' },
  { value: 'https://test.salesforce.com', label: 'Sandbox' },
  { value: 'custom', label: 'My Domain…' },
];

const ENVIRONMENTS = ['', 'dev', 'sit', 'qa', 'uat', 'staging', 'training', 'prod'];

function errorMessage(err, fallback) {
  const data = err?.response?.data;
  return data?.error?.message || data?.error || data?.message || err?.message || fallback;
}

/**
 * Authorise a Salesforce org from the browser. Works when the server runs on
 * another machine or in Docker (unlike `sf org login web`).
 */
export default function ConnectOrgDialog({ open, onClose, onConnected }) {
  const [tab, setTab] = useState(0);
  const [loginChoice, setLoginChoice] = useState(LOGIN_URLS[0].value);
  const [customUrl, setCustomUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [label, setLabel] = useState('');
  const [environment, setEnvironment] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [jwt, setJwt] = useState({ clientId: '', username: '', privateKey: '' });
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const loginUrl = loginChoice === 'custom' ? customUrl : loginChoice;

  const stopPolling = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  const reset = () => {
    stopPolling();
    setFlow(null);
    setBusy(false);
    setError('');
    setAuthUrl('');
    setJwt({ clientId: '', username: '', privateKey: '' });
  };

  const close = () => {
    if (flow) axios.delete('/api/org-auth/device').catch(() => {});
    reset();
    onClose();
  };

  const done = (org) => {
    reset();
    onConnected?.(org);
    onClose();
  };

  const common = () => ({ alias: alias || undefined, label: label || undefined, environment: environment || undefined });

  const poll = (interval) => {
    stopPolling();
    timer.current = setTimeout(async () => {
      try {
        const { data } = await axios.post('/api/org-auth/device/poll');
        if (data.status === 'complete') return done(data.org);
        if (data.status === 'pending' || data.status === 'slow_down') return poll(data.interval || interval);
        setFlow(null);
        setBusy(false);
        setError(data.message || 'Sign-in did not complete');
      } catch (err) {
        setFlow(null);
        setBusy(false);
        setError(errorMessage(err, 'Sign-in failed'));
      }
    }, Math.max(interval, 5) * 1000);
  };

  const startDevice = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/org-auth/device/start', { loginUrl, ...common() });
      setFlow(data);
      window.open(data.verificationUri, '_blank', 'noopener,noreferrer');
      poll(data.interval || 5);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err, 'Could not start Salesforce sign-in'));
    }
  };

  const submit = async (endpoint, body) => {
    setError('');
    setBusy(true);
    try {
      const { data } = await axios.post(endpoint, { ...body, ...common() });
      done(data.org);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err, 'Authorisation failed'));
    }
  };

  const copyCode = () => navigator.clipboard?.writeText(flow.userCode).catch(() => {});

  const commonFields = (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField label="Alias (optional)" size="small" value={alias} onChange={(e) => setAlias(e.target.value)} fullWidth />
      <TextField label="Display name (optional)" size="small" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth />
      <FormControl size="small" fullWidth>
        <InputLabel>Environment</InputLabel>
        <Select label="Environment" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
          {ENVIRONMENTS.map((env) => (
            <MenuItem key={env || 'none'} value={env}>{env || <em>None</em>}</MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );

  const loginUrlField = (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel>Org type</InputLabel>
        <Select label="Org type" value={loginChoice} onChange={(e) => setLoginChoice(e.target.value)}>
          {LOGIN_URLS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </Select>
      </FormControl>
      {loginChoice === 'custom' && (
        <TextField
          label="My Domain URL"
          size="small"
          placeholder="https://mycompany--uat.sandbox.my.salesforce.com"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          fullWidth
        />
      )}
    </Stack>
  );

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>Connect a Salesforce org</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setError(''); }} sx={{ mb: 2 }} variant="scrollable">
          <Tab label="Sign in with Salesforce" disabled={Boolean(flow)} />
          <Tab label="SFDX auth URL" disabled={Boolean(flow)} />
          <Tab label="JWT (connected app)" disabled={Boolean(flow)} />
        </Tabs>

        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          {tab === 0 && (flow ? (
            <Alert severity="info">
              <Typography variant="body2" gutterBottom>
                Open <Link href={flow.verificationUri} target="_blank" rel="noopener noreferrer">{flow.verificationUri}</Link>,
                log in to the org and enter this code:
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1 }}>
                <Typography variant="h5" sx={{ fontFamily: 'monospace', letterSpacing: 2 }}>{flow.userCode}</Typography>
                <Button size="small" startIcon={<CopyIcon />} onClick={copyCode}>Copy</Button>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="caption">Waiting for you to approve access in Salesforce…</Typography>
              </Box>
            </Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                Works from any browser, even when the server runs elsewhere or in Docker. You will log in to
                Salesforce in a new tab and approve access for the Salesforce CLI.
              </Typography>
              {loginUrlField}
              {commonFields}
            </>
          ))}

          {tab === 1 && (
            <>
              <Typography variant="body2" color="text.secondary">
                On a machine where the org is already authorised, run
                {' '}<code>sf org display --target-org &lt;alias&gt; --verbose</code>{' '}
                and paste the <strong>Sfdx Auth Url</strong> value (it starts with <code>force://</code>).
                It is passed to the Salesforce CLI on the server and not stored by this app.
              </Typography>
              <TextField
                label="SFDX auth URL"
                type="password"
                autoComplete="off"
                value={authUrl}
                onChange={(e) => setAuthUrl(e.target.value)}
                fullWidth
                size="small"
              />
              {commonFields}
            </>
          )}

          {tab === 2 && (
            <>
              <Typography variant="body2" color="text.secondary">
                For integration users: a connected app with a certificate and pre-authorised users.
              </Typography>
              {loginUrlField}
              <TextField label="Consumer key" size="small" value={jwt.clientId} onChange={(e) => setJwt((j) => ({ ...j, clientId: e.target.value }))} fullWidth />
              <TextField label="Username" size="small" value={jwt.username} onChange={(e) => setJwt((j) => ({ ...j, username: e.target.value }))} fullWidth />
              <TextField
                label="Private key (PEM)"
                multiline
                minRows={4}
                value={jwt.privateKey}
                onChange={(e) => setJwt((j) => ({ ...j, privateKey: e.target.value }))}
                placeholder="-----BEGIN PRIVATE KEY-----"
                fullWidth
                inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
              />
              {commonFields}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{flow ? 'Cancel sign-in' : 'Cancel'}</Button>
        {tab === 0 && !flow && (
          <Button variant="contained" onClick={startDevice} disabled={busy || (loginChoice === 'custom' && !customUrl)}>
            {busy ? <CircularProgress size={20} /> : 'Sign in'}
          </Button>
        )}
        {tab === 1 && (
          <Button variant="contained" onClick={() => submit('/api/org-auth/sfdx-url', { authUrl })} disabled={busy || !authUrl}>
            {busy ? <CircularProgress size={20} /> : 'Connect'}
          </Button>
        )}
        {tab === 2 && (
          <Button
            variant="contained"
            onClick={() => submit('/api/org-auth/jwt', { ...jwt, loginUrl })}
            disabled={busy || !jwt.clientId || !jwt.username || !jwt.privateKey}
          >
            {busy ? <CircularProgress size={20} /> : 'Connect'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
