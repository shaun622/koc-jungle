import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmericanoSetupV3 } from '@/components/americano/AmericanoSetupV3';
import { addAmericanoFixedTeamV3, createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { applyExternalEventToActiveFacade, useEventStore } from '@/store/eventStore';

const cloud = vi.hoisted(() => ({ enabled: false, user: { id: 'owner-test' }, flush: vi.fn(), saveConfig: vi.fn(), getSignup: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: cloud.enabled ? cloud.user : null, cloudEnabled: cloud.enabled }) }));
vi.mock('@/store/cloudSync', () => ({ flushCloudEvent: cloud.flush }));
vi.mock('@/lib/americanoV3', async (original) => ({ ...await original<typeof import('@/lib/americanoV3')>(), saveAmericanoConfigV3: cloud.saveConfig }));
vi.mock('@/lib/americanoV2', async (original) => ({ ...await original<typeof import('@/lib/americanoV2')>(), getOrganizerSignupV3: cloud.getSignup }));

afterEach(() => {
  cloud.enabled = false;
  cloud.flush.mockReset();
  cloud.saveConfig.mockReset();
  cloud.getSignup.mockReset();
  useEventStore.setState({ event: null });
});

describe('Americano v3 setup', () => {
  it('binds a published schedule preview to the current signup roster revision', async () => {
    cloud.enabled = true;
    let event = createAmericanoEventV3('Published preview', 'fixed', 1);
    event = addAmericanoFixedTeamV3(event, { playerOne: 'Alex', playerTwo: 'Sam' });
    event = addAmericanoFixedTeamV3(event, { playerOne: 'Ben', playerTwo: 'Lee' });
    event = { ...event, revision: '4', settings: { ...event.settings, publishedSignupId: 'signup-test' } };
    applyExternalEventToActiveFacade(event);
    cloud.getSignup.mockResolvedValue({ id: 'signup-test', rosterRevision: '7', capacityRevision: '2',
      title: event.name, accountSlug: 'demo', eventSlug: 'preview', startsAt: null, endsAt: null,
      venue: '', details: '', prizes: '', timeZone: 'UTC', organizerName: '', publicContactMethod: '', publicContactValue: '' });
    cloud.saveConfig.mockResolvedValue({ status: 'applied', snapshot: { event: { state: { ...event, revision: '5' } } } });
    render(<MemoryRouter><AmericanoSetupV3 event={event} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Preview schedule' }));
    await waitFor(() => expect(screen.getByText(/Preview ready/)).toBeInTheDocument());
    expect(useEventStore.getState().event).toMatchObject({ americanoSchedule: { rosterRevision: '7' } });
  });

  it('waits for autosave and uses its acknowledged revision without saving the response again', async () => {
    cloud.enabled = true;
    const event = { ...createAmericanoEventV3('Cloud save test'), revision: '1' };
    applyExternalEventToActiveFacade(event);
    cloud.flush.mockImplementation(async () => {
      applyExternalEventToActiveFacade({ ...event, revision: '2' });
    });
    cloud.saveConfig.mockImplementation(async (input) => ({
      status: 'applied', requestId: 'test-save', committedEventRevision: '3',
      snapshot: { event: { state: { ...event, formatConfig: input.config, revision: '3' } }, signup: null },
    }));
    const load = vi.spyOn(useEventStore.getState(), 'loadEvent');
    render(<MemoryRouter><AmericanoSetupV3 event={event} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Match format'), { target: { value: 'traditional' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() => expect(screen.getByText(/Rules saved/)).toBeInTheDocument());
    expect(cloud.flush).toHaveBeenCalledWith(event.id);
    expect(cloud.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ baseEventRevision: '2' }));
    expect(useEventStore.getState().event).toMatchObject({ revision: '3', formatConfig: { scoring: { kind: 'traditional' } } });
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
  });
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
