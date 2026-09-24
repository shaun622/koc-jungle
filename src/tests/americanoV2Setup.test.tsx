import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '@/routes/SetupScreen';
import { useEventStore } from '@/store/eventStore';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';
import type { AmericanoEventStateV2 } from '@/logic/americanoV2/types';
import { parseEventState } from '@/utils/eventSchema';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false, cloudEnabled: false }) }));

afterEach(() => {
  cleanup();
  useEventStore.setState({ event: null });
});

describe('Americano setup', () => {
  it.each(['fixed', 'rotating'] as const)('reviews a %s schedule from the roster before starting', async (mode) => {
    act(() => useEventStore.setState({ event: americanoV2Fixture(mode) as never }));
    await act(async () => { render(<MemoryRouter><SetupScreen /></MemoryRouter>); });
    const roster = screen.getByRole('heading', { name: mode === 'fixed' ? 'Teams' : 'Players' }).closest('section')!;
    const reviewButton = within(roster).getByRole('button', { name: 'Review & start event' });
    const columns = roster.closest('.americano-setup-columns')!;
    expect(within(columns.querySelector('.americano-setup-settings') as HTMLElement).getByRole('heading', { name: 'Rules & schedule' })).toBeInTheDocument();
    expect(within(columns.querySelector('.americano-setup-settings') as HTMLElement).getByRole('heading', { name: 'Courts' })).toBeInTheDocument();
    expect(roster.parentElement).toHaveClass('americano-setup-roster');
    expect(screen.getByRole('heading', { name: 'Public sign-up' }).closest('.americano-setup-roster')).toBe(roster.parentElement);
    const review = screen.getByRole('region', { name: 'Schedule preview' });
    review.scrollIntoView = vi.fn();
    expect(reviewButton).toBeEnabled();
    await act(async () => { fireEvent.click(reviewButton); });
    expect(review.scrollIntoView).toHaveBeenCalled();
    expect(review).toHaveFocus();
    const reviewedEvent = useEventStore.getState().event as unknown as AmericanoEventStateV2;
    expect(reviewedEvent.americanoSchedule).toBeDefined();
    expect(reviewedEvent.status).toBe('setup');
    expect(reviewedEvent.rounds).toHaveLength(0);
    expect(within(review).getByRole('button', { name: 'Start event' })).toBeEnabled();
    await act(async () => { fireEvent.click(reviewButton); });
    expect((useEventStore.getState().event as unknown as AmericanoEventStateV2).americanoSchedule?.id).toBe(reviewedEvent.americanoSchedule?.id);
    await act(async () => { fireEvent.click(within(review).getByRole('button', { name: 'Start event' })); });
    expect((useEventStore.getState().event as unknown as AmericanoEventStateV2).rounds).toHaveLength(1);
  });

  it.each(['fixed', 'rotating'] as const)('shows the start action with an explanation for an underfilled %s roster', async (mode) => {
    const event = americanoV2Fixture(mode);
    if (mode === 'fixed') event.teams = event.teams.slice(0, 1);
    else event.participants = event.participants.slice(0, 3);
    act(() => useEventStore.setState({ event: event as never }));
    await act(async () => { render(<MemoryRouter><SetupScreen /></MemoryRouter>); });
    expect(screen.getByRole('button', { name: 'Review & start event' })).toBeDisabled();
    expect(screen.getByText(`Add 1 more ${mode === 'fixed' ? 'complete team' : 'player'} to review and start.`)).toBeInTheDocument();
  });

  it.each(['fixed', 'rotating'] as const)('keeps %s add and edit forms free of fixed-position utilities', async (mode) => {
    act(() => useEventStore.setState({ event: americanoV2Fixture(mode) as never }));
    await act(async () => { render(<MemoryRouter><SetupScreen /></MemoryRouter>); });
    const roster = screen.getByRole('heading', { name: mode === 'fixed' ? 'Teams' : 'Players' }).closest('section')!;
    const addForm = roster.querySelector('.americano-add-row')!;
    expect(addForm).not.toHaveClass('fixed');
    expect(addForm.classList.contains('rotating')).toBe(mode === 'rotating');
    expect(within(addForm as HTMLElement).getByPlaceholderText(mode === 'fixed' ? 'Player one' : 'Player name')).toBeInTheDocument();

    fireEvent.click(within(roster).getAllByRole('button', { name: 'Edit' })[0]);
    const editForm = roster.querySelector('.americano-edit-fields')!;
    expect(editForm).not.toHaveClass('fixed');
    expect(editForm.classList.contains('rotating')).toBe(mode === 'rotating');
    expect(within(editForm as HTMLElement).getByRole('textbox', { name: 'Edit player one' })).toBeInTheDocument();
  });

  it('allows replacing the default with a custom total and keeps it while changing schedules', async () => {
    act(() => useEventStore.setState({ event: americanoV2Fixture() as never }));
    await act(async () => { render(<MemoryRouter><SetupScreen /></MemoryRouter>); });
    const points = screen.getByRole('spinbutton', { name: 'Points per match' });
    fireEvent.change(points, { target: { value: '' } });
    expect(points).toHaveValue(null);
    expect(points).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Preview schedule' }));
    expect(points).toHaveFocus();
    expect((useEventStore.getState().event as unknown as AmericanoEventStateV2).americanoSchedule).toBeUndefined();
    fireEvent.change(points, { target: { value: '21' } });
    expect(points).toHaveValue(21);
    expect(points).toHaveAttribute('aria-invalid', 'false');
    const schedule = screen.getByRole('combobox', { name: 'Schedule' });
    fireEvent.change(schedule, { target: { value: 'custom' } });
    expect(screen.getByRole('spinbutton', { name: 'Rounds (1–64)' })).toHaveValue(1);
    expect(() => parseEventState(useEventStore.getState().event)).not.toThrow();
    fireEvent.change(schedule, { target: { value: 'balanced' } });
    expect(points).toHaveValue(21);
    expect((useEventStore.getState().event as unknown as AmericanoEventStateV2).formatConfig.pointsPerMatch).toBe(21);
    expect(() => parseEventState(useEventStore.getState().event)).not.toThrow();
  });

  it('does not persist zero, negative, fractional, or overflowing points', async () => {
    act(() => useEventStore.setState({ event: americanoV2Fixture() as never }));
    await act(async () => { render(<MemoryRouter><SetupScreen /></MemoryRouter>); });
    const points = screen.getByRole('spinbutton', { name: 'Points per match' });
    for (const value of ['0', '-1', '2.5', '2147483648']) {
      fireEvent.change(points, { target: { value } });
      expect(points).toHaveAttribute('aria-invalid', 'true');
      expect((useEventStore.getState().event as unknown as AmericanoEventStateV2).formatConfig.pointsPerMatch).toBe(24);
    }
  });
});
