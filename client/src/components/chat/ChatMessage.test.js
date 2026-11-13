import React from 'react';
import { render, screen } from '@testing-library/react';
import ChatMessage from './ChatMessage';
import { formatCost } from './UsageDialog';

describe('ChatMessage usage label', () => {
  it('shows tokens and estimated cost for a live answer', () => {
    render(<ChatMessage message={{ role: 'assistant', content: 'Hi', usage: { inputTokens: 1234, outputTokens: 56, adapter: 'anthropic', costUsd: 0.0061 } }} />);
    expect(screen.getByText(/1,234 in \/ 56 out tokens • \$0\.0061/)).toBeInTheDocument();
  });

  it('reads the saved columns of a stored answer', () => {
    render(<ChatMessage message={{ role: 'assistant', content: 'Hi', input_tokens: 2000000, output_tokens: 10, adapter: 'anthropic', cost_usd: '8.000200' }} />);
    expect(screen.getByText(/2,000,000 in \/ 10 out tokens • \$8\.00/)).toBeInTheDocument();
  });

  it('labels Copilot answers as included in the plan', () => {
    render(<ChatMessage message={{ role: 'assistant', content: 'Hi', usage: { inputTokens: 5, outputTokens: 5, adapter: 'copilot', costUsd: 0 } }} />);
    expect(screen.getByText(/Copilot plan/)).toBeInTheDocument();
  });

  it('shows nothing for user messages', () => {
    render(<ChatMessage message={{ role: 'user', content: 'Hello', input_tokens: 5 }} />);
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });
});

describe('formatCost', () => {
  it.each([
    [null, '—'],
    [0, '$0'],
    [0.00123, '$0.0012'],
    [12.345, '$12.35'],
  ])('%p → %s', (value, expected) => {
    expect(formatCost(value)).toBe(expected);
  });
});
