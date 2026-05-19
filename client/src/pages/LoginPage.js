import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Container,
  Paper,
  Divider,
  Chip
} from '@mui/material';
import { Lock, Person } from '@mui/icons-material';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const LoginPage = ({ onLogin }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const from = location.state?.from?.pathname || location.state?.from || '/';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, location]);
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clearCacheMessage, setClearCacheMessage] = useState('');

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError(''); // Clear error when user types
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/auth/login', formData);
      
      if (response.data.success) {
        // The server sets an httpOnly cookie - just update auth context with user data
        onLogin(response.data.data.user);
        
        // Redirect to the page user was trying to access, or dashboard
        const from = location.state?.from?.pathname || location.state?.from || '/';
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = () => {
    // Clear session storage (tokens live in httpOnly cookies now, not localStorage)
    sessionStorage.clear();
    setClearCacheMessage('Cache cleared! Please try logging in again.');
    setTimeout(() => setClearCacheMessage(''), 5000);
  };

  const handleDemoLogin = (role) => {
    const demoCredentials = {
      admin: { username: 'admin', password: 'Admin123!' },
      developer: { username: 'developer', password: 'Dev123!' },
      functional: { username: 'functional', password: 'Func123!' }
    };

    setFormData(demoCredentials[role]);
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Lock sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            Vlocity DataPack Manager
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Sign in to access your account
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
            {error.includes('431') || error.includes('Header') || error.includes('Network Error') ? (
              <Box sx={{ mt: 2 }}>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  onClick={handleClearCache}
                >
                  Clear Cache & Retry
                </Button>
              </Box>
            ) : null}
          </Alert>
        )}

        {clearCacheMessage && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {clearCacheMessage}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Username or Email"
            name="username"
            value={formData.username}
            onChange={handleChange}
            margin="normal"
            required
            InputProps={{
              startAdornment: <Person sx={{ mr: 1, color: 'action.active' }} />
            }}
            disabled={loading}
          />

          <TextField
            fullWidth
            label="Password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            margin="normal"
            required
            InputProps={{
              startAdornment: <Lock sx={{ mr: 1, color: 'action.active' }} />
            }}
            disabled={loading}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={loading}
            sx={{ mt: 3, mb: 2 }}
          >
            {loading ? <CircularProgress size={24} /> : 'Sign In'}
          </Button>
        </form>

        <Divider sx={{ my: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Demo Accounts
          </Typography>
        </Divider>

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Chip
            label="Admin"
            color="error"
            variant="outlined"
            onClick={() => handleDemoLogin('admin')}
            disabled={loading}
            sx={{ cursor: 'pointer' }}
          />
          <Chip
            label="Developer"
            color="warning"
            variant="outlined"
            onClick={() => handleDemoLogin('developer')}
            disabled={loading}
            sx={{ cursor: 'pointer' }}
          />
          <Chip
            label="Functional"
            color="info"
            variant="outlined"
            onClick={() => handleDemoLogin('functional')}
            disabled={loading}
            sx={{ cursor: 'pointer' }}
          />
        </Box>

        {/* Removed hardcoded credentials display for security */}
      </Paper>
    </Container>
  );
};

export default LoginPage;
