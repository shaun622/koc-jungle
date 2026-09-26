import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { applyExternalEventToActiveFacade, saveEventToLocalCatalog, useEventStore } from '@/store/eventStore';
import { flushCloudEvent } from '@/store/cloudSync';
import { isAmericanoEventV3 } from '@/logic/eventVersions';
import { eventRoute } from '@/lib/eventRoutes';
import { getOrganizerSignupV3, type SignupSnapshotV3 } from '@/lib/americanoV2';
import { saveAmericanoConfigV3, saveAmericanoEventV3, saveAmericanoSignupV3, startAmericanoV3 } from '@/lib/americanoV3';
import { buildSignupUrl, defaultSignupAccountSlug } from '@/lib/signups';
import { americanoRulesSummaryV3, matchScoringLabelV3 } from '@/logic/americanoV3/labels';
import type { PairingMode, VersionedEventState } from '@/logic/americanoV2/types';
import {
  addAmericanoFixedTeamV3,
  addAmericanoParticipantV3,
  previewAmericanoScheduleV3,
  removeAmericanoFixedTeamV3,
  removeAmericanoParticipantV3,
  replaceAmericanoCourtsV3,
  startAmericanoEventV3,
  updateAmericanoConfigV3,
  updateAmericanoFixedTeamV3,
  updateAmericanoParticipantV3,
} from '@/logic/americanoV3/runtime';
import { AMERICANO_V3_TRADITIONAL_PRESETS, validateAmericanoConfigV3 } from '@/logic/americanoV3/scoring';
import type { AmericanoEventStateV3, TraditionalPresetKey, TraditionalRule } from '@/logic/americanoV3/types';

import { AmericanoSessionPlanner } from './AmericanoSessionPlanner';
import { applySessionPlan } from '@/logic/americanoV3/sessionPlan';

function localDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function isoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

interface SignupDraftV3 {
  accountSlug: string;
  title: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  details: string;
  prizes: string;
  timeZone: string;
  organizerName: string;
  publicContactMethod: '' | 'whatsapp' | 'email';
  publicContactValue: string;
}

export function AmericanoSetupV3({ event }: { event: AmericanoEventStateV3 }) {
  const loadEvent = useEventStore((state) => state.loadEvent);
  const navigate = useNavigate();
  const auth = useAuth();
  const [playerName, setPlayerName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [playerOne, setPlayerOne] = useState('');
  const [playerTwo, setPlayerTwo] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pointsDraft, setPointsDraft] = useState(String(event.formatConfig.scoring.kind === 'rally' ? event.formatConfig.scoring.pointsPerMatch : 24));
  const [configDraft, setConfigDraft] = useState(() => structuredClone(event.formatConfig));
  const [customRuleDraft, setCustomRuleDraft] = useState<TraditionalRule>(() => event.formatConfig.scoring.kind === 'traditional'
    ? event.formatConfig.scoring.rule
    : AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule);
  const [roundDraft, setRoundDraft] = useState(String(event.formatConfig.customRounds ?? 1));
  const [signup, setSignup] = useState<SignupSnapshotV3 | null>(null);
  const [signupDraft, setSignupDraft] = useState<SignupDraftV3>(() => ({
    accountSlug: defaultSignupAccountSlug(auth.user?.email, auth.user?.id ?? event.id),
    title: event.name, venue: event.venue ?? '', startsAt: '', endsAt: '', details: '', prizes: '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', organizerName: '',
    publicContactMethod: '', publicContactValue: '',
  }));
  const editable = event.status === 'setup';
  const fixed = configDraft.pairingMode === 'fixed';
  const entrants = fixed ? event.teams.filter((team) => team.active) : event.participants.filter((player) => player.active);
  const capacity = event.courts.length * (fixed ? 2 : 4);
  const scoring = configDraft.scoring;
  const presetOptions = useMemo(() => Object.entries(AMERICANO_V3_TRADITIONAL_PRESETS) as Array<[Exclude<TraditionalPresetKey, 'custom'>, (typeof AMERICANO_V3_TRADITIONAL_PRESETS)[Exclude<TraditionalPresetKey, 'custom'>]]>, []);

  function commit(next: AmericanoEventStateV3) {
    loadEvent(next);
    setMessage('');
  }

  async function syncedEvent(): Promise<AmericanoEventStateV3> {
    await flushCloudEvent(event.id);
    const current = useEventStore.getState().event as VersionedEventState | null;
    if (!current || !isAmericanoEventV3(current) || current.id !== event.id) throw new Error('The selected event changed. Open it again.');
    return current;
  }

  async function acceptSaved(next: AmericanoEventStateV3) {
    await saveEventToLocalCatalog(next, { makeActive: true });
    applyExternalEventToActiveFacade(next);
  }

  function updateConfig(patch: Parameters<typeof updateAmericanoConfigV3>[1]) {
    setConfigDraft((current) => {
      const next = { ...current, ...patch, ranking: patch.ranking ? { ...current.ranking, ...patch.ranking } : current.ranking };
      if (next.pairingMode === 'rotating' && next.ranking.tiebreak.startsWith('head-to-head')) next.ranking = { ...next.ranking, tiebreak: 'shared' };
      if (next.scheduleKind !== 'custom') delete next.customRounds;
      else next.customRounds ??= 1;
      return next;
    });
    setMessage('');
  }

  function setMode(mode: PairingMode) {
    if (mode === configDraft.pairingMode) return;
    try {
      const checked = updateAmericanoConfigV3({ ...event, formatConfig: configDraft }, { pairingMode: mode });
      setConfigDraft(checked.formatConfig);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Pairing mode could not be changed.'); }
  }

  // Cloud acknowledgements clone the event, including unchanged rules. Compare
  // their values so a roster save cannot erase the organizer's unsaved choices.
  const savedConfigJson = JSON.stringify(event.formatConfig);
  useEffect(() => {
    const savedConfig = JSON.parse(savedConfigJson) as AmericanoEventStateV3['formatConfig'];
    setConfigDraft(savedConfig);
    setPointsDraft(String(savedConfig.scoring.kind === 'rally' ? savedConfig.scoring.pointsPerMatch : 24));
    setRoundDraft(String(savedConfig.customRounds ?? 1));
    setCustomRuleDraft(savedConfig.scoring.kind === 'traditional'
      ? savedConfig.scoring.rule : AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule);
  }, [event.id, savedConfigJson]);

  useEffect(() => {
    let cancelled = false;
    if (!event.settings.publishedSignupId || !auth.user || !auth.cloudEnabled) {
      setSignup(null);
      return;
    }
    void getOrganizerSignupV3(event.settings.publishedSignupId).then((snapshot) => {
      if (cancelled) return;
      setSignup(snapshot);
      setSignupDraft({
        accountSlug: snapshot.accountSlug, title: snapshot.title, venue: snapshot.venue,
        startsAt: localDateTime(snapshot.startsAt), endsAt: localDateTime(snapshot.endsAt),
        details: snapshot.details, prizes: snapshot.prizes,
        timeZone: snapshot.timeZone || 'UTC', organizerName: snapshot.organizerName,
        publicContactMethod: snapshot.publicContactMethod ?? '', publicContactValue: snapshot.publicContactValue,
      });
    }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : 'The published sign-up could not be loaded.');
    });
    return () => { cancelled = true; };
  }, [auth.cloudEnabled, auth.user, event.id, event.settings.publishedSignupId]);

  async function saveRulesToEvent(): Promise<AmericanoEventStateV3> {
    const base = auth.cloudEnabled && auth.user ? await syncedEvent() : event;
    const count = configDraft.pairingMode === 'fixed' ? base.teams.filter((team) => team.active).length : base.participants.filter((player) => player.active).length;
    // Signups can be published before entrants arrive. Save the preference now;
    // calculate its schedule from the confirmed roster when previewing later.
    const plannedConfig = count < (configDraft.pairingMode === 'fixed' ? 2 : 4) ? configDraft : applySessionPlan(configDraft, count, base.courts.length);
    validateAmericanoConfigV3(plannedConfig);
    const configChanged = JSON.stringify(plannedConfig) !== JSON.stringify(base.formatConfig);
    let next = configChanged ? updateAmericanoConfigV3(base, { ...plannedConfig, sessionPlan: plannedConfig.sessionPlan }) : base;
    if (auth.cloudEnabled && auth.user) {
      if (base.revision === '0') {
        const created = await saveAmericanoEventV3(next, '0', undefined, auth.user.id);
        if (created.status === 'rejected') throw new Error(created.message);
        if (created.status === 'conflict') throw new Error('This event changed on another device. Reload before saving settings.');
        next = created.snapshot.event.state;
      } else {
        const signup = next.settings.publishedSignupId ? await getOrganizerSignupV3(next.settings.publishedSignupId) : null;
        const saved = await saveAmericanoConfigV3({
          eventId: next.id, baseEventRevision: base.revision,
          signupEventId: signup?.id ?? null,
          baseCapacityRevision: signup?.capacityRevision ?? '0',
          baseRosterRevision: signup?.rosterRevision ?? '0',
          courts: next.courts, config: next.formatConfig,
          ownerId: auth.user.id,
        });
        if (saved.status === 'rejected') throw new Error(saved.message);
        if (saved.status === 'conflict') throw new Error('This event or signup changed on another device. Reload before saving settings.');
        next = saved.snapshot.event.state;
      }
    }
    if (auth.cloudEnabled && auth.user) await acceptSaved(next);
    else commit(next);
    return next;
  }

  async function publishSignup() {
    if (!auth.user || !auth.cloudEnabled) {
      setMessage('Sign in with cloud sync enabled to publish a public sign-up page.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const configured = await saveRulesToEvent();
      const linkedSignup = configured.settings.publishedSignupId
        ? await getOrganizerSignupV3(configured.settings.publishedSignupId)
        : null;
      const initialEntries: Array<Record<string, unknown>> = linkedSignup ? [] : configured.formatConfig.pairingMode === 'fixed'
        ? configured.teams.filter((team) => team.active).map((team, index) => ({
          localEntrantId: team.id, teamName: team.name ?? '', playerOne: team.players[0].name,
          playerTwo: team.players[1].name, contact: '', rank: index + 1,
        }))
        : configured.participants.filter((player) => player.active).map((player, index) => ({
          localEntrantId: player.id, playerOne: player.name, playerTwo: '', contact: '', rank: index + 1,
        }));
      const startsAt = isoDateTime(signupDraft.startsAt);
      const endsAt = isoDateTime(signupDraft.endsAt);
      if (signupDraft.startsAt && !startsAt) throw new Error('Choose a valid event start time.');
      if (signupDraft.endsAt && !endsAt) throw new Error('Choose a valid event end time.');
      const reply = await saveAmericanoSignupV3({
        eventId: configured.id,
        baseEventRevision: configured.revision,
        signupEventId: linkedSignup?.id ?? null,
        baseCapacityRevision: linkedSignup?.capacityRevision ?? '0',
        baseRosterRevision: linkedSignup?.rosterRevision ?? '0',
        ownerId: auth.user.id,
        metadata: {
          accountSlug: signupDraft.accountSlug.trim(), title: signupDraft.title.trim(), venue: signupDraft.venue.trim(),
          startsAt, endsAt, details: signupDraft.details, prizes: signupDraft.prizes,
          timeZone: signupDraft.timeZone.trim(), organizerName: signupDraft.organizerName.trim(),
          publicContactMethod: signupDraft.publicContactMethod, publicContactValue: signupDraft.publicContactValue.trim(),
        },
        initialEntries,
      });
      if (reply.status === 'rejected') throw new Error(reply.message);
      if (reply.status === 'conflict') throw new Error('The event or signup changed on another device. Reload before publishing again.');
      await acceptSaved(reply.snapshot.event.state);
      setSignup(reply.snapshot.signup);
      setMessage(reply.snapshot.signup ? `Sign-up page ${linkedSignup ? 'updated' : 'published'} · ${buildSignupUrl(reply.snapshot.signup.eventSlug, reply.snapshot.signup.accountSlug)}` : 'The server did not return the published sign-up.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The sign-up page could not be published.'); }
    finally { setBusy(false); }
  }

  async function saveRules() {
    setBusy(true);
    setMessage('');
    try { await saveRulesToEvent(); setMessage('Rules saved. Refresh the schedule preview before starting play.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Rules could not be saved.'); }
    finally { setBusy(false); }
  }

  async function preview() {
    setBusy(true);
    setMessage('');
    try {
      const configured = await saveRulesToEvent();
      const publishedRoster = configured.settings.publishedSignupId && auth.cloudEnabled && auth.user
        ? await getOrganizerSignupV3(configured.settings.publishedSignupId) : null;
      const next = await previewAmericanoScheduleV3(configured, {
        rosterRevision: publishedRoster?.rosterRevision ?? '0',
        acknowledgeUnevenAppearances: !!configured.formatConfig.sessionPlan,
        acknowledgeRepeatedCycle: !!configured.formatConfig.sessionPlan,
      });
      commit(next);
      setMessage(`Preview ready · ${next.americanoSchedule?.rounds.length ?? 0} rounds · ${next.americanoSchedule?.metrics.maximumAppearanceSpread ? 'appearance counts vary' : 'equal appearances'}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Schedule preview failed.'); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!event.americanoSchedule) return;
    setBusy(true);
    setMessage('');
    try {
      if (JSON.stringify(configDraft) !== JSON.stringify(event.formatConfig)) {
        throw new Error('Your rules have unsaved changes. Save them and refresh the schedule preview first.');
      }
      let base = event;
      if (auth.cloudEnabled && auth.user) {
        base = await syncedEvent();
      }
      const next = startAmericanoEventV3(base);
      if (auth.cloudEnabled && auth.user) {
        const signup = next.settings.publishedSignupId ? await getOrganizerSignupV3(next.settings.publishedSignupId) : null;
        const reply = await startAmericanoV3({
          eventId: next.id,
          baseEventRevision: base.revision,
          signupEventId: signup?.id ?? null,
          baseCapacityRevision: signup?.capacityRevision ?? '0',
          baseRosterRevision: signup?.rosterRevision ?? '0',
          ownerId: auth.user.id,
          startState: next,
        });
        if (reply.status === 'rejected') throw new Error(reply.message);
        if (reply.status === 'conflict') throw new Error('This event or sign-up roster changed on another device. Reload before starting.');
        await acceptSaved(reply.snapshot.event.state);
        navigate(eventRoute(next.id, 'display'));
        return;
      }
      commit(next);
      navigate(eventRoute(next.id, 'display'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The event could not be started.'); }
    finally { setBusy(false); }
  }

  if (!editable) return <main className="amv3-setup"><section className="amv3-panel"><p className="amv3-eyebrow">AMERICANO · {fixed ? 'FIXED PAIRS' : 'ROTATING PAIRS'}</p><h1>{event.name}</h1><p>Rules and roster are frozen after the event starts. Results, score corrections and standings are managed on the live event screen.</p><button className="btn primary" onClick={() => navigate(eventRoute(event.id, 'display'))}>Open event desk</button></section></main>;

  return <main className="amv3-setup">
    <section className="amv3-panel amv3-hero"><div><p className="amv3-eyebrow">AMERICANO SETUP · RULES 3</p><h1>{event.name || 'Americano'}</h1><p>{fixed ? 'Stay with your partner. Points belong to each team.' : 'Change partners each round. Points belong to each player.'}</p></div>
      <div className="amv3-mode" role="group" aria-label="Pairing mode"><button type="button" className={!fixed ? 'active' : ''} onClick={() => setMode('rotating')}>Rotating pairs</button><button type="button" className={fixed ? 'active' : ''} onClick={() => setMode('fixed')}>Fixed pairs</button></div>
    </section>
    <div className="amv3-grid">
      <section className="amv3-panel"><header><h2>Rules & schedule</h2><p>Match format, standings rewards and tie policy.</p></header>
        <AmericanoSessionPlanner config={configDraft} entrants={entrants.length} courts={event.courts.length} startsAt={signupDraft.startsAt} onChange={(sessionPlan) => setConfigDraft((current) => {
          const next = { ...current };
          if (sessionPlan) { next.sessionPlan = sessionPlan; next.paceClockEnabled = true; }
          else delete next.sessionPlan;
          return next;
        })}/>
        <div className="amv3-fields">
          <label><span>Match format</span><select value={scoring.kind} onChange={(e) => {
            if (e.target.value === 'rally') updateConfig({ scoring: { kind: 'rally', pointsPerMatch: Number(pointsDraft) || 24, ...(scoring.allowUnfinished !== undefined ? { allowUnfinished: scoring.allowUnfinished } : {}) } });
            else updateConfig({ scoring: { kind: 'traditional', preset: 'first-to-five', rule: AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule, standings: { pointsPerGameWon: 1, matchWinBonus: 0 }, ...(scoring.allowUnfinished !== undefined ? { allowUnfinished: scoring.allowUnfinished } : {}) } });
          }}><option value="rally">Rally points</option><option value="traditional">Games / sets</option></select></label>
          {scoring.kind === 'rally' ? <label><span>Points per match</span><input type="number" min={1} max={2_147_483_647} value={pointsDraft} onChange={(e) => setPointsDraft(e.target.value)} onBlur={() => { const value = Number(pointsDraft); if (Number.isInteger(value) && value > 0) updateConfig({ scoring: { ...scoring, pointsPerMatch: value } }); }} /></label> : <>
            <label><span>Traditional format</span><select value={scoring.preset} onChange={(e) => {
              const preset = e.target.value as TraditionalPresetKey;
              if (preset === 'custom') {
                setCustomRuleDraft(scoring.rule);
                updateConfig({ scoring: { ...scoring, preset: 'custom' } });
              } else {
                const rule = AMERICANO_V3_TRADITIONAL_PRESETS[preset].rule;
                updateConfig({ scoring: { ...scoring, preset, rule } });
                setCustomRuleDraft(rule);
              }
            }}>{presetOptions.map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}<option value="custom">Custom rules</option></select></label>
            <label><span>Points per game won</span><input type="number" min={1} max={1000} value={scoring.standings.pointsPerGameWon} onChange={(e) => updateConfig({ scoring: { ...scoring, standings: { ...scoring.standings, pointsPerGameWon: Number(e.target.value) } } })} /></label>
            <label><span>Match-win bonus</span><input type="number" min={0} max={1000} value={scoring.standings.matchWinBonus} onChange={(e) => updateConfig({ scoring: { ...scoring, standings: { ...scoring.standings, matchWinBonus: Number(e.target.value) } } })} /></label>
            <p className="amv3-note">Every game counts, including games in lost matches. A match winner may earn fewer standings points unless you add a win bonus.</p>
            {scoring.preset === 'custom' && <div className="amv3-custom-rule"><h3>Custom match rule</h3><div className="amv3-fields">
              <label><span>Scoring family</span><select value={customRuleDraft.family} onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, family: e.target.value as TraditionalRule['family'] }))}><option value="games">First to games</option><option value="sets">Sets</option></select></label>
              <label><span>Best of sets</span><select value={customRuleDraft.bestOfSets} onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, bestOfSets: Number(e.target.value) as 1 | 3 }))}><option value={1}>One set</option><option value={3}>Best of three</option></select></label>
              <label><span>Games to win</span><input type="number" min={1} max={99} value={customRuleDraft.gamesToWin} onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, gamesToWin: Number(e.target.value) }))} /></label>
              <label><span>Game margin</span><select value={customRuleDraft.gameMargin} onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, gameMargin: Number(e.target.value) as 1 | 2 }))}><option value={1}>Win by 1</option><option value={2}>Win by 2</option></select></label>
              <label><span>Tiebreak starts at games-all</span><input type="number" min={1} max={99} value={customRuleDraft.tiebreakTrigger ?? ''} placeholder="No tiebreak" onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, tiebreakTrigger: e.target.value ? Number(e.target.value) : null, tiebreakTarget: e.target.value ? rule.tiebreakTarget ?? 7 : null }))} /></label>
              <label><span>Tiebreak target</span><input type="number" min={1} max={99} value={customRuleDraft.tiebreakTarget ?? ''} onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, tiebreakTarget: e.target.value ? Number(e.target.value) : null, tiebreakTrigger: e.target.value ? rule.tiebreakTrigger ?? Math.max(1, rule.gamesToWin - 1) : null }))} /></label>
              <label><span>Deciding third-set tiebreak</span><select value={customRuleDraft.decidingMatchTiebreak ?? ''} onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, decidingMatchTiebreak: e.target.value ? Number(e.target.value) as 7 | 10 : null }))}><option value="">Play a full set</option><option value={7}>First to 7</option><option value={10}>First to 10</option></select></label>
              <label><span>Game ending</span><select value={customRuleDraft.gameEnding} onChange={(e) => setCustomRuleDraft((rule) => ({ ...rule, gameEnding: e.target.value as TraditionalRule['gameEnding'] }))}><option value="advantage">Advantage</option><option value="golden-point">Golden point</option><option value="star-point">Star point</option></select></label>
            </div><button type="button" className="btn" onClick={() => {
              try { validateAmericanoConfigV3({ ...configDraft, scoring: { ...scoring, rule: customRuleDraft } }); updateConfig({ scoring: { ...scoring, rule: customRuleDraft } }); }
              catch (error) { setMessage(error instanceof Error ? error.message : 'Check the custom rule fields.'); }
            }}>Apply custom rule</button></div>}
          </>}
          <label className="amv3-check"><input type="checkbox" checked={scoring.allowUnfinished === true} onChange={(e) => updateConfig({ scoring: { ...scoring, allowUnfinished: e.target.checked } })}/><span>Allow unfinished matches<small>Record the score played when time runs out. Level scores are draws; points are never scaled up.</small></span></label>
          {!configDraft.sessionPlan && <>
            <label><span>Schedule</span><select value={configDraft.scheduleKind} onChange={(e) => updateConfig({ scheduleKind: e.target.value as AmericanoEventStateV3['formatConfig']['scheduleKind'] })}><option value="full">Full rotation</option><option value="balanced">Balanced schedule</option><option value="custom">Custom rounds</option></select></label>
            {configDraft.scheduleKind === 'custom' && <label><span>Rounds (1–64)</span><input type="number" min={1} max={64} value={roundDraft} onChange={(e) => setRoundDraft(e.target.value)} onBlur={() => updateConfig({ customRounds: Math.max(1, Math.min(64, Number(roundDraft) || 1)) })} /></label>}
            <label><span>Estimated pace (minutes)</span><input type="number" min={1} max={240} value={configDraft.paceMinutes || ''} onChange={(e) => setConfigDraft((current) => ({ ...current, paceMinutes: Number(e.target.value) }))}/></label>
          </>}
          <label><span>Standings tie rule</span><select value={configDraft.ranking.tiebreak} onChange={(e) => updateConfig({ ranking: { ...configDraft.ranking, tiebreak: e.target.value as AmericanoEventStateV3['formatConfig']['ranking']['tiebreak'] } })}><option value="shared">Share tied places</option><option value="difference">Score difference</option>{fixed && <><option value="head-to-head">Head-to-head</option><option value="head-to-head-then-difference">Head-to-head, then difference</option></>}</select></label>
          <label><span>If two still tie for first</span><select value={configDraft.ranking.championship} onChange={(e) => updateConfig({ ranking: { ...configDraft.ranking, championship: e.target.value as AmericanoEventStateV3['formatConfig']['ranking']['championship'] } })}><option value="none">Share first place</option><option value="golden-point">One golden point</option><option value="tiebreak-7">Tiebreak to 7 (win by 2)</option><option value="tiebreak-10">Tiebreak to 10 (win by 2)</option></select></label>
          <label className="amv3-check"><input type="checkbox" checked={configDraft.paceClockEnabled} onChange={(e) => updateConfig({ paceClockEnabled: e.target.checked })} /><span>Show advisory pace clock <small>It never ends a match or forces a result.</small></span></label>
        </div>
        <p className="amv3-help">Score difference means rally points won minus lost, or games won minus lost. It can still leave a tie. Finals decide first place only; three or more tied leaders share first.</p>
        <div className="amv3-rules-summary" role="region" aria-label="Rules summary"><strong>Rules summary</strong>{americanoRulesSummaryV3(configDraft).map((line) => <span key={line}>{line}</span>)}</div>
      </section>

      <section className="amv3-panel"><header className="amv3-section-head"><div><h2>Courts</h2><p>{event.courts.length} available · capacity {capacity} {fixed ? 'teams' : 'players'}</p></div><button type="button" className="btn" disabled={event.courts.length >= 16} onClick={() => updateCourts([...event.courts, { id: crypto.randomUUID(), position: event.courts.length + 1, name: `Court ${event.courts.length + 1}`, pointValue: 1 }])}>+ Add court</button></header>
        <div className="amv3-roster">{event.courts.map((court, index) => <div className="amv3-court-row" key={court.id}><span>{index + 1}</span><input aria-label={`Court ${index + 1} name`} value={court.name} onChange={(e) => updateCourts(event.courts.map((item) => item.id === court.id ? { ...item, name: e.target.value } : item))} /><button className="btn" disabled={event.courts.length <= 1} onClick={() => updateCourts(event.courts.filter((item) => item.id !== court.id))} aria-label={`Remove ${court.name}`}>Remove</button></div>)}</div>
      </section>

      <section className="amv3-panel amv3-roster-panel"><header><h2>{fixed ? 'Teams' : 'Players'}</h2><p>{entrants.length}/{capacity} confirmed. Overflow is not auto-added; sign-up needs to be managed before play.</p></header>
        {fixed ? <div className="amv3-add-row"><input placeholder="Team name (optional)" value={teamName} onChange={(e) => setTeamName(e.target.value)} /><input placeholder="Player one" value={playerOne} onChange={(e) => setPlayerOne(e.target.value)} /><input placeholder="Player two" value={playerTwo} onChange={(e) => setPlayerTwo(e.target.value)} /><button className="btn primary" onClick={() => { try { commit(addAmericanoFixedTeamV3(event, { teamName, playerOne, playerTwo })); setTeamName(''); setPlayerOne(''); setPlayerTwo(''); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add team.'); } }}>Add team</button></div>
          : <div className="amv3-add-row"><input placeholder="Player name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} /><button className="btn primary" onClick={() => { try { commit(addAmericanoParticipantV3(event, playerName)); setPlayerName(''); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add player.'); } }}>Add player</button></div>}
        <div className="amv3-roster">{fixed ? event.teams.filter((team) => team.active).map((team) => <div className="amv3-roster-row" key={team.id}><input aria-label="Team name" placeholder="Team name" value={team.name ?? ''} onChange={(e) => updateTeam(team.id, e.target.value, team.players[0].name, team.players[1].name)} /><input aria-label="Player one" value={team.players[0].name} onChange={(e) => updateTeam(team.id, team.name ?? '', e.target.value, team.players[1].name)} /><input aria-label="Player two" value={team.players[1].name} onChange={(e) => updateTeam(team.id, team.name ?? '', team.players[0].name, e.target.value)} /><button className="btn" onClick={() => commit(removeAmericanoFixedTeamV3(event, team.id))}>Remove</button></div>) : event.participants.filter((player) => player.active).map((player) => <div className="amv3-roster-row" key={player.id}><input aria-label="Player name" value={player.name} onChange={(e) => commit(updateAmericanoParticipantV3(event, player.id, e.target.value))} /><button className="btn" onClick={() => commit(removeAmericanoParticipantV3(event, player.id))}>Remove</button></div>)}</div>
        {entrants.length < (fixed ? 2 : 4) && <p className="amv3-help">Add at least {fixed ? 'two complete teams' : 'four players'} to preview a schedule.</p>}
      </section>
    </div>
    <section className="amv3-panel amv3-signup-panel">
      <header><h2>Public sign-up</h2><p>Publish or update the registration page. The live event uses its confirmed roster as the source of truth.</p></header>
      <div className="amv3-fields">
        <label><span>Page address name</span><input value={signupDraft.accountSlug} onChange={(e) => setSignupDraft((draft) => ({ ...draft, accountSlug: e.target.value }))} /></label>
        <label><span>Event title</span><input value={signupDraft.title} onChange={(e) => setSignupDraft((draft) => ({ ...draft, title: e.target.value }))} /></label>
        <label><span>Venue</span><input value={signupDraft.venue} onChange={(e) => setSignupDraft((draft) => ({ ...draft, venue: e.target.value }))} /></label>
        <label><span>Starts</span><input type="datetime-local" value={signupDraft.startsAt} onChange={(e) => setSignupDraft((draft) => ({ ...draft, startsAt: e.target.value }))} /></label>
        <label><span>Ends</span><input type="datetime-local" value={signupDraft.endsAt} onChange={(e) => setSignupDraft((draft) => ({ ...draft, endsAt: e.target.value }))} /></label>
        <label><span>Time zone</span><input value={signupDraft.timeZone} onChange={(e) => setSignupDraft((draft) => ({ ...draft, timeZone: e.target.value }))} /></label>
        <label><span>Organizer name</span><input value={signupDraft.organizerName} onChange={(e) => setSignupDraft((draft) => ({ ...draft, organizerName: e.target.value }))} /></label>
        <label><span>Contact method</span><select value={signupDraft.publicContactMethod} onChange={(e) => setSignupDraft((draft) => ({ ...draft, publicContactMethod: e.target.value as SignupDraftV3['publicContactMethod'] }))}><option value="">None</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
        {signupDraft.publicContactMethod && <label><span>Public contact</span><input value={signupDraft.publicContactValue} onChange={(e) => setSignupDraft((draft) => ({ ...draft, publicContactValue: e.target.value }))} /></label>}
        <label><span>Details</span><textarea value={signupDraft.details} onChange={(e) => setSignupDraft((draft) => ({ ...draft, details: e.target.value }))} /></label>
        <label><span>Prizes & extras</span><textarea value={signupDraft.prizes} onChange={(e) => setSignupDraft((draft) => ({ ...draft, prizes: e.target.value }))} /></label>
      </div>
      {signup && <p className="amv3-help">Published page: <a href={buildSignupUrl(signup.eventSlug, signup.accountSlug)} target="_blank" rel="noreferrer">{buildSignupUrl(signup.eventSlug, signup.accountSlug)}</a> · {matchScoringLabelV3(configDraft.scoring)}</p>}
      <button type="button" className="btn primary" disabled={busy || !auth.cloudEnabled || !auth.user} onClick={() => void publishSignup()}>{busy ? 'Publishing…' : signup ? 'Update sign-up page' : 'Publish sign-up page'}</button>
      {!auth.cloudEnabled && <p className="amv3-help">Sign in with cloud sync enabled to publish online. Local testing remains available without publishing.</p>}
    </section>
    <section className="amv3-panel amv3-actions"><div><h2>Schedule preview</h2><p>{event.americanoSchedule ? `${event.americanoSchedule.rounds.length} rounds · ${event.americanoSchedule.rounds.reduce((sum, round) => sum + round.matches.length, 0)} matches · ${event.americanoSchedule.metrics.maximumAppearanceSpread ? `up to ${event.americanoSchedule.metrics.maximumAppearanceSpread} appearance difference` : 'equal appearances'}` : 'Fixtures stay editable until the event starts.'}</p></div><div className="amv3-action-buttons"><button className="btn" disabled={busy} onClick={() => void saveRules()}>{busy ? 'Saving…' : 'Save rules'}</button><button className="btn" disabled={busy || entrants.length < (fixed ? 2 : 4)} onClick={() => void preview()}>{busy ? 'Preparing…' : event.americanoSchedule ? 'Refresh preview' : 'Preview schedule'}</button><button className="btn primary" disabled={busy || !event.americanoSchedule || entrants.length < (fixed ? 2 : 4)} onClick={() => void start()}>Start event</button></div></section>
    {message && <p className="amv3-message" role="status">{message}</p>}
  </main>;

  function updateCourts(courts: AmericanoEventStateV3['courts']) {
    try { commit(replaceAmericanoCourtsV3(event, courts)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Courts could not be updated.'); }
  }
  function updateTeam(id: string, nextName: string, one: string, two: string) {
    try { commit(updateAmericanoFixedTeamV3(event, id, { teamName: nextName, playerOne: one, playerTwo: two })); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Team details could not be updated.'); }
  }
}
