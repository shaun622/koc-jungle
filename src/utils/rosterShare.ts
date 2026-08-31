import { Capacitor } from '@capacitor/core';
import { buildSignupUrl, type SignupEvent, type SignupRegistration } from '@/lib/signups';
import type { EventState, Team } from '@/types/domain';
import { buildSignupRosterView } from '@/utils/signupRosterView';

export interface RosterShareResult {
  ok: boolean;
  copied?: boolean;
  error?: string;
}

function numbered(index: number): string {
  return `${index + 1}.`;
}

function normalizedName(value: string | undefined): string {
  return value
    ?.trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase() ?? '';
}

function normalizedPairKey(playerOne: string, playerTwo: string): string {
  return [playerOne, playerTwo]
    .map(normalizedName)
    .sort()
    .join('|');
}

function formatSchedule(signup?: SignupEvent | null): string[] {
  if (!signup?.startsAt) return [];
  const start = new Date(signup.startsAt);
  if (Number.isNaN(start.getTime())) return [];
  const end = signup.endsAt ? new Date(signup.endsAt) : null;
  const day = start.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const startTime = start.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  const endTime = end && !Number.isNaN(end.getTime())
    ? end.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : null;
  return [`📅 ${day}`, `⏰ ${startTime}${endTime ? `–${endTime}` : ''}`];
}

function teamLines(team: Team, index: number): string[] {
  const playerNames = `${team.players[0].name} & ${team.players[1].name}`;
  const teamName = team.name?.trim();
  return teamName
    ? [`${numbered(index)} ${teamName}`, `   👥 ${playerNames}`]
    : [`${numbered(index)} ${playerNames}`];
}

function waitingLine(registration: SignupRegistration, index: number): string {
  if (!registration.playerTwo) return `${index + 1}. ${registration.playerOne} — looking for a partner`;
  const players = `${registration.playerOne} & ${registration.playerTwo}`;
  return registration.teamName?.trim()
    ? `${index + 1}. ${registration.teamName} — ${players}`
    : `${index + 1}. ${players}`;
}

export function buildRosterShareText(input: {
  event: EventState;
  teams: Team[];
  signup?: SignupEvent | null;
  registrations?: SignupRegistration[];
}): string {
  const { event, teams, signup, registrations = [] } = input;
  const title = (signup?.title || event.name || 'Padel event').trim();
  const venue = (signup?.venue || event.venue || '').trim();
  const capacity = event.courts.length * 2;
  const confirmedTeams = teams.filter((team) => team.active);
  const representedRegistrationIds = new Set(
    confirmedTeams
      .map((team) => team.signupRegistrationId)
      .filter((id): id is string => Boolean(id)),
  );
  const representedPairKeys = new Set(
    confirmedTeams.map((team) => normalizedPairKey(
      team.players[0].name,
      team.players[1].name,
    )),
  );
  const rosterView = buildSignupRosterView(registrations, capacity);
  const isAlreadyRepresented = (registration: SignupRegistration): boolean =>
    representedRegistrationIds.has(registration.id)
    || (
      Boolean(registration.playerTwo?.trim())
      && representedPairKeys.has(normalizedPairKey(
        registration.playerOne,
        registration.playerTwo,
      ))
    );
  const lines = [`🎾 ${title.toLocaleUpperCase()}`, ''];

  if (venue) lines.push(`📍 ${venue}`);
  lines.push(...formatSchedule(signup));
  lines.push(`👥 ${confirmedTeams.length} of ${capacity} teams confirmed`, '');

  confirmedTeams.forEach((team, index) => {
    lines.push(...teamLines(team, index), '');
  });

  const soloPlayers = rosterView.lookingForPartner
    .filter((registration) => !isAlreadyRepresented(registration));
  if (soloPlayers.length > 0) {
    lines.push('👤 LOOKING FOR A PARTNER');
    soloPlayers.forEach((registration, index) => lines.push(waitingLine(registration, index)));
    lines.push('');
  }

  const waitingPairs = rosterView.waitlistedPairs
    .filter((registration) => !isAlreadyRepresented(registration));
  if (waitingPairs.length > 0) {
    lines.push('⏳ WAITING LIST');
    waitingPairs.forEach((registration, index) => lines.push(waitingLine(registration, index)));
    lines.push('');
  }

  if (signup) {
    lines.push('🔗 Sign up or view the live list:');
    lines.push(buildSignupUrl(signup.eventSlug, signup.accountSlug));
  }

  return lines.join('\n').trim();
}

export function whatsappRosterUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export async function copyRosterText(text: string): Promise<RosterShareResult> {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, copied: true };
  } catch (err) {
    console.warn('[share] roster copy failed', err);
    return { ok: false, error: 'Could not copy the roster text.' };
  }
}

export async function shareRosterText(title: string, text: string): Promise<RosterShareResult> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text });
      return { ok: true };
    } catch (err) {
      const message = (err as { message?: string }).message ?? '';
      if (/cancel/i.test(message)) return { ok: true };
      console.warn('[share] native roster share failed', err);
    }
  } else if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return { ok: true };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return { ok: true };
      console.warn('[share] web roster share failed', err);
    }
  }

  return copyRosterText(text);
}
