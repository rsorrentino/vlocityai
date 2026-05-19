import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Box,
} from '@mui/material';
import { Warning, Error as ErrorIcon, Info, HelpOutline } from '@mui/icons-material';

/**
 * Reusable confirmation dialog component
 * Replaces native window.confirm() with Material-UI design
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  severity = 'warning', // 'error', 'warning', 'info', 'question'
  onConfirm,
  onCancel,
}) {
  const getSeverityIcon = () => {
    switch (severity) {
      case 'error':
        return <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />;
      case 'warning':
        return <Warning sx={{ fontSize: 48, color: 'warning.main' }} />;
      case 'info':
        return <Info sx={{ fontSize: 48, color: 'info.main' }} />;
      case 'question':
        return <HelpOutline sx={{ fontSize: 48, color: 'primary.main' }} />;
      default:
        return <Warning sx={{ fontSize: 48, color: 'warning.main' }} />;
    }
  };

  const getSeverityColor = () => {
    switch (severity) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'primary';
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="confirm-dialog-title" sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {getSeverityIcon()}
          <Box>
            {title}
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="confirm-dialog-description">
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} color="inherit">
          {cancelText}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={getSeverityColor()}
          autoFocus
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
