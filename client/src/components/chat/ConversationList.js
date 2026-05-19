import React, { useState } from 'react';
import {
  Box,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  Divider,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

function groupByDate(conversations) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = { Today: [], Yesterday: [], 'This week': [], Older: [] };
  for (const c of conversations) {
    const d = new Date(c.updated_at);
    if (d >= today) groups['Today'].push(c);
    else if (d >= yesterday) groups['Yesterday'].push(c);
    else if (d >= weekAgo) groups['This week'].push(c);
    else groups['Older'].push(c);
  }
  return groups;
}

export default function ConversationList({ conversations, activeId, onSelect, onCreate, onDelete, onRename }) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuConv, setMenuConv] = useState(null);
  const [renameDialog, setRenameDialog] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const handleMenuOpen = (e, conv) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuConv(conv);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuConv(null);
  };

  const handleRenameOpen = () => {
    setRenameValue(menuConv?.title || '');
    setRenameDialog(true);
    handleMenuClose();
  };

  const handleRenameConfirm = () => {
    if (renameValue.trim() && menuConv) {
      onRename(menuConv.id, renameValue.trim());
    }
    setRenameDialog(false);
  };

  const handleDelete = () => {
    if (menuConv) onDelete(menuConv.id);
    handleMenuClose();
  };

  const groups = groupByDate(conversations);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Box sx={{ p: 1.5 }}>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={onCreate}
          size="small"
        >
          New chat
        </Button>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', pb: 1 }}>
        {conversations.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>
            No conversations yet
          </Typography>
        )}

        {Object.entries(groups).map(([label, items]) => {
          if (!items.length) return null;
          return (
            <React.Fragment key={label}>
              <Typography
                variant="caption"
                sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'block', color: 'text.disabled', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.63rem' }}
              >
                {label}
              </Typography>
              <List dense disablePadding>
                {items.map(conv => (
                  <ListItem
                    key={conv.id}
                    disablePadding
                    secondaryAction={
                      <IconButton size="small" edge="end" onClick={e => handleMenuOpen(e, conv)} sx={{ opacity: 0, '.MuiListItemButton-root:hover + * &, &:focus': { opacity: 1 } }}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    }
                    sx={{ '&:hover .MuiIconButton-root': { opacity: 1 } }}
                  >
                    <ListItemButton
                      selected={conv.id === activeId}
                      onClick={() => onSelect(conv.id)}
                      sx={{
                        borderRadius: 1,
                        mx: 0.5,
                        py: 0.6,
                        pr: 4,
                        '&.Mui-selected': {
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                          '&:hover': { bgcolor: 'primary.dark' },
                        },
                      }}
                    >
                      <ListItemText
                        primary={conv.title}
                        primaryTypographyProps={{ fontSize: '0.82rem', noWrap: true }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
              <Divider sx={{ mt: 0.5 }} />
            </React.Fragment>
          );
        })}
      </Box>

      {/* Context menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
        <MenuItem onClick={handleRenameOpen} dense>
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Rename
        </MenuItem>
        <MenuItem onClick={handleDelete} dense sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      {/* Rename dialog */}
      <Dialog open={renameDialog} onClose={() => setRenameDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename conversation</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRenameConfirm()}
            size="small"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRenameConfirm}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
