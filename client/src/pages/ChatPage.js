import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import axios from 'axios';
import ConversationList from '../components/chat/ConversationList';
import ChatWindow from '../components/chat/ChatWindow';

const CONV_LIST_WIDTH = 240;

export default function ChatPage() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const activeConversation = conversations.find(c => c.id === activeId) || null;

  const createConversation = useCallback(async () => {
    const res = await axios.post('/api/chat/conversations', {});
    return res.data.conversation;
  }, []);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get('/api/chat/conversations');
      const convs = response.data.conversations || [];

      if (convs.length > 0) {
        setConversations(convs);
        setActiveId((prev) => (prev && convs.some((conv) => conv.id === prev) ? prev : convs[0].id));
      } else {
        const conversation = await createConversation();
        setConversations([conversation]);
        setActiveId(conversation.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Chat is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, [createConversation]);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load orgs for adapter settings
  useEffect(() => {
    axios.get('/api/orgs/list')
      .then(r => setOrgs(r.data.orgs || []))
      .catch(() => {});
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      const conv = await createConversation();
      setConversations(prev => [conv, ...prev]);
      setActiveId(conv.id);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to create a new chat.');
    }
  }, [createConversation]);

  const handleDelete = useCallback(async (id) => {
    try {
      await axios.delete(`/api/chat/conversations/${id}`);
      const remainingConversations = conversations.filter(c => c.id !== id);

      if (remainingConversations.length > 0) {
        setConversations(remainingConversations);
        setActiveId(prev => (prev === id ? remainingConversations[0].id : prev));
        return;
      }

      const replacementConversation = await createConversation();
      setConversations([replacementConversation]);
      setActiveId(replacementConversation.id);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to delete the chat.');
    }
  }, [conversations, createConversation]);

  const handleRename = useCallback(async (id, title) => {
    try {
      await axios.patch(`/api/chat/conversations/${id}/title`, { title });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to rename the chat.');
    }
  }, []);

  // After first message, refresh conversation list to update title
  const handleFirstMessage = useCallback(() => {
    axios.get('/api/chat/conversations')
      .then(r => setConversations(r.data.conversations || []))
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 64px)',
          mt: -3,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error && conversations.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 64px)',
          mt: -3,
          px: 2,
        }}
      >
        <Box sx={{ maxWidth: 520, width: '100%' }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={loadConversations}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        </Box>
      </Box>
    );
  }

  return (
    // Negative margin to escape the page container's padding and go full-height
    <Box
      sx={{
        display: 'flex',
        height: 'calc(100vh - 64px)',
        mt: -3,
        mx: { xs: -2, sm: -3, md: -4 },
        overflow: 'hidden',
      }}
    >
      {/* Conversation list pane */}
      <Box
        sx={{
          width: CONV_LIST_WIDTH,
          flexShrink: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
        }}
      >
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onRename={handleRename}
        />
      </Box>

      {/* Chat window pane */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {error && conversations.length > 0 && (
          <Alert severity="warning" sx={{ m: 2, mb: 0 }}>
            {error}
          </Alert>
        )}
        <ChatWindow
          conversation={activeConversation}
          orgs={orgs}
          onFirstMessage={handleFirstMessage}
          onCreate={handleCreate}
        />
      </Box>
    </Box>
  );
}
