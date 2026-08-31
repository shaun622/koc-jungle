import { Capacitor } from '@capacitor/core';
import { publicSupabase, supabase } from '@/lib/supabase';

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
  /** Server compare-and-swap revision for organiser metadata/capacity writes. */
  capacityRevision: number;
  details: string;
  prizes: string;
  isOpen: boolean;
  autoAddPairs: boolean;
  /** Non-null once the legacy/local tournament roster has completed its
   * one-time, server-guarded import into the canonical registration list. */
  rosterSeededAt: string | null;
  /** Non-null once starting play has atomically fixed capacity and closed the
   * public roster. Only an explicit organiser reset can unlock it. */
  rosterLockedAt: string | null;
}

export interface SignupRegistration {
  id: string;
  signupEventId: string;
  teamName: string;
  playerOne: string;
  playerTwo: string;
  contact?: string;
  playerTwoContact?: string;
  status: 'confirmed' | 'waitlisted' | 'looking' | 'cancelled';
  position: number;
  createdAt: string;
  updatedAt?: string;
  /** When this entry first became a complete pair. A solo joining later must
   * enter the pair queue at that later time, not at the solo's sign-up time. */
  pairCompletedAt?: string | null;
  organizerRank?: number | null;
}

export interface SignupTeamIdentity {
  signupRegistrationId?: string;
  signupPairKey?: string;
  playerOne: string;
  playerTwo: string;
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
  autoAddPairs: boolean;
}

export interface PublicSignup {
  event: Omit<
    SignupEvent,
    | 'ownerUserId'
    | 'sourceEventId'
    | 'autoAddPairs'
    | 'capacityRevision'
    | 'rosterSeededAt'
    | 'rosterLockedAt'
  >;
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
  autoAddPairs: boolean;
  /** Known server signup id. Omit only for first publish/legacy callers. */
  signupEventId?: string;
  /** Last capacityRevision read from the server; use 0 only for first publish. */
  baseRevision: number;
  /** Preserve the current open state when omitted. */
  isOpen?: boolean;
}

/** One complete pair in the organiser's tournament roster. The database id is
 * deliberately optional: legacy/local teams are adopted by their exact pair
 * once, then the returned registration id becomes their stable identity. */
export interface OrganizerSignupRosterTeam {
  registrationId?: string;
  teamName?: string;
  playerOne: string;
  playerTwo: string;
  contact?: string;
  rank: number;
}

/** The current authoritative event is returned on both success and conflict. */
export interface SignupEventMutationResult {
  event: SignupEvent;
  applied: boolean;
  conflict: boolean;
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
  capacity_revision?: number | null;
  details: string | null;
  prizes: string | null;
  is_open: boolean;
  auto_add_pairs: boolean;
  roster_seeded_at?: string | null;
  roster_locked_at?: string | null;
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
  updated_at?: string;
  pair_completed_at?: string | null;
  organizer_rank?: number | null;
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
  auto_add_pairs: boolean;
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
    capacityRevision: row.capacity_revision ?? 0,
    details: row.details ?? '',
    prizes: row.prizes ?? '',
    isOpen: row.is_open,
    autoAddPairs: row.auto_add_pairs ?? true,
    rosterSeededAt: row.roster_seeded_at ?? null,
    rosterLockedAt: row.roster_locked_at ?? null,
  };
}

interface OrganizerSignupMutationResponse {
  applied: boolean;
  conflict: boolean;
  capacityRevision: number;
  event: SignupEventRow;
}

function mapSignupMutation(data: unknown): SignupEventMutationResult {
  if (!data || typeof data !== 'object') {
    throw new Error('The sign-up server returned an invalid response. Refresh and try again.');
  }
  const response = data as Partial<OrganizerSignupMutationResponse>;
  if (!response.event || typeof response.applied !== 'boolean' || typeof response.conflict !== 'boolean') {
    throw new Error('The sign-up server returned an invalid response. Refresh and try again.');
  }
  const event = mapEvent(response.event);
  // Prefer the explicit RPC field during rollout, while the row value remains
  // the canonical representation once every environment has the migration.
  if (Number.isSafeInteger(response.capacityRevision) && (response.capacityRevision ?? -1) >= 0) {
    event.capacityRevision = response.capacityRevision as number;
  }
  return {
    event,
    applied: response.applied,
    conflict: response.conflict,
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
    updatedAt: row.updated_at,
    pairCompletedAt: row.pair_completed_at ?? null,
    organizerRank: row.organizer_rank ?? null,
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
    autoAddPairs: row.auto_add_pairs ?? true,
  };
}

function requireSupabase() {
  if (!supabase) throw new Error('Online sign-up is not configured yet.');
  return supabase;
}

function requirePublicSupabase() {
  if (!publicSupabase) throw new Error('Online sign-up is not configured yet.');
  return publicSupabase;
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
        auto_add_pairs: input.autoAddPairs,
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

export async function saveSignupEvent(input: SaveSignupInput): Promise<SignupEventMutationResult> {
  const client = requireSupabase();
  const accountSlug = normaliseSignupLinkPart(input.accountSlug, 'organiser');
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error('Refresh this sign-up before saving it again.');
  }
  if (!input.signupEventId && input.baseRevision !== 0) {
    throw new Error('A new sign-up must start at revision 0.');
  }
  const signupEventId = input.signupEventId ?? null;
  const { data, error } = await client.rpc('organizer_save_signup_event', {
    p_source_event_id: input.sourceEventId,
    p_account_slug: accountSlug,
    p_title: input.title.trim(),
    p_venue: input.venue.trim(),
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_expected_capacity: input.capacityTeams,
    p_base_revision: input.baseRevision,
    p_details: input.details.trim(),
    p_prizes: input.prizes.trim(),
    p_auto_add_pairs: input.autoAddPairs,
    p_signup_event_id: signupEventId,
    p_is_open: input.isOpen ?? null,
  });
  if (error) throw new Error(error.message);
  return mapSignupMutation(data);
}

export async function setSignupOpen(
  id: string,
  isOpen: boolean,
  sourceEventId: string,
  baseRevision: number,
): Promise<SignupEventMutationResult> {
  const client = requireSupabase();
  if (!sourceEventId || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Error('Refresh this sign-up before changing registrations.');
  }
  const { data, error } = await client.rpc('organizer_set_signup_open', {
    p_signup_event_id: id,
    p_source_event_id: sourceEventId,
    p_is_open: isOpen,
    p_base_revision: baseRevision,
  });
  if (error) throw new Error(error.message);
  return mapSignupMutation(data);
}

/** Atomically set the court-derived capacity, rebalance, close registrations,
 * and lock the roster before local play starts. */
export async function lockSignupRoster(
  id: string,
  sourceEventId: string,
  capacityTeams: number,
  baseRevision: number,
): Promise<SignupEventMutationResult> {
  const client = requireSupabase();
  if (
    !sourceEventId
    || !Number.isSafeInteger(capacityTeams)
    || capacityTeams < 0
    || !Number.isSafeInteger(baseRevision)
    || baseRevision < 0
  ) {
    throw new Error('Refresh this sign-up before starting the tournament.');
  }
  const { data, error } = await client.rpc('organizer_lock_signup_roster', {
    p_signup_event_id: id,
    p_source_event_id: sourceEventId,
    p_expected_capacity: capacityTeams,
    p_base_revision: baseRevision,
  });
  if (error) throw new Error(error.message);
  return mapSignupMutation(data);
}

/** Unlock a roster only as part of an explicit organiser reset. It remains
 * closed until the organiser chooses to reopen registrations. */
export async function unlockSignupRoster(
  id: string,
  sourceEventId: string,
  baseRevision: number,
): Promise<SignupEventMutationResult> {
  const client = requireSupabase();
  if (!sourceEventId || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Error('Refresh this sign-up before resetting the tournament.');
  }
  const { data, error } = await client.rpc('organizer_unlock_signup_roster', {
    p_signup_event_id: id,
    p_source_event_id: sourceEventId,
    p_base_revision: baseRevision,
  });
  if (error) throw new Error(error.message);
  return mapSignupMutation(data);
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
    const statusOrder = { confirmed: 0, waitlisted: 1, looking: 2, cancelled: 3 };
    const statusDifference = statusOrder[a.status] - statusOrder[b.status];
    if (statusDifference) return statusDifference;
    const pairDifference = Number(Boolean(b.player_two?.trim())) - Number(Boolean(a.player_two?.trim()));
    if (pairDifference) return pairDifference;
    const rankDifference = (a.organizer_rank ?? Number.MAX_SAFE_INTEGER)
      - (b.organizer_rank ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference) return rankDifference;
    const completedDifference = (a.pair_completed_at ?? a.created_at)
      .localeCompare(b.pair_completed_at ?? b.created_at);
    if (completedDifference) return completedDifference;
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
  const counters = { confirmed: 0, waitlisted: 0, looking: 0, cancelled: 0 };
  return rows.map((row) => {
    counters[row.status] += 1;
    return mapRegistration(row, counters[row.status]);
  });
}

export async function updateOrganizerRegistration(
  registrationId: string,
  patch: { teamName: string; playerOne: string; playerTwo: string; contact?: string },
  expected: {
    status: Exclude<SignupRegistration['status'], 'cancelled'>;
    updatedAt: string | undefined;
    allowLocked?: boolean;
  },
): Promise<void> {
  if (!expected.updatedAt) {
    throw new Error('Refresh this registration before editing it.');
  }
  const client = requireSupabase();
  const { error } = await client.rpc('organizer_update_signup_registration_guarded', {
    p_registration_id: registrationId,
    p_team_name: patch.teamName.trim(),
    p_player_one: patch.playerOne.trim(),
    p_player_two: patch.playerTwo.trim(),
    p_contact: patch.contact === undefined ? null : patch.contact.trim(),
    p_expected_status: expected.status,
    p_expected_updated_at: expected.updatedAt,
    p_allow_locked: expected.allowLocked ?? false,
  });
  if (error) throw new Error(error.message);
}

export async function addOrganizerSignupPair(
  signupEventId: string,
  input: { teamName: string; playerOne: string; playerTwo: string; contact?: string },
  allowLocked = false,
): Promise<SignupRegistration> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('organizer_add_signup_pair', {
    p_signup_event_id: signupEventId,
    p_team_name: input.teamName.trim(),
    p_player_one: input.playerOne.trim(),
    p_player_two: input.playerTwo.trim(),
    p_contact: input.contact?.trim() || null,
    p_allow_locked: allowLocked,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') {
    throw new Error('The sign-up server returned an invalid team. Refresh and try again.');
  }
  const row = data as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || typeof row.signupEventId !== 'string'
    || typeof row.playerOne !== 'string'
    || typeof row.playerTwo !== 'string'
    || !['confirmed', 'waitlisted', 'looking', 'cancelled'].includes(String(row.status))
  ) {
    throw new Error('The sign-up server returned an invalid team. Refresh and try again.');
  }
  return {
    id: row.id,
    signupEventId: row.signupEventId,
    teamName: typeof row.teamName === 'string' ? row.teamName : '',
    playerOne: row.playerOne,
    playerTwo: row.playerTwo,
    contact: typeof row.contact === 'string' ? row.contact : undefined,
    status: row.status as SignupRegistration['status'],
    position: 0,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
    pairCompletedAt: typeof row.pairCompletedAt === 'string' ? row.pairCompletedAt : null,
    organizerRank: typeof row.organizerRank === 'number' ? row.organizerRank : null,
  };
}

export async function deleteOrganizerRegistration(registrationId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('organizer_delete_signup_registration', {
    p_registration_id: registrationId,
  });
  if (error) throw new Error(error.message);
}

export async function deleteOrganizerWaitlistedRegistration(registrationId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('organizer_delete_waitlisted_signup_registration', {
    p_registration_id: registrationId,
  });
  if (error) throw new Error(error.message);
}

export async function reorderOrganizerRegistrations(
  signupEventId: string,
  registrationIds: string[],
): Promise<void> {
  if (registrationIds.length === 0) return;
  const client = requireSupabase();
  const { error } = await client.rpc('organizer_reorder_signup_registrations', {
    p_event_id: signupEventId,
    p_registration_ids: registrationIds,
  });
  if (error) throw new Error(error.message);
}

function normalizeOrganizerRosterTeams(teams: OrganizerSignupRosterTeam[]) {
  return teams.map((team, index) => ({
    registrationId: team.registrationId || null,
    teamName: team.teamName?.trim() || '',
    playerOne: team.playerOne.trim(),
    playerTwo: team.playerTwo.trim(),
    contact: team.contact?.trim() || '',
    rank: Number.isSafeInteger(team.rank) && team.rank > 0 ? team.rank : index + 1,
  }));
}

export interface OrganizerSignupRosterSeedResult {
  /** True when this request performed the import. False means another request
   * had already completed it, so retrying after an uncertain network result is
   * safe and never replays stale device state. */
  seeded: boolean;
}

/**
 * Import a local roster exactly once. The server owns the null-to-seeded
 * transition, including when `teams` is empty, making an interrupted first
 * publish safely retryable.
 */
export async function seedOrganizerSignupRoster(
  signupEventId: string,
  teams: OrganizerSignupRosterTeam[],
): Promise<OrganizerSignupRosterSeedResult> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('organizer_seed_signup_roster', {
    p_signup_event_id: signupEventId,
    p_teams: normalizeOrganizerRosterTeams(teams),
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || typeof (data as { seeded?: unknown }).seeded !== 'boolean') {
    throw new Error('The sign-up server returned an invalid roster response. Refresh and try again.');
  }
  return { seeded: (data as { seeded: boolean }).seeded };
}

/**
 * Make the organiser's visible setup roster canonical for an online sign-up.
 * Existing public registrations are adopted rather than duplicated; complete
 * pairs not present in this array remain in their server-managed waiting order.
 */
export async function syncOrganizerSignupRoster(
  signupEventId: string,
  teams: OrganizerSignupRosterTeam[],
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('organizer_sync_signup_roster', {
    p_signup_event_id: signupEventId,
    p_teams: normalizeOrganizerRosterTeams(teams),
  });
  if (error) throw new Error(error.message);
}

export async function deleteOrganizerRegistrationIfStatus(
  registrationId: string,
  expectedStatus: Exclude<SignupRegistration['status'], 'cancelled'>,
  expectedUpdatedAt: string | undefined,
  allowLocked = false,
): Promise<void> {
  if (!expectedUpdatedAt) {
    throw new Error('Refresh this registration before removing it.');
  }
  const client = requireSupabase();
  const { error } = await client.rpc('organizer_delete_signup_registration_if_status', {
    p_registration_id: registrationId,
    p_expected_status: expectedStatus,
    p_expected_updated_at: expectedUpdatedAt,
    p_allow_locked: allowLocked,
  });
  if (error) throw new Error(error.message);
}

export async function getPublicSignup(publicSlug: string, accountSlug?: string): Promise<PublicSignup> {
  const client = requirePublicSupabase();
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
}): Promise<{ registrationId: string; status: 'confirmed' | 'waitlisted' | 'looking'; position: number }> {
  const client = requirePublicSupabase();
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
    status: 'confirmed' | 'waitlisted' | 'looking';
    position: number;
  };
}

export async function joinPublicSingle(input: {
  accountSlug?: string;
  publicSlug: string;
  registrationId: string;
  playerName: string;
  contact: string;
}): Promise<{ registrationId: string; status: 'confirmed' | 'waitlisted' | 'looking'; position: number }> {
  const client = requirePublicSupabase();
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
    status: 'confirmed' | 'waitlisted' | 'looking';
    position: number;
  };
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

/** Match a local organiser roster team to its authoritative online row.
 * The stored registration id wins. The original pair key deliberately comes
 * next so a locally renamed team can still find the older public row and push
 * the organiser's edit to it. */
export function findSignupRegistrationForTeam(
  registrations: SignupRegistration[],
  team: SignupTeamIdentity,
): SignupRegistration | undefined {
  if (team.signupRegistrationId) {
    // A persisted id is an ownership link, not merely a hint. If it no longer
    // exists, the local team is stale and must never fall through to a newly
    // registered pair with the same names.
    return registrations.find((registration) => registration.id === team.signupRegistrationId);
  }
  const pairKey = team.signupPairKey
    ?? registrationPairKey(team.playerOne, team.playerTwo);
  return registrations.find((registration) =>
    registration.playerTwo
    && registrationPairKey(registration.playerOne, registration.playerTwo) === pairKey);
}
