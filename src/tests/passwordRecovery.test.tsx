import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ recoverySupabase: { auth } }));
import { PasswordRecoveryScreen } from '@/routes/PasswordRecoveryScreen';

describe('isolated password recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });
  it('consumes the one-use token once under StrictMode and signs out only the recovery session', async () => {
    render(<StrictMode><MemoryRouter initialEntries={['/auth/recovery?token_hash=test-token']}><PasswordRecoveryScreen /></MemoryRouter></StrictMode>);
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'new-password-example' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password-example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/Password updated/)).toBeInTheDocument();
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('leaves loading with a clear error when verification fails', async () => {
    auth.verifyOtp.mockRejectedValue(new Error('network failure'));
    render(<MemoryRouter initialEntries={['/auth/recovery?token_hash=test-token']}><PasswordRecoveryScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/invalid, expired, or has already been used/)).toBeInTheDocument());
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
