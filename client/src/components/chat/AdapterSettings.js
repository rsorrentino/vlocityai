import React, { useState, useEffect } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Tooltip,
  IconButton,
  Chip,
} from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';

const ADAPTERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-6' },
  { value: 'openai',    label: 'OpenAI (GPT-4o)',    defaultModel: 'gpt-4o' },
  { value: 'copilot',   label: 'GitHub Copilot',     defaultModel: 'gpt-4o' },
  { value: 'ollama',    label: 'Ollama (local)',      defaultModel: 'llama3.2' },
];

const STORAGE_KEY = 'vlocity_chat_adapter_config';

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function useAdapterConfig() {
  const [config, setConfig] = useState(loadConfig);

  const update = (patch) => {
    setConfig(prev => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  };

  return [config, update];
}

export default function AdapterSettings({ orgs = [], config, onConfigChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(config);

  useEffect(() => { setDraft(config); }, [config]);

  const currentAdapter = ADAPTERS.find(a => a.value === (config.adapter || 'anthropic')) || ADAPTERS[0];

  const handleSave = () => {
    onConfigChange(draft);
    setOpen(false);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {/* Org selector (inline) */}
      {orgs.length > 0 && (
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Org</InputLabel>
          <Select
            value={config.orgUsername || ''}
            label="Org"
            onChange={e => onConfigChange({ ...config, orgUsername: e.target.value })}
          >
            <MenuItem value=""><em>None selected</em></MenuItem>
            {orgs.map(o => (
              <MenuItem key={o.username} value={o.username}>
                {o.label || o.username}
                {o.environment && (
                  <Chip label={o.environment} size="small" sx={{ ml: 1, height: 16, fontSize: '0.65rem' }} />
                )}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {/* Adapter chip + settings button */}
      <Chip
        label={currentAdapter.label}
        size="small"
        variant="outlined"
        color="primary"
        sx={{ fontWeight: 500 }}
      />
      <Tooltip title="AI adapter settings">
        <IconButton size="small" onClick={() => setOpen(true)}>
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Settings dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>AI Adapter Settings</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Adapter</InputLabel>
            <Select
              value={draft.adapter || 'anthropic'}
              label="Adapter"
              onChange={e => setDraft(d => ({ ...d, adapter: e.target.value, model: ADAPTERS.find(a => a.value === e.target.value)?.defaultModel }))}
            >
              {ADAPTERS.map(a => (
                <MenuItem key={a.value} value={a.value}>{a.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Model"
            value={draft.model || ''}
            onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
            placeholder={ADAPTERS.find(a => a.value === (draft.adapter || 'anthropic'))?.defaultModel}
            size="small"
            fullWidth
          />

          {(draft.adapter === 'anthropic' || !draft.adapter) && (
            <TextField
              label="Anthropic API Key"
              type="password"
              value={draft.apiKey || ''}
              onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
              placeholder="sk-ant-..."
              size="small"
              fullWidth
              helperText="Leave blank to use server-side ANTHROPIC_API_KEY env var"
            />
          )}

          {draft.adapter === 'openai' && (
            <TextField
              label="OpenAI API Key"
              type="password"
              value={draft.apiKey || ''}
              onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
              placeholder="sk-..."
              size="small"
              fullWidth
              helperText="Leave blank to use server-side OPENAI_API_KEY env var"
            />
          )}

          {draft.adapter === 'copilot' && (
            <TextField
              label="GitHub Token"
              type="password"
              value={draft.apiKey || ''}
              onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
              placeholder="ghp_..."
              size="small"
              fullWidth
              helperText="Leave blank to use server-side GITHUB_TOKEN env var"
            />
          )}

          {draft.adapter === 'ollama' && (
            <TextField
              label="Ollama Base URL"
              value={draft.baseURL || ''}
              onChange={e => setDraft(d => ({ ...d, baseURL: e.target.value }))}
              placeholder="http://localhost:11434"
              size="small"
              fullWidth
            />
          )}

          <Typography variant="caption" color="text.secondary">
            API keys are sent per-request and never stored on the server.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
