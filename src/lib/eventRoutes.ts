import type { EventState, EventStatus } from '@/types/domain';

export type EventRouteName =
  | 'setup'
  | 'qualifier'
  | 'seeding'
  | 'display'
  | 'leaderboard';

export function eventRoute(eventId: string, route: EventRouteName): string {
  return `/events/${encodeURIComponent(eventId)}/${route}`;
}

export function routeNameForStatus(status: EventStatus): EventRouteName {
  switch (status) {
    case 'qualifier':
      return 'qualifier';
    case 'seeding':
      return 'seeding';
    case 'round-in-progress':
    case 'between-rounds':
    case 'complete':
      return 'display';
    case 'setup':
    default:
      return 'setup';
  }
}

export function eventRouteForStatus(event: EventState): string {
  return eventRoute(event.id, routeNameForStatus(event.status));
}

export function eventIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/events\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
