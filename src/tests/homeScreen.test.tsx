import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(), archive: vi.fn(), deleteLocal: vi.fn(), deleteCloud: vi.fn(), create: vi.fn(),
  getSignup: vi.fn(), copyLink: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({useAuth: () => ({ user: {id:'owner-1',email:'organiser@example.com'},cloudEnabled:true })}));
vi.mock('@/store/cloudSync', () => ({deleteCloudEvent:mocks.deleteCloud}));
vi.mock('@/components/AppMenu', () => ({AppMenu: ({onCreate}:{onCreate:()=>void}) => <button onClick={onCreate}>Menu create event</button>}));
vi.mock('@/lib/signups', () => ({getOwnedSignup:mocks.getSignup,copySignupLink:mocks.copyLink}));

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
  useEntitlementsStore.setState({pro:true});
  mocks.select.mockResolvedValue(null);mocks.archive.mockResolvedValue(undefined);mocks.deleteLocal.mockResolvedValue(undefined);
  useEventCatalogStore.setState({events,hydrated:true,lastError:null});
  useEventStore.setState({event:null,selectEventById:mocks.select,archiveLocalEvent:mocks.archive,deleteLocalEvent:mocks.deleteLocal,createEvent:mocks.create});
});

describe('event library presentation', () => {
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
    fireEvent.click(within(dialog).getByRole('button',{name:/King of the Court Fixed pairs/}));
    expect(mocks.create).toHaveBeenCalledWith('Padel Night','koc');
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
