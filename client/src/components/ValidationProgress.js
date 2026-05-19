import React from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Paper,
  Alert,
  Chip,
} from '@mui/material';
import {
  CheckCircle,
  Schedule,
  PlayArrow,
} from '@mui/icons-material';

/**
 * Validation Progress Component
 * Shows step-by-step progress of validation with descriptions
 */
const ValidationProgress = ({ 
  isRunning, 
  currentStep, 
  totalSteps, 
  currentStepName, 
  currentStepDescription,
  completedSteps = [],
  errors = [],
  warnings = []
}) => {
  const validationSteps = [
    { name: 'Initializing', description: 'Preparing validation environment and connecting to Salesforce' },
    { name: 'Products', description: 'Validating product configurations and relationships' },
    { name: 'Product Hierarchy', description: 'Checking product parent-child relationships and pricing objects' },
    { name: 'Price Lists', description: 'Validating price list configurations and entries' },
    { name: 'Pricing Plans', description: 'Checking pricing plan configurations and steps' },
    { name: 'Pricing Variables', description: 'Validating pricing variable definitions' },
    { name: 'Pricing Elements', description: 'Checking pricing element configurations' },
    { name: 'Promotions', description: 'Validating promotion rules and configurations' },
    { name: 'Rate Codes', description: 'Checking rate code definitions' },
    { name: 'Rate Tables', description: 'Validating rate table configurations' },
    { name: 'Staging Area', description: 'Checking staging area records (if available)' },
    { name: 'Finalizing', description: 'Compiling results and generating report' },
  ];

  const getStepStatus = (stepIndex) => {
    if (completedSteps.includes(stepIndex)) return 'completed';
    if (stepIndex === currentStep) return 'active';
    if (stepIndex < currentStep) return 'completed';
    return 'pending';
  };

  const getStepIcon = (stepIndex) => {
    const status = getStepStatus(stepIndex);
    switch (status) {
      case 'completed':
        return <CheckCircle color="success" />;
      case 'active':
        return <PlayArrow color="primary" />;
      default:
        return <Schedule color="disabled" />;
    }
  };

  if (!isRunning && currentStep === 0) {
    return null; // Don't show progress when not running
  }

  const progressPercentage = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0;

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">
            Validation Progress
          </Typography>
          <Chip
            label={`Step ${currentStep + 1} of ${totalSteps}`}
            color="primary"
            size="small"
          />
        </Box>
        <LinearProgress
          variant="determinate"
          value={progressPercentage}
          sx={{ height: 8, borderRadius: 4, mb: 1 }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            {Math.round(progressPercentage)}% Complete
          </Typography>
          {isRunning && (
            <Typography variant="caption" color="primary.main" fontWeight="medium">
              Running...
            </Typography>
          )}
        </Box>
      </Box>

      {currentStepName && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            <strong>Current Step:</strong> {currentStepName}
          </Typography>
          {currentStepDescription && (
            <Typography variant="body2">
              {currentStepDescription}
            </Typography>
          )}
        </Alert>
      )}

      <Stepper activeStep={currentStep} orientation="vertical" sx={{ mt: 2 }}>
        {validationSteps.slice(0, totalSteps || validationSteps.length).map((step, index) => {
          const status = getStepStatus(index);
          const hasErrors = errors.some(e => e.step === index);
          const hasWarnings = warnings.some(w => w.step === index);
          
          return (
            <Step key={index} completed={status === 'completed'} active={status === 'active'}>
              <StepLabel
                StepIconComponent={() => getStepIcon(index)}
                error={hasErrors}
                optional={
                  hasWarnings && (
                    <Chip label="Warnings" size="small" color="warning" />
                  )
                }
              >
                <Typography variant="subtitle2">
                  {step.name}
                </Typography>
              </StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {step.description}
                </Typography>
                {status === 'active' && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <LinearProgress sx={{ flexGrow: 1 }} />
                    <Typography variant="caption" color="primary">
                      In Progress...
                    </Typography>
                  </Box>
                )}
                {hasErrors && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {errors.filter(e => e.step === index).map((error, i) => (
                      <Typography key={i} variant="body2">
                        {error.message}
                      </Typography>
                    ))}
                  </Alert>
                )}
                {hasWarnings && !hasErrors && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    {warnings.filter(w => w.step === index).map((warning, i) => (
                      <Typography key={i} variant="body2">
                        {warning.message}
                      </Typography>
                    ))}
                  </Alert>
                )}
              </StepContent>
            </Step>
          );
        })}
      </Stepper>
    </Paper>
  );
};

export default ValidationProgress;

