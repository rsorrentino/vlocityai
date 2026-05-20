import React, { useState, useEffect, useCallback } from 'react';
import { Box } from '@mui/material';
import axios from 'axios';
import ConversationList from '../components/chat/ConversationList';
import ChatWindow from '../components/chat/ChatWindow';

const CONV_LIST_WIDTH = 240;

export default function ChatPage() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [orgs, setOrgs] = useState([]);

  const activeConversation = conversations.find(c => c.id === activeId) || null;

  // Load conversations on mount
  useEffect(() => {
    axios.get('/api/chat/conversations')
      .then(r => {
        const convs = r.data.conversations || [];
        setConversations(convs);
        if (convs.length > 0 && !activeId) setActiveId(convs[0].id);
      })
      .catch(() => {});
  }, []);

  // Load orgs for adapter settings
  useEffect(() => {
    axios.get('/api/orgs/list')
      .then(r => setOrgs(r.data.orgs || []))
      .catch(() => {});
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      const res = await axios.post('/api/chat/conversations', {});
      const conv = res.data.conversation;
      setConversations(prev => [conv, ...prev]);
      setActiveId(conv.id);
    } catch {}
  }, []);

  const handleDelete = useCallback(async (id) => {
    try {
      await axios.delete(`/api/chat/conversations/${id}`);
      setConversations(prev => prev.filter(c => c.id !== id));
      setActiveId(prev => prev === id ? conversations.find(c => c.id !== id)?.id || null : prev);
    } catch {}
  }, [conversations]);

  const handleRename = useCallback(async (id, title) => {
    try {
      await axios.patch(`/api/chat/conversations/${id}/title`, { title });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    } catch {}
  }, []);

  // After first message, refresh conversation list to update title
  const handleFirstMessage = useCallback(() => {
    axios.get('/api/chat/conversations')
      .then(r => setConversations(r.data.conversations || []))
      .catch(() => {});
  }, []);

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
