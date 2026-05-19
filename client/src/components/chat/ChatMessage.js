import React, { useState } from 'react';
import { Box, Typography, Collapse, Chip, Paper } from '@mui/material';
import {
  Person as PersonIcon,
  SmartToy as BotIcon,
  Build as ToolIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
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

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user';

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
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              width: 8,
              height: 16,
              bgcolor: 'text.primary',
              ml: 0.5,
              animation: 'blink 1s step-end infinite',
              '@keyframes blink': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0 } },
            }}
          />
        )}
      </Box>
    </Box>
  );
}
