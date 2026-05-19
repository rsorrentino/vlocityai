import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Tabs, Tab, Box, Tooltip, IconButton, Typography, Stack,
} from '@mui/material';
import { ContentCopy, Download, Check } from '@mui/icons-material';

function TabPanel({ children, value, index }) {
  return (
    <Box role="tabpanel" hidden={value !== index} sx={{ pt: 1 }}>
      {value === index && children}
    </Box>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
      <IconButton size="small" onClick={handleCopy} color={copied ? 'success' : 'default'}>
        {copied ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}

/**
 * PreviewDialog — shows the generated export.json and CLI command before running.
 *
 * Props:
 *   open            boolean
 *   exportJson      object   — the raw export.json payload
 *   cliCommand      string   — e.g. "sf sfdmu run --sourceusername ..."
 *   onClose         fn
 */
const PreviewDialog = ({ open, exportJson, cliCommand, onClose }) => {
  const [tab, setTab] = useState(0);

  const jsonText = JSON.stringify(exportJson || {}, null, 2);

  const handleDownload = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Preview</DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tab label="export.json" />
          <Tab label="CLI Command" />
        </Tabs>

        {/* ── export.json ────────────────────────────────────────────────── */}
        <TabPanel value={tab} index={0}>
          <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={1} sx={{ px: 2, pt: 1 }}>
            <CopyButton text={jsonText} />
            <Tooltip title="Download export.json">
              <IconButton size="small" onClick={handleDownload}>
                <Download fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Box sx={{ px: 2, pb: 2 }}>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 2,
                bgcolor: 'grey.900',
                color: 'grey.100',
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: 420,
                fontSize: '0.78rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre',
              }}
            >
              {jsonText}
            </Box>
          </Box>
        </TabPanel>

        {/* ── CLI Command ─────────────────────────────────────────────────── */}
        <TabPanel value={tab} index={1}>
          <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={1} sx={{ px: 2, pt: 1 }}>
            <CopyButton text={cliCommand || ''} />
          </Stack>
          <Box sx={{ px: 2, pb: 2 }}>
            {cliCommand ? (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 2,
                  bgcolor: 'grey.900',
                  color: 'lightgreen',
                  borderRadius: 1,
                  overflow: 'auto',
                  fontSize: '0.82rem',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {cliCommand}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Select source and target orgs to see the CLI command.
              </Typography>
            )}
          </Box>
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default PreviewDialog;
