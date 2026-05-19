import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// Ensure the browser sends the httpOnly auth cookie with every request
axios.defaults.withCredentials = true;

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const checkAuthStatus = useCallback(async () => {
    try {
      // The JWT is stored in an httpOnly cookie - just call /me and let the browser send it
      const response = await axios.get('/api/auth/me');
      if (response.data.success && response.data.data) {
        setUser(response.data.data);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
    } catch (error) {
      // Any error (401, 403, network, etc.) - not authenticated
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const login = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
  };

  const logout = useCallback(async () => {
    try {
      // Tell the server to clear the httpOnly cookie
      await axios.post('/api/auth/logout');
    } catch {
      // Ignore errors - clear local state regardless
    }
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  // Handle 401 responses globally - redirect to login
  useEffect(() => {
    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          setUser(null);
          setIsAuthenticated(false);
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  const hasPermission = (resource, action) => {
    if (!user) return false;
    if (user.role === 'admin') return true; // Admin has all permissions
    
    return user.permissions?.some(permission => 
      permission.resource === resource && 
      permission.actions.includes(action)
    ) || false;
  };

  const hasRole = (roles) => {
    if (!user) return false;
    return Array.isArray(roles) ? roles.includes(user.role) : user.role === roles;
  };

  const value = {
    user,
    isAuthenticated,
    loading,
    login,
    logout,
    hasPermission,
    hasRole
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
