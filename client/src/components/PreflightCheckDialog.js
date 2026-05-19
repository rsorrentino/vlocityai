import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, List, ListItem, ListItemIcon, ListItemText,
  Chip, CircularProgress, Alert
} from '@mui/material';
import { Error, Warning, CheckCircle, FlightTakeoff } from '@mui/icons-material';

/**
 * PreflightCheckDialog
 *
 * Props:
 *   open        {boolean}   - Whether the dialog is visible
 *   loading     {boolean}   - Show spinner while preflight API is running
 *   errors      {Object[]}  - Blocking issues (prevent running)
 *   warnings    {Object[]}  - Non-blocking issues (user can still proceed)
 *   passedChecks {Object}   - Map of checks that passed
 *   onProceed   {function}  - Called when user confirms "Run Anyway"
 *   onCancel    {function}  - Called when user clicks Cancel
 */
const PreflightCheckDialog = ({
  open,
  loading = false,
  errors = [],
  warnings = [],
  passedChecks = {},
  onProceed,
  onCancel
}) => {
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FlightTakeoff color={hasErrors ? 'error' : hasWarnings ? 'warning' : 'success'} />
          Pre-Export Check
        </Box>
      </DialogTitle>

      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <List dense>
            {/* Errors */}
            {errors.map((item, i) => (
              <ListItem key={`err-${i}`} alignItems="flex-start" sx={{ bgcolor: 'error.50', borderRadius: 1, mb: 0.5 }}>
                <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                  <Error color="error" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip label="Error" color="error" size="small" />
                      <Typography variant="body2" fontWeight="medium">{item.type || item.check}</Typography>
                    </Box>
                  }
                  secondary={item.message}
                  secondaryTypographyProps={{ variant: 'body2', sx: { mt: 0.5 } }}
                />
              </ListItem>
            ))}

            {/* Warnings */}
            {warnings.map((item, i) => (
              <ListItem key={`warn-${i}`} alignItems="flex-start" sx={{ bgcolor: 'warning.50', borderRadius: 1, mb: 0.5 }}>
                <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                  <Warning color="warning" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip label="Warning" color="warning" size="small" />
                      <Typography variant="body2" fontWeight="medium">{item.type || item.check}</Typography>
                    </Box>
                  }
                  secondary={item.message}
                  secondaryTypographyProps={{ variant: 'body2', sx: { mt: 0.5 } }}
                />
              </ListItem>
            ))}

            {/* Passed checks */}
            {Object.values(passedChecks).filter(Boolean).map((check, i) => (
              <ListItem key={`ok-${i}`} alignItems="flex-start">
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <CheckCircle color="success" />
                </ListItemIcon>
                <ListItemText
                  primary={check.message}
                  primaryTypographyProps={{ variant: 'body2', color: 'success.main' }}
                />
              </ListItem>
            ))}

            {!hasErrors && !hasWarnings && !loading && (
              <Alert severity="success" sx={{ mt: 1 }}>
                All preflight checks passed. Ready to export.
              </Alert>
            )}
          </List>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        {!hasErrors && !loading && (
          <Button
            onClick={onProceed}
            variant="contained"
            color={hasWarnings ? 'warning' : 'primary'}
            startIcon={<FlightTakeoff />}
          >
            {hasWarnings ? 'Run Anyway' : 'Run Export'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default PreflightCheckDialog;
