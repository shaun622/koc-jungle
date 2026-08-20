import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';

export interface SignupEvent {
  id: string;
  ownerUserId: string;
  sourceEventId: string;
  publicSlug: string;
  accountSlug: string;
  eventSlug: string;
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
  playerTwoContact?: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  position: number;
  createdAt: string;
}

export interface SignupTemplate {
  id: string;
  ownerUserId: string;
  name: string;
  title: string;
  venue: string;
  capacityTeams: number;
  details: string;
  prizes: string;
  startsWeekday: number | null;
  startsTime: string;
  durationMinutes: number | null;
}

export interface PublicSignup {
  event: Omit<SignupEvent, 'ownerUserId' | 'sourceEventId'>;
  registrations: SignupRegistration[];
}

export interface SaveSignupInput {
  ownerUserId: string;
  sourceEventId: string;
  accountSlug: string;
  title: string;
  venue: string;
  startsAt: string | null;
  endsAt: string | null;
  capacityTeams: number;
  details: string;
  prizes: string;
}

export interface SaveSignupTemplateInput extends Omit<SignupTemplate, 'id'> {}

interface SignupEventRow {
  id: string;
  owner_user_id: string;
  source_event_id: string;
  public_slug: string;
  friendly_slug: string | null;
  account_slug: string | null;
  event_slug: string | null;
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
  player_two: string | null;
  contact: string;
  player_two_contact: string | null;
  status: SignupRegistration['status'];
  created_at: string;
}

interface SignupTemplateRow {
  id: string;
  owner_user_id: string;
  name: string;
  title: string;
  venue: string | null;
  capacity_teams: number;
  details: string | null;
  prizes: string | null;
  starts_weekday: number | null;
  starts_time: string | null;
  duration_minutes: number | null;
}

function mapEvent(row: SignupEventRow): SignupEvent {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    sourceEventId: row.source_event_id,
    publicSlug: row.friendly_slug || row.public_slug,
    accountSlug: row.account_slug || 'organiser',
    eventSlug: row.event_slug || row.friendly_slug || row.public_slug,
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
    playerTwo: row.player_two ?? '',
    contact: row.contact,
    playerTwoContact: row.player_two_contact ?? undefined,
    status: row.status,
    position,
    createdAt: row.created_at,
  };
}

function mapTemplate(row: SignupTemplateRow): SignupTemplate {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    title: row.title,
    venue: row.venue ?? '',
    capacityTeams: row.capacity_teams,
    details: row.details ?? '',
    prizes: row.prizes ?? '',
    startsWeekday: row.starts_weekday,
    startsTime: row.starts_time?.slice(0, 5) ?? '',
    durationMinutes: row.duration_minutes,
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

export async function getSignupAccountSlug(ownerUserId: string): Promise<string | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('signup_events')
    .select('account_slug')
    .eq('owner_user_id', ownerUserId)
    .not('account_slug', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.account_slug as string | undefined) ?? null;
}

export async function getSignupTemplates(ownerUserId: string): Promise<SignupTemplate[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('signup_templates')
    .select('*')
    .eq('owner_user_id', ownerUserId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SignupTemplateRow[]).map(mapTemplate);
}

export async function saveSignupTemplate(input: SaveSignupTemplateInput): Promise<SignupTemplate> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('signup_templates')
    .upsert(
      {
        owner_user_id: input.ownerUserId,
        name: input.name.trim(),
        title: input.title.trim(),
        venue: input.venue.trim(),
        capacity_teams: input.capacityTeams,
        details: input.details.trim(),
        prizes: input.prizes.trim(),
        starts_weekday: input.startsWeekday,
        starts_time: input.startsTime || null,
        duration_minutes: input.durationMinutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_user_id,name' },
    )
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapTemplate(data as SignupTemplateRow);
}

export async function deleteSignupTemplate(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('signup_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveSignupEvent(input: SaveSignupInput): Promise<SignupEvent> {
  const client = requireSupabase();
  const accountSlug = normaliseSignupLinkPart(input.accountSlug, 'organiser');
  const { data, error } = await client
    .from('signup_events')
    .upsert(
      {
        owner_user_id: input.ownerUserId,
        source_event_id: input.sourceEventId,
        account_slug: accountSlug,
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
  const rows = ((data ?? []) as SignupRegistrationRow[]).sort((a, b) => {
    const statusOrder = { confirmed: 0, waitlisted: 1, cancelled: 2 };
    const statusDifference = statusOrder[a.status] - statusOrder[b.status];
    if (statusDifference) return statusDifference;
    const pairDifference = Number(Boolean(b.player_two?.trim())) - Number(Boolean(a.player_two?.trim()));
    if (pairDifference) return pairDifference;
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
  const counters = { confirmed: 0, waitlisted: 0, cancelled: 0 };
  return rows.map((row) => {
    counters[row.status] += 1;
    return mapRegistration(row, counters[row.status]);
  });
}

export async function getPublicSignup(publicSlug: string, accountSlug?: string): Promise<PublicSignup> {
  const client = requireSupabase();
  const args = accountSlug
    ? { p_account_slug: accountSlug, p_event_slug: publicSlug }
    : { p_share_slug: publicSlug };
  const { data, error } = await client.rpc('get_public_signup', args);
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This sign-up link was not found.');
  return data as PublicSignup;
}

export async function registerPublicTeam(input: {
  accountSlug?: string;
  publicSlug: string;
  teamName: string;
  playerOne: string;
  playerTwo: string;
  contact: string;
}): Promise<{ registrationId: string; cancelToken: string; status: 'confirmed' | 'waitlisted'; position: number }> {
  const client = requireSupabase();
  const slugArgs = input.accountSlug
    ? { p_account_slug: input.accountSlug, p_event_slug: input.publicSlug }
    : { p_share_slug: input.publicSlug };
  const { data, error } = await client.rpc('register_public_team', {
    ...slugArgs,
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

export async function joinPublicSingle(input: {
  accountSlug?: string;
  publicSlug: string;
  registrationId: string;
  playerName: string;
  contact: string;
}): Promise<{ registrationId: string; status: 'confirmed' | 'waitlisted'; position: number }> {
  const client = requireSupabase();
  const slugArgs = input.accountSlug
    ? { p_account_slug: input.accountSlug, p_event_slug: input.publicSlug }
    : { p_share_slug: input.publicSlug };
  const { data, error } = await client.rpc('join_public_single', {
    ...slugArgs,
    p_registration_id: input.registrationId,
    p_player_two: input.playerName.trim(),
    p_contact: input.contact.trim(),
  });
  if (error) throw new Error(error.message);
  return data as {
    registrationId: string;
    status: 'confirmed' | 'waitlisted';
    position: number;
  };
}

export async function cancelPublicRegistration(
  publicSlug: string,
  cancelToken: string,
  accountSlug?: string,
): Promise<void> {
  const client = requireSupabase();
  const slugArgs = accountSlug
    ? { p_account_slug: accountSlug, p_event_slug: publicSlug }
    : { p_share_slug: publicSlug };
  const { error } = await client.rpc('cancel_public_registration', {
    ...slugArgs,
    p_cancel_token: cancelToken,
  });
  if (error) throw new Error(error.message);
}

export function normaliseSignupLinkPart(value: string, fallback = 'event'): string {
  const normalised = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalised || fallback;
}

export function defaultSignupAccountSlug(email: string | undefined, userId: string): string {
  return normaliseSignupLinkPart(email?.split('@')[0] || `organiser-${userId.slice(0, 6)}`, 'organiser');
}

export function buildSignupUrl(publicSlug: string, accountSlug?: string): string {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  let base = configured || '';
  if (!base && typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    base = `${window.location.origin}${window.location.pathname}`;
  }
  if (!base) base = 'https://koc-jungle.pages.dev/';
  const signupPath = accountSlug ? `${accountSlug}/${publicSlug}` : publicSlug;
  return `${base.replace(/\/$/, '')}/signup/${signupPath}`;
}

export function isPublicSignupPath(pathname: string): boolean {
  return pathname.startsWith('/signup/');
}

export function publicSignupHashFromPath(pathname: string, search = ''): string | null {
  const match = pathname.match(
    /^\/signup\/([a-z0-9][a-z0-9-]{0,79})(?:\/([a-z0-9][a-z0-9-]{0,119}))?\/?$/i,
  );
  if (!match) return null;
  const route = match[2] ? `${match[1]}/${match[2]}` : match[1];
  return `#/signup/${route}${search}`;
}

export async function copySignupLink(signup: SignupEvent): Promise<void> {
  const url = buildSignupUrl(signup.eventSlug, signup.accountSlug);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = url;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Could not copy the link. Select the address and copy it manually.');
}

export async function shareSignupLink(signup: SignupEvent): Promise<void> {
  const url = buildSignupUrl(signup.eventSlug, signup.accountSlug);
  const text = `${signup.title}\n${signup.venue ? `${signup.venue}\n` : ''}Register as a pair or solo player:`;
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

export function signupRegistrationPlayerCount(registration: Pick<SignupRegistration, 'playerTwo'>): number {
  return registration.playerTwo.trim() ? 2 : 1;
}

export function signupPlayerCount(registrations: Array<Pick<SignupRegistration, 'playerTwo'>>): number {
  return registrations.reduce((total, registration) => total + signupRegistrationPlayerCount(registration), 0);
}
