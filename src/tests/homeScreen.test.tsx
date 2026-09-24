import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(), archive: vi.fn(), deleteLocal: vi.fn(), deleteCloud: vi.fn(), create: vi.fn(),
  getSignup: vi.fn(), copyLink: vi.fn(), hydrateTournament: vi.fn(),
  fetchOfferings: vi.fn(), purchase: vi.fn(), restore: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({useAuth: () => ({ user: {id:'owner-1',email:'organiser@example.com'},cloudEnabled:true })}));
vi.mock('@/store/cloudSync', () => ({deleteCloudEvent:mocks.deleteCloud}));
vi.mock('@/config/features', () => ({ ENABLE_AMERICANO_V2: false, ENABLE_TOURNAMENT_V1: false }));
vi.mock('@/store/tournamentStore', () => ({
  LOCAL_TOURNAMENT_OWNER: 'local',
  useTournamentStore: Object.assign((selector: (state: { records: never[] }) => unknown) => selector({ records: [] }), {
    getState: () => ({ hydrated: false, hydrate: mocks.hydrateTournament, hydrateConnected: mocks.hydrateTournament }),
  }),
}));
vi.mock('@/components/AppMenu', () => ({AppMenu: ({onCreate}:{onCreate:()=>void}) => <button onClick={onCreate}>Menu create event</button>}));
vi.mock('@/lib/signups', () => ({getOwnedSignup:mocks.getSignup,copySignupLink:mocks.copyLink}));
vi.mock('@/lib/iap', () => ({
  isIAPAvailable: () => true,
  isRedeemCodeAvailable: () => false,
  fetchOfferings: mocks.fetchOfferings,
  purchasePlan: mocks.purchase,
  restorePurchases: mocks.restore,
}));

import { HomeScreen, featuredLibraryEvent, libraryFilterFor } from '@/routes/HomeScreen';
import { useEventStore } from '@/store/eventStore';
import { useEventCatalogStore } from '@/store/eventCatalog';
import { metadataForRecord, type EventCatalogMetadata } from '@/store/eventRepository';
import { buildDemoEvent } from '@/logic/demoData';
import { useEntitlementsStore } from '@/store/entitlements';

const entry = (id:string, overrides:Partial<EventCatalogMetadata> = {}):EventCatalogMetadata => ({
  id,name:id,venue:'Test venue',format:'koc',status:'setup',createdAt:1,updatedAt:1,archivedAt:null,
  startsAt:'2099-09-14T10:00:00Z',signupState:'open',teamCount:12,teamCapacity:16,...overrides,
});
const events = [entry('Later',{startsAt:'2099-09-20T10:00:00Z'}),entry('Sooner'),entry('Undated',{startsAt:null}),entry('Finished',{status:'complete'}),entry('Hidden',{archivedAt:2}),entry('Cancelled',{signupState:'cancelled'})];
function show(){return render(<MemoryRouter><HomeScreen/></MemoryRouter>)}

beforeEach(() => {
  vi.clearAllMocks();
  useEntitlementsStore.setState({pro:true,trialUsed:false,trialEndsAt:undefined});
  mocks.fetchOfferings.mockResolvedValue({
    monthly: {product:{priceString:'$9.99'}},
    annual: {product:{priceString:'$79.99'}},
  });
  mocks.select.mockResolvedValue(null);mocks.archive.mockResolvedValue(undefined);mocks.deleteLocal.mockResolvedValue(undefined);
  useEventCatalogStore.setState({events,hydrated:true,lastError:null});
  useEventStore.setState({event:null,selectEventById:mocks.select,archiveLocalEvent:mocks.archive,deleteLocalEvent:mocks.deleteLocal,createEvent:mocks.create});
});

describe('event library presentation', () => {
  it('shows unavailable formats without starting them or contacting the tournament backend', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    for (const format of ['Americano', 'Tournament']) {
      const button = screen.getByRole('button', { name: `${format}: coming soon` });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.hydrateTournament).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Choose format: Team Americano' })).not.toBeInTheDocument();
  });
  it('shows the live store trial for each plan instead of a hardcoded duration', async () => {
    useEntitlementsStore.setState({ pro: false });
    mocks.fetchOfferings.mockResolvedValue({
      monthly: { product: { priceString: '$9.99', introPrice: { price: 0, periodUnit: 'MONTH', periodNumberOfUnits: 1, cycles: 1 } } },
      annual: { product: { priceString: '$79.99', introPrice: null } },
    });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose format: King of the Court' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Pro Monthly/ })).toHaveTextContent('1 month free if eligible'));
    expect(screen.getByRole('button', { name: /Pro Annual/ })).not.toHaveTextContent('free');
    expect(screen.queryByText(/7 days/)).not.toBeInTheDocument();
  });
  it('keeps hidden, cancelled and complete events out of upcoming', () => {
    expect(events.map(libraryFilterFor)).toEqual(['upcoming','upcoming','drafts','past','hidden','past']);
    expect(featuredLibraryEvent(events)?.id).toBe('Sooner');
    expect(featuredLibraryEvent([...events,entry('Running',{status:'between-rounds'})])?.id).toBe('Running');
  });
  it('does not hide an unfinished competition just because its date passed', () => {
    expect(libraryFilterFor(entry('Old setup',{startsAt:'2020-01-01T10:00:00Z'}))).toBe('upcoming');
  });
  it('filters and searches without selecting or mutating any event', () => {
    show();
    fireEvent.click(screen.getByRole('tab',{name:/Drafts/}));
    expect(screen.getByRole('heading',{name:'Undated'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab',{name:/Past/}));
    expect(screen.getByRole('heading',{name:'Cancelled'})).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox',{name:'Search events'}),{target:{value:'Finished'}});
    expect(screen.queryByRole('heading',{name:'Cancelled'})).not.toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Finished'})).toBeInTheDocument();
    expect(mocks.select).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
  });
  it('opens only the selected competition', async () => {
    show();
    const row=screen.getByRole('heading',{name:'Later'}).closest('article')!;
    await act(async () => fireEvent.click(within(row).getByRole('button',{name:'View'})));
    expect(mocks.select).toHaveBeenCalledWith('Later');expect(mocks.select).toHaveBeenCalledTimes(1);
  });
  it('copies the selected organiser-owned link without changing the active event', async () => {
    const signup={eventSlug:'real-event-slug',accountSlug:'organiser'};
    mocks.getSignup.mockResolvedValue(signup);mocks.copyLink.mockResolvedValue(undefined);
    show();
    await act(async () => fireEvent.click(screen.getAllByRole('button',{name:'Copy sign-up link'})[0]));
    expect(mocks.getSignup).toHaveBeenCalledWith('owner-1','Sooner');
    expect(mocks.copyLink).toHaveBeenCalledWith(signup);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Sign-up link copied.');
  });
  it('does not create anything until a format is chosen', () => {
    show();fireEvent.click(screen.getByRole('button',{name:'Create event'}));
    const dialog=screen.getByRole('dialog',{name:'Create an event'});
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button',{name:'Choose format: King of the Court'}));
    expect(mocks.create).toHaveBeenCalledWith('Padel Night','koc');
  });
  it.each(['King of the Court'])('replaces the format chooser with a clear Pro offer for %s', async (format) => {
    useEntitlementsStore.setState({pro:false});
    show();
    fireEvent.click(screen.getByRole('button',{name:'Create event'}));
    const chooser=screen.getByRole('dialog',{name:'Create an event'});
    expect(within(chooser).getByText('Get started with Pro.')).toBeVisible();
    expect(within(chooser).queryByText('Trial / Pro')).not.toBeInTheDocument();
    fireEvent.click(within(chooser).getByRole('button',{name:`Choose format: ${format}`}));
    expect(screen.queryByRole('dialog',{name:'Create an event'})).not.toBeInTheDocument();
    expect(document.querySelector('dialog')).toBeNull();
    const offer=screen.getByRole('dialog',{name:'Unlock Pro'});
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(offer).getByText(/The App Store confirms your eligibility/)).toBeVisible();
    await waitFor(() => expect(within(offer).getByRole('button',{name:/Pro Monthly/})).toHaveTextContent('$9.99 / month'));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.purchase).not.toHaveBeenCalled();
    expect(useEntitlementsStore.getState().pro).toBe(false);
    fireEvent.click(within(offer).getByRole('button',{name:'Not now'}));
    expect(screen.getByRole('dialog',{name:'Create an event'})).toBeVisible();
    expect(screen.queryByRole('dialog',{name:'Unlock Pro'})).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    ['King of the Court','Padel Night','koc','monthly'],
    ['King of the Court','Padel Night','koc','annual'],
  ])('continues creating %s only after store activation', async (format,name,id,plan) => {
    useEntitlementsStore.setState({pro:false});
    mocks.purchase.mockImplementation(async () => {
      useEntitlementsStore.getState().setPro(true);
      return {ok:true};
    });
    show();
    fireEvent.click(screen.getByRole('button',{name:'Create event'}));
    fireEvent.click(screen.getByRole('button',{name:`Choose format: ${format}`}));
    await act(async () => fireEvent.click(screen.getByRole('button',{name:plan === 'monthly' ? /Pro Monthly/ : /Pro Annual/})));
    expect(mocks.purchase).toHaveBeenCalledWith(plan);
    expect(mocks.create).toHaveBeenCalledWith(name,id);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useEntitlementsStore.getState().trialUsed).toBe(false);
  });
  it('keeps a cancelled store purchase on the offer without creating an event', async () => {
    useEntitlementsStore.setState({pro:false});
    mocks.purchase.mockResolvedValue({ok:false,error:'Purchase cancelled.'});
    show();
    fireEvent.click(screen.getByRole('button',{name:'Create event'}));
    fireEvent.click(screen.getByRole('button',{name:'Choose format: King of the Court'}));
    await act(async () => fireEvent.click(screen.getByRole('button',{name:/Pro Monthly/})));
    expect(screen.getByRole('dialog',{name:'Unlock Pro'})).toHaveTextContent('Purchase cancelled.');
    expect(document.querySelector('dialog')).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([true,false])('creates the chosen event after restore only with active Pro (%s)', async (active) => {
    useEntitlementsStore.setState({pro:false});
    mocks.restore.mockImplementation(async () => {
      useEntitlementsStore.getState().setPro(active);
      return {ok:true};
    });
    show();
    fireEvent.click(screen.getByRole('button',{name:'Create event'}));
    fireEvent.click(screen.getByRole('button',{name:'Choose format: King of the Court'}));
    await act(async () => fireEvent.click(screen.getByRole('button',{name:'Restore purchases'})));
    if (active) {
      expect(mocks.create).toHaveBeenCalledWith('Padel Night','koc');
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } else {
      expect(mocks.create).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog',{name:'Create an event'})).toBeVisible();
    }
  });
  it('keeps confirmation in front of permanent deletion', async () => {
    show();const row=screen.getByRole('heading',{name:'Later'}).closest('article')!;
    fireEvent.click(within(row).getByText('Delete competition'));
    expect(mocks.deleteLocal).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this competition?')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getAllByRole('button',{name:'Delete competition'}).at(-1)!));
    expect(mocks.deleteLocal).toHaveBeenCalledWith('Later');expect(mocks.deleteCloud).toHaveBeenCalledWith('Later');
  });
  it('derives display counts from the existing roster without mutating it', () => {
    const event=buildDemoEvent();event.teams[0].active=false;
    const before=JSON.stringify(event);
    const metadata=metadataForRecord({id:event.id,state:event,createdAt:1,updatedAt:1,archivedAt:null});
    expect(metadata.teamCount).toBe(event.teams.filter(team=>team.active).length);
    expect(metadata.teamCapacity).toBe(event.courts.length*2);
    expect(JSON.stringify(event)).toBe(before);
  });
});
