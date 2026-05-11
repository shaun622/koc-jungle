import type { EventState } from '@/types/domain';
import { DEFAULT_SETTINGS } from '@/types/domain';
import { newId } from './idGen';

const DEMO_PAIRS: Array<[string, string, string?]> = [
  ['Jon', 'Sven'],
  ['Chris DH', 'William'],
  ['Dave G', 'Justin H'],
  ['Luke', 'Bart'],
  ['Jang', 'Rolan'],
  ['Antoine', 'Darren'],
  ['Mark B', 'Matthias'],
  ['Oli', 'Will'],
  ['Maxime', 'Jonas'],
  ['Andy S', 'Zach'],
  ['Wallace', 'Patrick'],
  ['Nikil', 'Ramon'],
  ['Jeroen', 'Alex'],
  ['Tom WH', 'David'],
];

export function buildDemoEvent(): EventState {
  const courts = Array.from({ length: 7 }, (_, i) => {
    const position = i + 1;
    const isCentre = position === 7;
    return {
      id: newId(),
      position,
      name: isCentre ? 'Centre Court' : `Court ${position}`,
      pointValue: position + 2,
    };
  });

  const teams = DEMO_PAIRS.map(([p1, p2, name]) => ({
    id: newId(),
    name,
    createdAt: Date.now(),
    active: true,
    players: [
      { id: newId(), name: p1 },
      { id: newId(), name: p2 },
    ] as [{ id: string; name: string }, { id: string; name: string }],
  }));

  return {
    id: newId(),
    name: 'Monday Night KOC',
    venue: 'High Court Padel',
    createdAt: Date.now(),
    status: 'setup',
    settings: { ...DEFAULT_SETTINGS },
    courts,
    teams,
    rounds: [],
  };
}
