import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  History as HistoryIcon,
  Send as SendIcon,
  StopCircle as StopIcon,
  AutoAwesome as AutoAwesomeIcon,
} from '@mui/icons-material';
import axios from 'axios';
import ChatMessage from './ChatMessage';
import AdapterSettings from './AdapterSettings';
import { useAdapterConfig } from './AdapterSettings';

const WELCOME = 'Ask me anything about your Vlocity configuration — catalogs, products, pricing, promotions, and more.';
const STARTER_PROMPTS = [
  'How many catalogs do we have in the selected org?',
  'List the price lists and highlight the most important ones.',
  'Find promotions related to a product I name next.',
  'Summarize the product attributes available for a catalog item.',
];

export default function ChatWindow({ conversation, onFirstMessage, orgs, onCreate, onOpenConversations }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });
  const [adapterConfig, setAdapterConfig] = useAdapterConfig();
  const bottomRef = useRef(null);
  const readerRef = useRef(null);
  const conversationId = conversation?.id;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const currentAdapterLabel = {
    anthropic: 'Claude',
    openai: 'OpenAI',
    copilot: 'Copilot',
    ollama: 'Ollama',
  }[adapterConfig.adapter || 'anthropic'];

  // Load messages when conversation changes
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    axios.get(`/api/chat/conversations/${conversationId}`)
      .then(r => setMessages(r.data.conversation.messages || []))
      .catch(() => setMessages([]));
  }, [conversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stopStreaming = useCallback(() => {
    readerRef.current?.cancel();
    setStreaming(false);
    // Remove any empty streaming message
    setMessages(prev => prev.filter(m => !(m.streaming && !m.content)));
  }, []);

  const showToast = useCallback((message, severity = 'success') => {
    setToast({ open: true, message, severity });
  }, []);

  const copyMessage = useCallback(async (content) => {
    try {
      await navigator.clipboard.writeText(content);
      showToast('Message copied');
    } catch {
      showToast('Could not copy message', 'error');
    }
  }, [showToast]);

  const sendMessage = useCallback(async (messageOverride) => {
    if (streaming || !conversation) return;

    const userText = (messageOverride ?? input).trim();
    if (!userText) return;

    if (!messageOverride) {
      setInput('');
    }

    const userMsg = { role: 'user', content: userText, id: `tmp-${Date.now()}` };
    const assistantMsg = { role: 'assistant', content: '', streaming: true, toolEvents: [], id: `stream-${Date.now()}` };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          conversationId: conversation.id,
          message: userText,
          orgUsername: adapterConfig.orgUsername,
          adapter: adapterConfig.adapter,
          adapterConfig: {
            apiKey: adapterConfig.apiKey,
            model: adapterConfig.model,
            baseURL: adapterConfig.baseURL,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.type === 'token') {
            setMessages(prev => prev.map(m =>
              m.streaming ? { ...m, content: m.content + event.content } : m
            ));
          } else if (event.type === 'tool_start') {
            setMessages(prev => prev.map(m =>
              m.streaming ? { ...m, toolEvents: [...(m.toolEvents || []), { type: 'tool_start', tool: event.tool, args: event.args }] } : m
            ));
          } else if (event.type === 'tool_end') {
            setMessages(prev => prev.map(m => {
              if (!m.streaming) return m;
              const toolEvents = (m.toolEvents || []).map(te =>
                te.type === 'tool_start' && te.tool === event.tool
                  ? { ...te, type: 'tool_end', result: event.result }
                  : te
              );
              return { ...m, toolEvents };
            }));
          } else if (event.type === 'done') {
            setMessages(prev => prev.map(m =>
              m.streaming ? { ...m, streaming: false, id: event.messageId } : m
            ));
            if (onFirstMessage && messages.length === 0) onFirstMessage();
          } else if (event.type === 'error') {
            setMessages(prev => prev.map(m =>
              m.streaming ? { ...m, streaming: false, content: m.content || `Error: ${event.message}` } : m
            ));
          }
        }
      }
    } catch (err) {
        if (err.name !== 'AbortError') {
          setMessages(prev => prev.map(m =>
            m.streaming
              ? { ...m, streaming: false, content: m.content || `Error: ${err.message}` }
              : m
          ));
          showToast(err.message || 'Message failed', 'error');
        }
      } finally {
        setStreaming(false);
        readerRef.current = null;
      }
  }, [input, streaming, conversation, adapterConfig, messages.length, onFirstMessage, showToast]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!conversation) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 2, color: 'text.secondary' }}>
        <Typography variant="h6">No conversation selected</Typography>
        <Typography variant="body2" sx={{ textAlign: 'center', maxWidth: 400 }}>{WELCOME}</Typography>
        {onCreate && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
            New chat
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Top bar */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          {isMobile && (
            <Tooltip title="Open chat history">
              <IconButton size="small" onClick={onOpenConversations}>
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>
              {conversation.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {messages.length} message{messages.length === 1 ? '' : 's'} in this conversation
            </Typography>
          </Box>

          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={onCreate}
            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          >
            New chat
          </Button>

          <AdapterSettings orgs={orgs} config={adapterConfig} onConfigChange={setAdapterConfig} />
        </Box>

        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <Chip size="small" color="primary" variant="outlined" label={currentAdapterLabel} />
          {adapterConfig.model && <Chip size="small" variant="outlined" label={adapterConfig.model} />}
          <Chip
            size="small"
            variant="outlined"
            color={adapterConfig.orgUsername ? 'success' : 'default'}
            label={adapterConfig.orgUsername ? `Org: ${adapterConfig.orgUsername}` : 'No org selected'}
          />
          {streaming && <Chip size="small" color="warning" label="Streaming response" />}
        </Stack>
      </Box>

      {/* Messages */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2.5 }}>
        {messages.length === 0 && (
          <Box sx={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ width: '100%', maxWidth: 760 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: { xs: 2.5, sm: 3 },
                  borderRadius: 3,
                  bgcolor: 'background.paper',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <AutoAwesomeIcon color="primary" />
                  <Typography variant="h6" fontWeight={700}>
                    Ready to help
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                  {WELCOME}
                </Typography>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Try one of these starters
                </Typography>

                <Stack spacing={1.25}>
                  {STARTER_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outlined"
                      color="inherit"
                      sx={{
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        py: 1.25,
                        px: 1.5,
                        borderRadius: 2,
                        textTransform: 'none',
                      }}
                      onClick={() => sendMessage(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </Stack>
              </Paper>
            </Box>
          </Box>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id || i}
            message={msg}
            onCopy={copyMessage}
            onReuse={(content) => setInput(content)}
          />
        ))}
        <div ref={bottomRef} />
      </Box>

      {/* Input bar */}
      <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0, bgcolor: 'background.default' }}>
        <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 3 }}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={10}
            placeholder="Message the assistant…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            variant="standard"
            InputProps={{ disableUnderline: true }}
          />

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1 }}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Enter to send
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Shift+Enter for new line
              </Typography>
              {!adapterConfig.apiKey && ['anthropic', 'openai', 'copilot'].includes(adapterConfig.adapter || 'anthropic') && (
                <Typography variant="caption" color="warning.main">
                  Using server-side credentials if available
                </Typography>
              )}
            </Stack>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {streaming ? (
                <Tooltip title="Stop generating">
                  <IconButton onClick={stopStreaming} color="error">
                    <StopIcon />
                  </IconButton>
                </Tooltip>
              ) : (
                <>
                  <Tooltip title="Start a new conversation">
                    <span>
                      <IconButton onClick={onCreate}>
                        <AddIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Send message">
                    <span>
                      <IconButton onClick={() => sendMessage()} color="primary" disabled={!input.trim()}>
                        <SendIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </>
              )}
            </Box>
          </Box>
        </Paper>
      </Box>

      <Snackbar
        open={toast.open}
        autoHideDuration={2500}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setToast((prev) => ({ ...prev, open: false }))}
          severity={toast.severity}
          variant="filled"
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
