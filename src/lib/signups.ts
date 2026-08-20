import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';

export interface SignupEvent {
  id: string;
  ownerUserId: string;
  sourceEventId: string;
  publicSlug: string;
  title: string;
  venue: string;
  startsAt: string | null;
  endsAt: string | null;
  capacityTeams: number;
  details: string;
  prizes: string;
  isOpen: boolean;
}

export interface SignupRegistration {
  id: string;
  signupEventId: string;
  teamName: string;
  playerOne: string;
  playerTwo: string;
  contact?: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  position: number;
  createdAt: string;
}

export interface PublicSignup {
  event: Omit<SignupEvent, 'ownerUserId' | 'sourceEventId'>;
  registrations: SignupRegistration[];
}

export interface SaveSignupInput {
  ownerUserId: string;
  sourceEventId: string;
  title: string;
  venue: string;
  startsAt: string | null;
  endsAt: string | null;
  capacityTeams: number;
  details: string;
  prizes: string;
}

interface SignupEventRow {
  id: string;
  owner_user_id: string;
  source_event_id: string;
  public_slug: string;
  title: string;
  venue: string | null;
  starts_at: string | null;
  ends_at: string | null;
  capacity_teams: number;
  details: string | null;
  prizes: string | null;
  is_open: boolean;
}

interface SignupRegistrationRow {
  id: string;
  signup_event_id: string;
  team_name: string | null;
  player_one: string;
  player_two: string;
  contact: string;
  status: SignupRegistration['status'];
  created_at: string;
}

function mapEvent(row: SignupEventRow): SignupEvent {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    sourceEventId: row.source_event_id,
    publicSlug: row.public_slug,
    title: row.title,
    venue: row.venue ?? '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacityTeams: row.capacity_teams,
    details: row.details ?? '',
    prizes: row.prizes ?? '',
    isOpen: row.is_open,
  };
}

function mapRegistration(row: SignupRegistrationRow, position: number): SignupRegistration {
  return {
    id: row.id,
    signupEventId: row.signup_event_id,
    teamName: row.team_name ?? '',
    playerOne: row.player_one,
    playerTwo: row.player_two,
    contact: row.contact,
    status: row.status,
    position,
    createdAt: row.created_at,
  };
}

function requireSupabase() {
  if (!supabase) throw new Error('Online sign-up is not configured yet.');
  return supabase;
}

export async function getOwnedSignup(
  ownerUserId: string,
  sourceEventId: string,
): Promise<SignupEvent | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('signup_events')
    .select('*')
    .eq('owner_user_id', ownerUserId)
    .eq('source_event_id', sourceEventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapEvent(data as SignupEventRow) : null;
}

export async function saveSignupEvent(input: SaveSignupInput): Promise<SignupEvent> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('signup_events')
    .upsert(
      {
        owner_user_id: input.ownerUserId,
        source_event_id: input.sourceEventId,
        title: input.title.trim(),
        venue: input.venue.trim(),
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        capacity_teams: input.capacityTeams,
        details: input.details.trim(),
        prizes: input.prizes.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_user_id,source_event_id' },
    )
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapEvent(data as SignupEventRow);
}

export async function setSignupOpen(id: string, isOpen: boolean): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('signup_events')
    .update({ is_open: isOpen, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getOrganizerRegistrations(
  signupEventId: string,
): Promise<SignupRegistration[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('signup_registrations')
    .select('*')
    .eq('signup_event_id', signupEventId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const counters = { confirmed: 0, waitlisted: 0, cancelled: 0 };
  return ((data ?? []) as SignupRegistrationRow[]).map((row) => {
    counters[row.status] += 1;
    return mapRegistration(row, counters[row.status]);
  });
}

export async function getPublicSignup(publicSlug: string): Promise<PublicSignup> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_public_signup', { p_slug: publicSlug });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This sign-up link was not found.');
  return data as PublicSignup;
}

export async function registerPublicTeam(input: {
  publicSlug: string;
  teamName: string;
  playerOne: string;
  playerTwo: string;
  contact: string;
}): Promise<{ registrationId: string; cancelToken: string; status: 'confirmed' | 'waitlisted'; position: number }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('register_public_team', {
    p_slug: input.publicSlug,
    p_team_name: input.teamName.trim(),
    p_player_one: input.playerOne.trim(),
    p_player_two: input.playerTwo.trim(),
    p_contact: input.contact.trim(),
  });
  if (error) throw new Error(error.message);
  return data as {
    registrationId: string;
    cancelToken: string;
    status: 'confirmed' | 'waitlisted';
    position: number;
  };
}

export async function cancelPublicRegistration(
  publicSlug: string,
  cancelToken: string,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('cancel_public_registration', {
    p_slug: publicSlug,
    p_cancel_token: cancelToken,
  });
  if (error) throw new Error(error.message);
}

export function buildSignupUrl(publicSlug: string): string {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  let base = configured || '';
  if (!base && typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    base = `${window.location.origin}${window.location.pathname}`;
  }
  if (!base) base = 'https://koc-jungle.pages.dev/';
  return `${base.replace(/\/$/, '')}/#/signup/${publicSlug}`;
}

export async function shareSignupLink(signup: SignupEvent): Promise<void> {
  const url = buildSignupUrl(signup.publicSlug);
  const text = `${signup.title}\n${signup.venue ? `${signup.venue}\n` : ''}Register your team or join the waiting list:`;
  if (Capacitor.isNativePlatform()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: signup.title, text, url });
    return;
  }
  if (navigator.share) {
    await navigator.share({ title: signup.title, text, url });
    return;
  }
  await navigator.clipboard.writeText(`${text}\n${url}`);
}

export function registrationPairKey(playerOne: string, playerTwo: string): string {
  return [playerOne, playerTwo]
    .map((name) => name.trim().toLocaleLowerCase())
    .sort()
    .join('|');
}
