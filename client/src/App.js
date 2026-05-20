import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Box, Container, useMediaQuery, useTheme } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import ExportJobs from './pages/ExportJobs';
import DeployJobs from './pages/DeployJobs';
import OrgManagement from './pages/OrgManagement';
// VlocityManagement merged into ValidationDashboard
import JobHistory from './pages/JobHistory';
import Settings from './pages/Settings';
import UserManagement from './pages/UserManagement';
import AuditLogs from './pages/AuditLogs';
import YamlConfigManager from './pages/YamlConfigManager';
import RealTimeJobMonitor from './pages/RealTimeJobMonitor';
import JobDetails from './pages/JobDetails';
import ConfigTester from './pages/ConfigTester';
import CatalogManager from './pages/CatalogManager';
import CatalogRecordPage from './pages/CatalogRecordPage';
import SfdmuPage from './pages/SfdmuPage';
import SfdmuConfigPage from './pages/SfdmuConfigPage';
import VlocityCommands from './pages/VlocityCommands';
import ValidationDashboard from './pages/ValidationDashboard';
import JobReport from './pages/JobReport';
import EnvComparisonPage from './pages/EnvComparisonPage';
import ExportHealthPage from './pages/ExportHealthPage';
import DeploymentPipeline from './pages/DeploymentPipeline';
import PipelineDetails from './pages/PipelineDetails';
import ServiceCreationPage from './pages/ServiceCreationPage';
import ChatPage from './pages/ChatPage';
import ScrollToTop from './components/ScrollToTop';

const SIDEBAR_EXPANDED_STORAGE_KEY = 'vlocity-sidebar-expanded';

function AppContent() {
  const { isAuthenticated, loading, login, user } = useAuth();
  const location = useLocation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    const storedValue = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
    return storedValue === null ? true : storedValue === 'true';
  });

  // Exclude server-side routes from React Router handling
  // These routes are handled by the Express server, not React Router
  const isServerRoute = location.pathname.startsWith('/api-docs') || 
                       location.pathname.startsWith('/api-docs.json') || 
                       location.pathname === '/health';
  
  // Force full page navigation for server-side routes (must be called unconditionally)
  React.useEffect(() => {
    if (isServerRoute) {
      // Force full page navigation for server-side routes to let Express handle them
      // Use setTimeout to ensure this happens after render
      const timeoutId = setTimeout(() => {
        const fullPath = location.pathname + (location.search || '') + (location.hash || '');
        // Always reload for server routes - this ensures Express handles the request
        window.location.href = fullPath;
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isServerRoute, location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(desktopSidebarExpanded));
    }
  }, [desktopSidebarExpanded]);

  const handleToggleSidebar = () => {
    if (isDesktop) {
      setDesktopSidebarExpanded((prev) => !prev);
      return;
    }

    setMobileSidebarOpen((prev) => !prev);
  };

  const handleCloseMobileSidebar = () => {
    setMobileSidebarOpen(false);
  };

  // Show loading state while checking authentication
  if (loading) {
    return (
      <Box 
        display="flex" 
        alignItems="center" 
        justifyContent="center" 
        minHeight="100vh"
      >
        <div>Loading...</div>
      </Box>
    );
  }
  
  if (isServerRoute) {
    // Show loading while redirecting - this will be brief as page reloads
    return (
      <Box 
        display="flex" 
        alignItems="center" 
        justifyContent="center" 
        minHeight="100vh"
      >
        <div>Loading...</div>
      </Box>
    );
  }

  // If not authenticated or user object is missing, show login
  if (!isAuthenticated || !user) {
    // If already on login page, just render it
    if (location.pathname === '/login') {
      return <LoginPage onLogin={login} />;
    }
    // Otherwise redirect to login
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <ErrorBoundary>
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <Sidebar
          open={mobileSidebarOpen}
          expanded={desktopSidebarExpanded}
          onClose={handleCloseMobileSidebar}
        />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <Navbar
            onToggleSidebar={handleToggleSidebar}
            sidebarExpanded={isDesktop ? desktopSidebarExpanded : mobileSidebarOpen}
          />
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              minHeight: 0,
              py: 3,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, md: 4 }, height: '100%' }}>
              <ErrorBoundary>
                <ScrollToTop />
                <Routes>
                  <Route path="/login" element={<Navigate to="/" replace />} />
                  <Route path="/" element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/exports" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <ExportJobs />
                    </ProtectedRoute>
                  } />
                  <Route path="/deploys" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <DeployJobs />
                    </ProtectedRoute>
                  } />
                  <Route path="/orgs" element={
                    <ProtectedRoute requiredPermission={{ resource: 'orgs', action: 'read' }}>
                      <OrgManagement />
                    </ProtectedRoute>
                  } />
                  <Route path="/vlocity-commands" element={
                    <ProtectedRoute requiredRole={['admin', 'developer']}>
                      <VlocityCommands />
                    </ProtectedRoute>
                  } />
                  <Route path="/history" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <JobHistory />
                    </ProtectedRoute>
                  } />
                  <Route path="/settings" element={
                    <ProtectedRoute requiredRole="admin">
                      <Settings />
                    </ProtectedRoute>
                  } />
                  <Route path="/users" element={
                    <ProtectedRoute requiredRole="admin">
                      <UserManagement />
                    </ProtectedRoute>
                  } />
                  <Route path="/audit" element={
                    <ProtectedRoute requiredRole="admin">
                      <AuditLogs />
                    </ProtectedRoute>
                  } />
                  <Route path="/yaml" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <YamlConfigManager />
                    </ProtectedRoute>
                  } />
                  <Route path="/monitor" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <RealTimeJobMonitor />
                    </ProtectedRoute>
                  } />
                  <Route path="/jobs/:jobType/:jobId" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <JobDetails />
                    </ProtectedRoute>
                  } />
                  <Route path="/jobs/:jobType/:jobId/report" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <JobReport />
                    </ProtectedRoute>
                  } />
                  <Route path="/tester" element={
                    <ProtectedRoute requiredRole={['admin', 'developer']}>
                      <ConfigTester />
                    </ProtectedRoute>
                  } />
                  <Route path="/catalog" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <CatalogManager />
                    </ProtectedRoute>
                  } />
                  <Route path="/catalog/:objectType/:id" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <CatalogRecordPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/sfdmu" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <SfdmuPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/sfdmu/config/new" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <SfdmuConfigPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/sfdmu/config/:configId" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <SfdmuConfigPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/pricing"            element={<Navigate to="/catalog" replace />} />
                  <Route path="/pricing/*"          element={<Navigate to="/catalog" replace />} />
                  <Route path="/enhanced-pricing"   element={<Navigate to="/catalog" replace />} />
                  <Route path="/enhanced-pricing/*" element={<Navigate to="/catalog" replace />} />
                  <Route path="/env-comparison" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <EnvComparisonPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/validation" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <ValidationDashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/export-health" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <ExportHealthPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/pipeline" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <DeploymentPipeline />
                    </ProtectedRoute>
                  } />
                  <Route path="/pipeline/:pipelineId" element={
                    <ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'read' }}>
                      <PipelineDetails />
                    </ProtectedRoute>
                  } />
                  <Route path="/service-creation" element={
                    <ProtectedRoute requiredPermission={{ resource: 'configs', action: 'read' }}>
                      <ServiceCreationPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/chat" element={
                    <ProtectedRoute>
                      <ChatPage />
                    </ProtectedRoute>
                  } />
                </Routes>
              </ErrorBoundary>
            </Container>
          </Box>
        </Box>
      </Box>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
