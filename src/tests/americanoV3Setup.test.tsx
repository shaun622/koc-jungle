import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmericanoSetupV3 } from '@/components/americano/AmericanoSetupV3';
import { createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { useEventStore } from '@/store/eventStore';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, cloudEnabled: false }) }));

afterEach(() => {
  useEventStore.setState({ event: null });
});

describe('Americano v3 setup', () => {
  it('preserves unsaved rules across roster-save cloud acknowledgements and resets them for another event', () => {
    const event = createAmericanoEventV3('Cloud acknowledgement test');
    const { rerender } = render(<MemoryRouter><AmericanoSetupV3 event={event} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Match format'), { target: { value: 'traditional' } });
    fireEvent.change(screen.getByLabelText('Points per game won'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Rounds (1–64)'), { target: { value: '12' } });
    const acknowledged = { ...structuredClone(event), revision: '1' };
    rerender(<MemoryRouter><AmericanoSetupV3 event={acknowledged} /></MemoryRouter>);
    expect(screen.getByLabelText('Match format')).toHaveValue('traditional');
    expect(screen.getByLabelText('Points per game won')).toHaveValue(2);
    expect(screen.getByLabelText('Rounds (1–64)')).toHaveValue(12);
    const other = createAmericanoEventV3('Other event');
    rerender(<MemoryRouter><AmericanoSetupV3 event={other} /></MemoryRouter>);
    expect(screen.getByLabelText('Match format')).toHaveValue('rally');
    expect(screen.getByLabelText('Schedule')).toHaveValue('full');
  });
  it('offers traditional scoring, configurable standings awards and public rule summary', () => {
    const event = createAmericanoEventV3('Local v3 setup');
    render(<MemoryRouter><AmericanoSetupV3 event={event} /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Match format'), { target: { value: 'traditional' } });
    expect(screen.getByLabelText('Traditional format')).toHaveValue('first-to-five');
    expect(screen.getByLabelText('Points per game won')).toHaveValue(1);
    fireEvent.change(screen.getByLabelText('Points per game won'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Match-win bonus'), { target: { value: '2' } });

    expect(screen.getByLabelText('Points per game won')).toHaveValue(3);
    expect(screen.getByLabelText('Match-win bonus')).toHaveValue(2);
    expect(screen.getByRole('region', { name: 'Rules summary' })).toHaveTextContent('First to 5 games');
    expect(screen.getByRole('region', { name: 'Rules summary' })).toHaveTextContent('3 standings points per game');
    expect(screen.getByRole('region', { name: 'Rules summary' })).toHaveTextContent('+2 match-win bonus');
    expect(screen.getByRole('button', { name: 'Publish sign-up page' })).toBeDisabled();
    expect(screen.getByText(/sign in with cloud sync enabled/i)).toBeInTheDocument();
  });

  it('allows custom round count and non-round standings tie choices without changing the default version gate', () => {
    const event = createAmericanoEventV3('Custom local v3 setup');
    render(<MemoryRouter><AmericanoSetupV3 event={event} /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Rounds (1–64)'), { target: { value: '12' } });
    fireEvent.blur(screen.getByLabelText('Rounds (1–64)'));
    fireEvent.change(screen.getByLabelText('Standings tie rule'), { target: { value: 'difference' } });

    expect(screen.getByLabelText('Rounds (1–64)')).toHaveValue(12);
    expect(screen.getByLabelText('Standings tie rule')).toHaveValue('difference');
    expect(screen.getByRole('button', { name: 'Preview schedule' })).toBeDisabled();
  });
});
