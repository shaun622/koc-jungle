import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import type { TournamentPublicProjection } from '@/logic/tournament';
import { loadPublicTournament, submitPublicTournamentPair, TournamentPublicError } from '@/lib/tournamentPublic';

const draftKey = (slug: string) => `tournament-signup:${slug}`;
type SignupDraft = { commandId: string; divisionId: string; teamName: string; playerOne: string; playerTwo: string; contact: string };

function storedDraft(slug: string): SignupDraft | null {
  try { const parsed = JSON.parse(sessionStorage.getItem(draftKey(slug)) ?? 'null') as SignupDraft | null; return parsed?.commandId ? parsed : null; }
  catch { return null; }
}

export function TournamentPublicSignup() {
  const { publicSlug = '' } = useParams();
  const [projection, setProjection] = useState<TournamentPublicProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [playerOne, setPlayerOne] = useState('');
  const [playerTwo, setPlayerTwo] = useState('');
  const [contact, setContact] = useState('');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  async function loadRemote() {
    setLoading(true); setLoadError('');
    try { const response = await loadPublicTournament(publicSlug); setProjection(response.projection); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not load tournament.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadRemote(); }, [publicSlug]);
  useEffect(() => {
    if (projection?.divisions.length && !projection.divisions.some((division) => division.id === divisionId)) setDivisionId(projection.divisions[0].id);
  }, [projection?.revision, divisionId]);
  useEffect(() => {
    const draft = storedDraft(publicSlug); if (!draft) return;
    setSubmissionId(draft.commandId); setDivisionId(draft.divisionId); setTeamName(draft.teamName); setPlayerOne(draft.playerOne); setPlayerTwo(draft.playerTwo); setContact(draft.contact);
  }, [publicSlug]);

  const invalidateSubmission = () => { setSubmissionId(null); sessionStorage.removeItem(draftKey(publicSlug)); setMessage(''); };
  const division = projection?.divisions.find((item) => item.id === divisionId) ?? projection?.divisions[0];
  const entries = projection?.entries.filter((entry) => entry.divisionId === division?.id) ?? [];
  const confirmed = entries.filter((entry) => entry.admission === 'confirmed');
  const waiting = entries.filter((entry) => entry.admission === 'waiting');
  const started = projection?.startsAt ? Date.parse(projection.startsAt) <= Date.now() : false;
  const open = Boolean(projection?.signupOpen && projection.lifecycle === 'setup' && !started);
  const date = useMemo(() => projection?.startsAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: projection.timeZone }).format(new Date(projection.startsAt)) : 'Date to be confirmed', [projection?.startsAt, projection?.timeZone]);

  async function submit() {
    if (!projection || !division || submitting) return;
    const commandId = submissionId ?? crypto.randomUUID();
    const draft = { commandId, divisionId: division.id, teamName, playerOne, playerTwo, contact };
    sessionStorage.setItem(draftKey(publicSlug), JSON.stringify(draft)); setSubmissionId(commandId); setSubmitting(true); setMessage('');
    try {
      const response = await submitPublicTournamentPair(publicSlug, { ...draft, tournamentId: projection.tournamentId });
      const admission = response.result?.admission ?? response.admission;
      setMessage(admission === 'waiting' ? 'Your pair is on the waiting list.' : 'Your pair is confirmed.');
      sessionStorage.removeItem(draftKey(publicSlug)); setSubmissionId(null);
      setTeamName(''); setPlayerOne(''); setPlayerTwo(''); setContact('');
      await loadRemote();
    } catch (error) {
      const retry = error instanceof TournamentPublicError && error.retryAfter ? ` Retry in ${error.retryAfter} seconds.` : '';
      setMessage(`${error instanceof Error ? error.message : 'Could not register this pair.'}${retry}`);
    } finally { setSubmitting(false); }
  }

  if (loading && !projection) return <div className="splash">Loading tournament…</div>;
  if (!projection || !division) return <div className="splash tv1-missing"><p>{loadError || 'Tournament not found.'}</p><button className="btn primary" onClick={() => void loadRemote()}>Retry</button></div>;
  return <div className="tv1 tv1-public"><header className="tv1-public-head"><div className="tv1-brand"><BrandLogo/><span>PADEL<small>TOURNAMENT MAKER</small></span></div><ThemeSwitch/></header><main className="tv1-public-main">
    <section className="tv1-public-hero"><p className="eyebrow">LIVE TOURNAMENT SIGN-UP</p><h1>{projection.title}</h1><div className="tv1-public-meta"><span>{date}</span>{projection.venue && <span>{projection.venue}</span>}</div><div className={`tv1-public-state ${open ? 'open' : 'closed'}`}><strong>{open ? `${Math.max(0, division.capacity - division.confirmed)} pair spaces left` : 'Registration closed'}</strong><span>{open ? 'Confirmed places fill first. Overflow pairs join the waiting list.' : started ? 'This tournament has started.' : 'The organiser has closed new entries.'}</span></div></section>
    {projection.divisions.length > 1 && <label className="tv1-public-division">Division<select value={division.id} onChange={(event) => { invalidateSubmission(); setDivisionId(event.target.value); }}>{projection.divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {loadError && <div className="tv1-alert error" role="alert">Latest refresh failed: {loadError} <button className="tv1-link-button" onClick={() => void loadRemote()}>Retry</button></div>}
    <div className="tv1-public-grid"><section className="tv1-panel"><div className="tv1-panel-head"><div><p className="eyebrow">LIVE LIST</p><h2>Pairs</h2></div><strong>{confirmed.length}/{division.capacity}</strong></div><div className="tv1-public-list">{confirmed.map((entry,index) => <div key={entry.id}><span>{index + 1}</span><div><strong>{entry.label}</strong><small>{entry.players.join(' & ')}</small></div></div>)}{!confirmed.length && <p>No confirmed pairs yet.</p>}</div><h3>Waiting list <span>{waiting.length}</span></h3><div className="tv1-public-list">{waiting.map((entry,index) => <div key={entry.id}><span>{index + 1}</span><div><strong>{entry.label}</strong><small>Waiting</small></div></div>)}{!waiting.length && <p>Nobody waiting.</p>}</div></section>
      <section className="tv1-panel"><p className="eyebrow">NO ACCOUNT NEEDED</p><h2>Register your pair</h2>{message && <div className="tv1-alert" role="status">{message}</div>}<label>Team name (optional)<input value={teamName} maxLength={80} onChange={(event) => { invalidateSubmission(); setTeamName(event.target.value); }}/></label><label>Player one<input value={playerOne} maxLength={80} onChange={(event) => { invalidateSubmission(); setPlayerOne(event.target.value); }}/></label><label>Player two<input value={playerTwo} maxLength={80} onChange={(event) => { invalidateSubmission(); setPlayerTwo(event.target.value); }}/></label><label>WhatsApp or phone (private)<input value={contact} maxLength={100} onChange={(event) => { invalidateSubmission(); setContact(event.target.value); }}/></label><button className="btn primary wide" disabled={submitting || !open || !playerOne.trim() || !playerTwo.trim()} onClick={() => void submit()}>{submitting ? 'Registering…' : submissionId ? 'Retry registration' : 'Register our pair'}</button><small>Contact details are visible only to the organiser.</small></section></div>
  </main></div>;
}
