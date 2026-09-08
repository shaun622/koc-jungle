import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModal } from '@/components/AuthModal';

const requestPasswordReset = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    cloudEnabled: true,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    requestPasswordReset,
    signOut: vi.fn(),
    deleteAccount: vi.fn(),
  }),
}));

vi.mock('@/store/entitlements', () => ({
  useEntitlementsStore: (selector: (state: { pro: boolean }) => unknown) => selector({ pro: false }),
  trialDaysRemaining: () => 0,
}));

describe('password reset entry point', () => {
  beforeEach(() => requestPasswordReset.mockReset().mockResolvedValue({}));

  it('keeps the email field visible and sends a neutral recovery response', async () => {
    render(<AuthModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    const email = screen.getByLabelText('Email');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    fireEvent.change(email, { target: { value: 'organiser@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('organiser@example.com'));
    expect(await screen.findByText('If an account exists for that email, a reset link is on its way.')).toBeInTheDocument();
  });
});
