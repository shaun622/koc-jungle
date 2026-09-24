import { describe,expect,it } from 'vitest';
import { parseTournamentScore } from '@/components/tournament/TournamentScoreEditor';

describe('tournament score editor',()=>{
  it('keeps blank distinct from zero',()=>{expect(()=>parseTournamentScore('',null)).toThrow(/blank/i);expect(parseTournamentScore('0-0',null)).toEqual({sets:[{gamesA:0,gamesB:0}]});});
  it('parses sets and explicit tiebreak points',()=>{expect(parseTournamentScore('6-4, 7-6 (8-6)',null)).toEqual({sets:[{gamesA:6,gamesB:4},{gamesA:7,gamesB:6,tiebreakPointsA:8,tiebreakPointsB:6}]});});
});
