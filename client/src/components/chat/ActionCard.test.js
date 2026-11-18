import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import ActionCard from './ActionCard';

vi.mock('axios');

const pending = {
  id: 'a1',
  status: 'pending',
  orgUsername: 'me@example.org',
  args: {
    sobject: 'Product2',
    recordId: '01t000000000001AAA',
    recordName: 'Hearing Aid',
    fields: { Name: 'Hearing Aid Pro', IsActive: false },
    before: { Name: 'Hearing Aid', IsActive: true },
    reason: 'User asked to rename',
  },
};

describe('ActionCard', () => {
  beforeEach(() => vi.resetAllMocks());

  it('shows current and proposed values', () => {
    render(<ActionCard action={pending} />);
    expect(screen.getByText(/Proposed change: Product2/)).toBeInTheDocument();
    expect(screen.getByText('Hearing Aid')).toBeInTheDocument();
    expect(screen.getByText('Hearing Aid Pro')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your approval')).toBeInTheDocument();
  });

  it('approves through the API and reports the result', async () => {
    const applied = { ...pending, status: 'applied', decidedBy: 'dev' };
    axios.post.mockResolvedValue({ data: { action: applied } });
    const onDecided = vi.fn();
    render(<ActionCard action={pending} onDecided={onDecided} />);

    await userEvent.click(screen.getByRole('button', { name: 'Approve and apply' }));

    expect(axios.post).toHaveBeenCalledWith('/api/chat/actions/a1/approve');
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(applied));
  });

  it('rejects through the API', async () => {
    axios.post.mockResolvedValue({ data: { action: { ...pending, status: 'rejected' } } });
    render(<ActionCard action={pending} onDecided={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(axios.post).toHaveBeenCalledWith('/api/chat/actions/a1/reject');
  });

  it('shows the server error and keeps the buttons', async () => {
    axios.post.mockRejectedValue({ response: { data: { error: { message: 'Only the user who asked can decide' } } } });
    render(<ActionCard action={pending} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve and apply' }));
    expect(await screen.findByText('Only the user who asked can decide')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and apply' })).toBeEnabled();
  });

  it('has no buttons once decided, and shows why a change failed', () => {
    render(<ActionCard action={{ ...pending, status: 'failed', result: { error: 'Session expired' } }} />);
    expect(screen.queryByRole('button', { name: 'Approve and apply' })).not.toBeInTheDocument();
    expect(screen.getByText('Session expired')).toBeInTheDocument();
  });
});
