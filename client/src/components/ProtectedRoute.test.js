import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import { AuthProvider } from '../contexts/AuthContext';
import ProtectedRoute from './ProtectedRoute';

vi.mock('axios', () => {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    defaults: {},
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  };
  return { default: instance };
});

function renderAt(element) {
  return render(
    <MemoryRouter initialEntries={['/page']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/page" element={element} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

const developer = {
  username: 'dev',
  role: 'developer',
  permissions: [{ resource: 'jobs', actions: ['read', 'execute'] }, { resource: 'configs', actions: ['read', 'write'] }],
};

describe('ProtectedRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends signed-out users to the login page', async () => {
    axios.get.mockRejectedValue({ response: { status: 401 } });
    renderAt(<ProtectedRoute><div>Secret</div></ProtectedRoute>);
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('shows the page when the permission is granted', async () => {
    axios.get.mockResolvedValue({ data: { success: true, data: developer } });
    renderAt(<ProtectedRoute requiredPermission={{ resource: 'jobs', action: 'execute' }}><div>Jobs</div></ProtectedRoute>);
    expect(await screen.findByText('Jobs')).toBeInTheDocument();
  });

  it('denies a missing permission', async () => {
    axios.get.mockResolvedValue({ data: { success: true, data: developer } });
    renderAt(<ProtectedRoute requiredPermission={{ resource: 'orgs', action: 'write' }}><div>Orgs</div></ProtectedRoute>);
    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText('Required permission: write on orgs')).toBeInTheDocument();
  });

  it('denies a missing role', async () => {
    axios.get.mockResolvedValue({ data: { success: true, data: developer } });
    renderAt(<ProtectedRoute requiredRole="admin"><div>Admin</div></ProtectedRoute>);
    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('lets admins through every permission check', async () => {
    axios.get.mockResolvedValue({ data: { success: true, data: { username: 'root', role: 'admin', permissions: [] } } });
    renderAt(<ProtectedRoute requiredPermission={{ resource: 'orgs', action: 'delete' }}><div>Everything</div></ProtectedRoute>);
    expect(await screen.findByText('Everything')).toBeInTheDocument();
  });
});
