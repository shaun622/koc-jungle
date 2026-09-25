import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmericanoDisplay } from '@/components/americano/AmericanoDisplay';
import { AmericanoSetup } from '@/components/americano/AmericanoSetup';
import { previewAmericanoSchedule, startAmericanoEvent } from '@/logic/americanoV2/runtime';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';
import type { SignupSnapshotV3 } from '@/lib/americanoV2';
import type { AmericanoEventStateV2 } from '@/logic/americanoV2/types';

const mocks = vi.hoisted(() => ({
  reader: vi.fn(), start: vi.fn(), publish: vi.fn(), save: vi.fn(),
  auth: { user: { id: 'test-owner', email: 'owner@example.invalid' }, loading: false, cloudEnabled: true },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/store/privateEntryDrafts', () => ({ readPrivateEntryDrafts: async () => ({}) }));
vi.mock('@/store/cloudSync', () => ({ deleteCloudEvent: vi.fn() }));
vi.mock('@/store/eventStore', async (original) => ({
  ...(await original()), saveEventToLocalCatalog: mocks.save, applyExternalEventToActiveFacade: vi.fn(),
}));
vi.mock('@/lib/americanoV2', async (original) => ({
  ...(await original()), getOrganizerSignupV3: mocks.reader, startAmericanoV2: mocks.start,
  publishAmericanoSignupV3: mocks.publish,
}));

const snapshot = (patch: Partial<SignupSnapshotV3> = {}): SignupSnapshotV3 => ({
  id: 'test-signup', title: 'Saved title', venue: 'Saved venue', startsAt: null, endsAt: null,
  details: '', prizes: '', organizerName: '', publicContactMethod: null, publicContactValue: '',
  registrations: [], capacity: { unit: 'players', value: 8 }, entryMode: 'individual',
  accountSlug: 'owner', eventSlug: 'test', publicSlug: 'owner/test', isOpen: true,
  cancelledAt: null, cancellationMessage: '', timeZone: 'Asia/Singapore', protocolVersion: 2,
  capacityRevision: '2', rosterRevision: '3', ...patch,
});
const publishedEvent = () => {
  const event = americanoV2Fixture();
  return { ...event, revision: '4', settings: { ...event.settings, publishedSignupId: 'test-signup' } };
};
const wrapped = (event: AmericanoEventStateV2) => <MemoryRouter><AmericanoSetup event={event} /></MemoryRouter>;
function polling() {
  let refresh: () => unknown = () => { throw new Error('Polling not installed'); };
  vi.spyOn(window, 'setInterval').mockImplementation(((callback: TimerHandler, delay?: number) => {
    if (delay === 8000) refresh = callback as () => unknown;
    return 123;
  }) as typeof window.setInterval);
  return async () => { await act(async () => { await refresh(); }); };
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.save.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

describe('Americano release safety', () => {
  it('the generated TV link preserves the hash route and opens a read-only scoreboard', async () => {
    const event = startAmericanoEvent(await previewAmericanoSchedule(americanoV2Fixture(), { seed: 91 }));
    window.history.replaceState({}, '', '/?theme=dark#/event/demo/display');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = render(<MemoryRouter><AmericanoDisplay event={event} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Open read-only TV' }));
    const target = new URL(String(open.mock.calls[0][0]));
    expect(target.searchParams.get('tv')).toBe('1');
    expect(target.searchParams.get('theme')).toBe('dark');
    expect(target.hash).toBe('#/event/demo/display');
    view.unmount();
    window.history.replaceState({}, '', target.toString());
    render(<MemoryRouter><AmericanoDisplay event={event} /></MemoryRouter>);
    expect(screen.getAllByRole('textbox').every((input) => input.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Confirm result' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish early' })).not.toBeInTheDocument();
  });

  it('also makes older hash-query TV links read-only', async () => {
    const event = startAmericanoEvent(await previewAmericanoSchedule(americanoV2Fixture(), { seed: 91 }));
    window.history.replaceState({}, '', '/#/event/demo/display?tv=1');
    render(<MemoryRouter><AmericanoDisplay event={event} /></MemoryRouter>);
    expect(screen.getAllByRole('textbox').every((input) => input.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByRole('button', { name: /End round/ })).not.toBeInTheDocument();
  });

  it('keeps unsaved title and venue through repeated signup refreshes', async () => {
    mocks.reader.mockResolvedValue(snapshot());
    const refresh = polling();
    await act(async () => { render(wrapped(publishedEvent())); });
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'My draft title' } });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'My draft venue' } });
    mocks.reader.mockResolvedValue(snapshot({ title: 'Remote edit', rosterRevision: '4' }));
    await refresh();
    await refresh();
    expect(screen.getByLabelText('Event title')).toHaveValue('My draft title');
    expect(screen.getByLabelText('Venue')).toHaveValue('My draft venue');
  });

  it('blocks start after a failed signup read, then retries with authoritative signup revisions', async () => {
    const event = await previewAmericanoSchedule(publishedEvent(), { seed: 91, rosterRevision: '3' });
    mocks.reader.mockRejectedValueOnce(new Error('Synthetic read failure'));
    mocks.start.mockResolvedValue({ status: 'rejected', code: 'TEST_STOP', message: 'Test stopped at RPC', requestId: 'test' });
    await act(async () => { render(wrapped(event)); });
    expect(screen.getByRole('button', { name: 'Start event' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review & start event' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start event' }));
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.reader.mockResolvedValue(snapshot());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Retry/ })); });
    expect(screen.getByRole('button', { name: 'Start event' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start event' })); });
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      signupEventId: 'test-signup', baseCapacityRevision: '2', baseRosterRevision: '3',
    }));
  });

  it('ignores an old in-flight poll after a successful save', async () => {
    const event = publishedEvent();
    mocks.reader.mockResolvedValueOnce(snapshot());
    const refresh = polling();
    await act(async () => { render(wrapped(event)); });
    let resolvePoll!: (value: SignupSnapshotV3) => void;
    mocks.reader.mockImplementationOnce(() => new Promise((resolve) => { resolvePoll = resolve; }));
    await refresh();
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Saved new title' } });
    mocks.publish.mockResolvedValue({
      status: 'applied', requestId: 'save', committedEventRevision: '5',
      snapshot: { event: { state: { ...event, revision: '5' }, updatedAt: new Date().toISOString() },
        signup: snapshot({ title: 'Saved new title', capacityRevision: '3' }) },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update sign-up page' })); });
    await act(async () => { resolvePoll(snapshot()); });
    expect(screen.getByLabelText('Event title')).toHaveValue('Saved new title');
  });

  it('only discards dirty fields when explicitly reloading a conflict', async () => {
    const event = publishedEvent();
    mocks.reader.mockResolvedValue(snapshot());
    await act(async () => { render(wrapped(event)); });
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Unsaved title' } });
    mocks.publish.mockResolvedValue({
      status: 'conflict', requestId: 'conflict', code: 'SIGNUP_REVISION_CONFLICT',
      snapshot: { event: { state: event, updatedAt: new Date().toISOString() },
        signup: snapshot({ title: 'Server title', capacityRevision: '3' }) },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update sign-up page' })); });
    expect(screen.getByLabelText('Event title')).toHaveValue('Unsaved title');
    expect(screen.getAllByRole('button', { name: 'Reload server version' })).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload server version' })); });
    expect(screen.getByLabelText('Event title')).toHaveValue('Server title');
  });

  it('does not carry a dirty metadata draft into a different event', async () => {
    mocks.reader.mockResolvedValue(snapshot());
    const view = render(wrapped(publishedEvent()));
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Old event draft' } });
    mocks.reader.mockResolvedValue(snapshot({ id: 'next-signup', title: 'Next event title' }));
    const next = { ...publishedEvent(), id: 'next-event',
      settings: { ...publishedEvent().settings, publishedSignupId: 'next-signup' } };
    await act(async () => { view.rerender(wrapped(next)); });
    expect(screen.getByLabelText('Event title')).toHaveValue('Next event title');
  });
});
