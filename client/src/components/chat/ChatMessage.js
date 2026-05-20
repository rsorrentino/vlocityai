import React, { useState } from 'react';
import { Box, Typography, Collapse, Chip, Paper, IconButton, Tooltip } from '@mui/material';
import {
  Person as PersonIcon,
  SmartToy as BotIcon,
  Build as ToolIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  ContentCopy as ContentCopyIcon,
  Reply as ReplyIcon,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';

function ToolCallChip({ toolEvent }) {
  const [open, setOpen] = useState(false);
  const label = toolEvent.type === 'tool_start'
    ? `Running ${toolEvent.tool}…`
    : `✓ ${toolEvent.tool}`;

  return (
    <Box sx={{ my: 0.5 }}>
      <Chip
        icon={<ToolIcon sx={{ fontSize: '0.85rem !important' }} />}
        label={label}
        size="small"
        variant="outlined"
        color={toolEvent.type === 'tool_start' ? 'default' : 'success'}
        deleteIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onDelete={() => setOpen(o => !o)}
        onClick={() => setOpen(o => !o)}
        sx={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}
      />
      <Collapse in={open}>
        <Paper
          variant="outlined"
          sx={{
            mt: 0.5,
            p: 1,
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            bgcolor: 'action.hover',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {toolEvent.result || JSON.stringify(toolEvent.args, null, 2)}
        </Paper>
      </Collapse>
    </Box>
  );
}

function formatTimestamp(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ChatMessage({ message, onCopy, onReuse }) {
  const isUser = message.role === 'user';
  const timestamp = formatTimestamp(message.created_at);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
        flexDirection: isUser ? 'row-reverse' : 'row',
        mb: 2,
      }}
    >
      {/* Avatar */}
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          bgcolor: isUser ? 'primary.main' : 'grey.200',
          color: isUser ? 'primary.contrastText' : 'text.secondary',
        }}
      >
        {isUser ? <PersonIcon sx={{ fontSize: 18 }} /> : <BotIcon sx={{ fontSize: 18 }} />}
      </Box>

      {/* Bubble */}
      <Box sx={{ maxWidth: '80%', minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isUser ? 'flex-end' : 'space-between',
            gap: 1,
            mb: 0.5,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {isUser ? 'You' : 'Assistant'}{timestamp ? ` • ${timestamp}` : ''}
          </Typography>

          <Box sx={{ display: 'flex', gap: 0.25 }}>
            {message.content && onCopy && (
              <Tooltip title="Copy message">
                <IconButton size="small" onClick={() => onCopy(message.content)}>
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            {!isUser && message.content && onReuse && (
              <Tooltip title="Reuse response as prompt">
                <IconButton size="small" onClick={() => onReuse(message.content)}>
                  <ReplyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Tool call events (for assistant messages) */}
        {!isUser && message.toolEvents?.map((ev, i) => (
          <ToolCallChip key={i} toolEvent={ev} />
        ))}

        {/* Message content */}
        {message.content && (
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderRadius: 2,
              bgcolor: isUser ? 'primary.main' : 'background.paper',
              color: isUser ? 'primary.contrastText' : 'text.primary',
              border: isUser ? 'none' : '1px solid',
              borderColor: 'divider',
              '& p': { m: 0 },
              '& p + p': { mt: 1 },
              '& pre': {
                bgcolor: 'action.selected',
                p: 1,
                borderRadius: 1,
                overflowX: 'auto',
                fontSize: '0.8rem',
              },
              '& code': { fontFamily: 'monospace', fontSize: '0.85em' },
              '& ul, & ol': { pl: 2.5, m: 0 },
              '& table': { borderCollapse: 'collapse', width: '100%' },
              '& th, & td': { border: '1px solid', borderColor: 'divider', p: '4px 8px' },
            }}
          >
            {isUser ? (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {message.content}
              </Typography>
            ) : (
              <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <Typography variant="body2" component="p" sx={{ mb: 1, '&:last-child': { mb: 0 } }}>{children}</Typography>,
                    code: ({ inline, children }) =>
                      inline
                        ? <Box component="code" sx={{ bgcolor: 'action.selected', px: 0.5, borderRadius: 0.5 }}>{children}</Box>
                        : <Box component="pre" sx={{ bgcolor: 'action.selected', p: 1, borderRadius: 1, overflowX: 'auto', fontSize: '0.8rem', my: 1 }}><code>{children}</code></Box>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </Box>
            )}
          </Box>
        )}

        {/* Streaming cursor */}
        {message.streaming && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, mt: 0.75 }}>
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: 'text.primary',
                animation: 'pulse 1s ease-in-out infinite',
                '@keyframes pulse': { '0%, 100%': { opacity: 0.35 }, '50%': { opacity: 1 } },
              }}
            />
            Thinking…
          </Typography>
        )}
      </Box>
    </Box>
  );
}
