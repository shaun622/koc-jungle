import type { AmericanoConfigV3, MatchScoringV3, RankingTiebreakV3 } from './types';

export type PublicAmericanoRulesV3 = Pick<AmericanoConfigV3, 'pairingMode' | 'scoring' | 'ranking'>;

export function pairingModeLabelV3(mode: AmericanoConfigV3['pairingMode']): string {
  return mode === 'fixed' ? 'Fixed pairs' : 'Rotating pairs';
}

export function matchScoringLabelV3(scoring: MatchScoringV3): string {
  if (scoring.kind === 'rally') return `Rally points · ${scoring.pointsPerMatch} per match`;
  const { rule, preset, standings } = scoring;
  const match = preset === 'first-to-five' ? 'First to 5 games'
    : preset === 'short-set' ? 'One short set'
      : preset === 'standard-set' ? 'One standard set'
        : preset === 'best-of-three' ? 'Best of 3 sets'
          : preset === 'best-of-three-match-tiebreak' ? 'Best of 3 · deciding match tiebreak'
            : rule.family === 'games' ? `First to ${rule.gamesToWin} games`
              : `${rule.bestOfSets === 1 ? 'One set' : 'Best of 3 sets'} · first to ${rule.gamesToWin} games`;
  const award = `${standings.pointsPerGameWon} standings ${standings.pointsPerGameWon === 1 ? 'point' : 'points'} per game`;
  const bonus = standings.matchWinBonus ? ` · +${standings.matchWinBonus} match-win bonus` : '';
  return `${match} · ${award}${bonus}`;
}

export function tieRuleLabelV3(rule: RankingTiebreakV3): string {
  switch (rule) {
    case 'shared': return 'Tied places are shared';
    case 'difference': return 'Score difference separates ties when possible';
    case 'head-to-head': return 'Fixed-pair head-to-head, otherwise shared';
    case 'head-to-head-then-difference': return 'Head-to-head, then score difference';
  }
}

export function championshipPolicyLabelV3(policy: AmericanoConfigV3['ranking']['championship']): string {
  switch (policy) {
    case 'none': return 'Share first place';
    case 'golden-point': return 'One-point championship final';
    case 'tiebreak-7': return 'Championship tiebreak to 7, win by 2';
    case 'tiebreak-10': return 'Championship tiebreak to 10, win by 2';
  }
}

export function americanoRulesSummaryV3(config: PublicAmericanoRulesV3): string[] {
  const partnerRule = config.pairingMode === 'fixed'
    ? 'Teams stay together; standings belong to each team.'
    : 'Partners change by round; each player receives their side’s standings award.';
  return [
    `${pairingModeLabelV3(config.pairingMode)} · ${partnerRule}`,
    matchScoringLabelV3(config.scoring),
    ...(config.scoring.allowUnfinished ? ['Unfinished matches allowed: record the score played; level scores are draws. No automatic stopping.'] : []),
    tieRuleLabelV3(config.ranking.tiebreak),
    championshipPolicyLabelV3(config.ranking.championship),
  ];
}
