import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  TextField,
  IconButton,
  Typography,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import { Add as AddIcon, Send as SendIcon, StopCircle as StopIcon } from '@mui/icons-material';
import axios from 'axios';
import ChatMessage from './ChatMessage';
import AdapterSettings from './AdapterSettings';
import { useAdapterConfig } from './AdapterSettings';

const WELCOME = 'Ask me anything about your Vlocity configuration — catalogs, products, pricing, promotions, and more.';

export default function ChatWindow({ conversation, onFirstMessage, orgs, onCreate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [adapterConfig, setAdapterConfig] = useAdapterConfig();
  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const readerRef = useRef(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (!conversation) { setMessages([]); return; }
    axios.get(`/api/chat/conversations/${conversation.id}`)
      .then(r => setMessages(r.data.conversation.messages || []))
      .catch(() => setMessages([]));
  }, [conversation?.id]);

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

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming || !conversation) return;

    const userText = input.trim();
    setInput('');

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
      }
    } finally {
      setStreaming(false);
      readerRef.current = null;
    }
  }, [input, streaming, conversation, adapterConfig, messages.length, onFirstMessage]);

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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Typography variant="subtitle2" noWrap sx={{ flexGrow: 1, mr: 2 }}>
          {conversation.title}
        </Typography>
        <AdapterSettings orgs={orgs} config={adapterConfig} onConfigChange={setAdapterConfig} />
      </Box>

      {/* Messages */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', px: 3, py: 2 }}>
        {messages.length === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 400 }}>
              {WELCOME}
            </Typography>
          </Box>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={msg.id || i} message={msg} />
        ))}
        <div ref={bottomRef} />
      </Box>

      {/* Input bar */}
      <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            multiline
            maxRows={6}
            placeholder="Ask about your Vlocity configuration…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            size="small"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
          {streaming ? (
            <Tooltip title="Stop generating">
              <IconButton onClick={stopStreaming} color="error">
                <StopIcon />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Send (Enter)">
              <span>
                <IconButton onClick={sendMessage} color="primary" disabled={!input.trim()}>
                  <SendIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
        <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
          Enter to send · Shift+Enter for new line
        </Typography>
      </Box>
    </Box>
  );
}
