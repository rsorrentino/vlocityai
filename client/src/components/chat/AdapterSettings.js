import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Autocomplete,
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { Settings as SettingsIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import CopilotConnect from './CopilotConnect';

export const ADAPTERS = [
  { value: 'anthropic',     label: 'Anthropic (Claude)', short: 'Claude',        defaultModel: 'claude-sonnet-4-6' },
  { value: 'copilot',       label: 'GitHub Copilot',     short: 'Copilot',       defaultModel: 'gpt-4.1' },
  { value: 'github-models', label: 'GitHub Models',      short: 'GitHub Models', defaultModel: 'openai/gpt-4.1' },
  { value: 'openai',        label: 'OpenAI',             short: 'OpenAI',        defaultModel: 'gpt-4o' },
  { value: 'ollama',        label: 'Ollama (local)',     short: 'Ollama',        defaultModel: 'llama3.2' },
];

const KEY_FIELDS = {
  anthropic: { label: 'Anthropic API Key', placeholder: 'sk-ant-...', env: 'ANTHROPIC_API_KEY' },
  openai: { label: 'OpenAI API Key', placeholder: 'sk-...', env: 'OPENAI_API_KEY' },
  'github-models': {
    label: 'GitHub token (models:read)',
    placeholder: 'github_pat_...',
    env: 'GITHUB_MODELS_TOKEN',
    help: 'Fine-grained personal access token with the "Models: read" permission.',
  },
};

const STORAGE_KEY = 'vlocity_chat_adapter_config';

function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Migrate the old single shared apiKey to a per-adapter key
    if (cfg.apiKey && !cfg.apiKeys) {
      cfg.apiKeys = { [cfg.adapter || 'anthropic']: cfg.apiKey };
    }
    delete cfg.apiKey;
    return cfg;
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable (private mode) – settings last for this session only */
  }
}

/** API key the user entered for the given adapter (never shared across adapters). */
export function getAdapterApiKey(config) {
  const adapter = config.adapter || 'anthropic';
  return config.apiKeys?.[adapter] || undefined;
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

function CopilotModelPicker({ value, onChange, connected }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected) { setModels([]); return; }
    setLoading(true);
    axios.get('/api/chat/copilot/models')
      .then(r => setModels(r.data.models || []))
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [connected]);

  return (
    <Autocomplete
      freeSolo
      options={models.map(m => m.id)}
      getOptionLabel={(id) => {
        const m = models.find(x => x.id === id);
        return m && m.name !== id ? `${m.name} (${id})` : id;
      }}
      loading={loading}
      value={value || ''}
      onChange={(_, v) => onChange(v || '')}
      onInputChange={(_, v, reason) => { if (reason === 'input') onChange(v); }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Model"
          size="small"
          placeholder="gpt-4.1"
          helperText={connected ? 'Models available to your Copilot plan' : 'Sign in to list available models'}
        />
      )}
    />
  );
}

export default function AdapterSettings({ orgs = [], config, onConfigChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(config);
  const [copilotConnected, setCopilotConnected] = useState(false);

  useEffect(() => { setDraft(config); }, [config]);

  const draftAdapter = draft.adapter || 'anthropic';
  const currentAdapter = ADAPTERS.find(a => a.value === (config.adapter || 'anthropic')) || ADAPTERS[0];
  const draftDefaults = ADAPTERS.find(a => a.value === draftAdapter) || ADAPTERS[0];
  const keyField = KEY_FIELDS[draftAdapter];

  const setDraftKey = (value) => setDraft(d => ({
    ...d,
    apiKeys: { ...(d.apiKeys || {}), [draftAdapter]: value || undefined },
  }));

  const handleCopilotStatus = useCallback((s) => setCopilotConnected(Boolean(s?.connected)), []);

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
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Adapter</InputLabel>
            <Select
              value={draftAdapter}
              label="Adapter"
              onChange={e => setDraft(d => ({
                ...d,
                adapter: e.target.value,
                model: ADAPTERS.find(a => a.value === e.target.value)?.defaultModel,
              }))}
            >
              {ADAPTERS.map(a => (
                <MenuItem key={a.value} value={a.value}>{a.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {draftAdapter === 'copilot' && (
            <CopilotConnect onStatusChange={handleCopilotStatus} />
          )}

          {draftAdapter === 'copilot' ? (
            <CopilotModelPicker
              value={draft.model}
              connected={copilotConnected}
              onChange={(model) => setDraft(d => ({ ...d, model }))}
            />
          ) : (
            <TextField
              label="Model"
              value={draft.model || ''}
              onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
              placeholder={draftDefaults.defaultModel}
              size="small"
              fullWidth
            />
          )}

          {keyField && (
            <TextField
              label={keyField.label}
              type="password"
              autoComplete="off"
              value={draft.apiKeys?.[draftAdapter] || ''}
              onChange={e => setDraftKey(e.target.value)}
              placeholder={keyField.placeholder}
              size="small"
              fullWidth
              helperText={`${keyField.help ? `${keyField.help} ` : ''}Leave blank to use the server-side ${keyField.env}.`}
            />
          )}

          {draftAdapter === 'copilot' && (
            <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2">Advanced: use a GitHub OAuth token</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <TextField
                  label="GitHub OAuth token (gho_/ghu_)"
                  type="password"
                  autoComplete="off"
                  value={draft.apiKeys?.copilot || ''}
                  onChange={e => setDraftKey(e.target.value)}
                  size="small"
                  fullWidth
                  helperText="Only needed if you cannot use Sign in with GitHub. Personal access tokens (ghp_) are not accepted by Copilot."
                />
              </AccordionDetails>
            </Accordion>
          )}

          {draftAdapter === 'ollama' && (
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
            API keys typed here stay in this browser and are sent with each request; they are never stored on the server.
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
