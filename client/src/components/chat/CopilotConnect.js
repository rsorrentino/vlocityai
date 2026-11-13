import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { GitHub as GitHubIcon, ContentCopy as CopyIcon } from '@mui/icons-material';

const SOURCE_LABELS = {
  user: 'your GitHub account',
  env: 'the server (GITHUB_COPILOT_TOKEN)',
  local: 'the Copilot IDE sign-in on the server machine',
  request: 'the token in these settings',
};

function errorMessage(err, fallback) {
  const data = err?.response?.data;
  return data?.error?.message || data?.error || data?.message || err?.message || fallback;
}

/**
 * "Sign in with GitHub" for the Copilot adapter (OAuth device flow).
 * The GitHub token is stored encrypted on the server for the current user;
 * the browser only ever sees the short user code.
 */
export default function CopilotConnect({ onStatusChange }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState(null); // { userCode, verificationUri, interval }
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef(null);

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/chat/copilot/status');
      setStatus(data);
      onStatusChange?.(data);
    } catch (err) {
      setStatus({ connected: false });
      setError(errorMessage(err, 'Could not check Copilot status'));
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    refreshStatus();
    return stopPolling;
  }, [refreshStatus]);

  const poll = useCallback((intervalSeconds) => {
    stopPolling();
    pollTimer.current = setTimeout(async () => {
      try {
        const { data } = await axios.post('/api/chat/copilot/device/poll');
        if (data.status === 'complete') {
          setFlow(null);
          await refreshStatus();
          return;
        }
        if (data.status === 'pending' || data.status === 'slow_down') {
          poll(data.interval || intervalSeconds);
          return;
        }
        setFlow(null);
        setError(data.message || 'Sign-in did not complete');
      } catch (err) {
        setFlow(null);
        setError(errorMessage(err, 'Sign-in failed'));
      }
    }, Math.max(intervalSeconds, 5) * 1000);
  }, [refreshStatus]);

  const startSignIn = async () => {
    setError('');
    try {
      const { data } = await axios.post('/api/chat/copilot/device/start');
      setFlow(data);
      window.open(data.verificationUri, '_blank', 'noopener,noreferrer');
      poll(data.interval || 5);
    } catch (err) {
      setError(errorMessage(err, 'Could not start GitHub sign-in'));
    }
  };

  const cancelSignIn = () => {
    stopPolling();
    setFlow(null);
  };

  const disconnect = async () => {
    setError('');
    try {
      await axios.delete('/api/chat/copilot');
    } finally {
      refreshStatus();
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available (http) – user can read the code */
    }
  };

  if (loading && !status) {
    return <CircularProgress size={20} />;
  }

  return (
    <Stack spacing={1.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {flow ? (
        <Alert severity="info" icon={<GitHubIcon />}>
          <Typography variant="body2" gutterBottom>
            Enter this code on{' '}
            <Link href={flow.verificationUri} target="_blank" rel="noopener noreferrer">
              {flow.verificationUri}
            </Link>
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1 }}>
            <Typography variant="h5" sx={{ fontFamily: 'monospace', letterSpacing: 2 }}>
              {flow.userCode}
            </Typography>
            <Button size="small" startIcon={<CopyIcon />} onClick={copyCode}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption">Waiting for you to authorize on GitHub…</Typography>
            <Button size="small" onClick={cancelSignIn}>Cancel</Button>
          </Box>
        </Alert>
      ) : status?.connected ? (
        <Alert
          severity="success"
          action={status.source === 'user' ? <Button color="inherit" size="small" onClick={disconnect}>Disconnect</Button> : null}
        >
          Copilot connected{status.accountLogin ? ` as ${status.accountLogin}` : ''} via {SOURCE_LABELS[status.source] || status.source}.
        </Alert>
      ) : (
        <Box>
          {status?.error && <Alert severity="warning" sx={{ mb: 1 }}>{status.error}</Alert>}
          <Button variant="contained" startIcon={<GitHubIcon />} onClick={startSignIn}>
            Sign in with GitHub
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Requires a GitHub account with an active Copilot subscription. Your token is stored
            encrypted on the server for your user only.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
