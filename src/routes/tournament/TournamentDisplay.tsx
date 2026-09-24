import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { humanScore, type TournamentPublicProjection } from '@/logic/tournament';
import { loadPublicTournament } from '@/lib/tournamentPublic';

const COURTS_PER_PAGE = 4;
const STANDINGS_PER_PAGE = 16;

export function TournamentDisplay() {
  const { publicSlug = '' } = useParams();
  const [state, setState] = useState<TournamentPublicProjection | null>(null);
  const [verifiedAt, setVerifiedAt] = useState(0);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [, tick] = useState(0);

  async function refresh() {
    try {
      const response = await loadPublicTournament(publicSlug);
      setState((current) => current?.revision === response.projection.revision ? current : response.projection);
      setVerifiedAt(Date.now()); setError('');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Display refresh failed.'); }
  }

  const standings = useMemo(() => state?.standings.flatMap((group) => group.rows.map((row) => ({ ...row, groupName: group.name }))) ?? [], [state]);
  const courtPageCount = Math.max(1,Math.ceil((state?.courts.length ?? 0)/COURTS_PER_PAGE));
  const standingPageCount = Math.max(1,Math.ceil(standings.length/STANDINGS_PER_PAGE));
  const pageCount = Math.max(courtPageCount,standingPageCount);

  useEffect(() => { void refresh(); const id=globalThis.setInterval(()=>void refresh(),5_000); return()=>globalThis.clearInterval(id); }, [publicSlug]);
  useEffect(() => { const id=globalThis.setInterval(()=>tick((value)=>value+1),1_000); return()=>globalThis.clearInterval(id); }, []);
  useEffect(() => { if(paused||pageCount<=1)return; const id=globalThis.setInterval(()=>setPage((value)=>(value+1)%pageCount),8_000); return()=>globalThis.clearInterval(id); }, [pageCount,paused]);
  useEffect(() => { if(page>=pageCount)setPage(0); }, [page,pageCount]);

  if(!state)return <div className="splash tv1-missing"><p>{error||'Loading committed tournament display…'}</p>{error&&<button className="btn primary" onClick={()=>void refresh()}>Retry</button>}</div>;
  const stale=!verifiedAt||Date.now()-verifiedAt>30_000;
  const courts=[...state.courts].sort((a,b)=>a.name.localeCompare(b.name)).slice(page*COURTS_PER_PAGE,page*COURTS_PER_PAGE+COURTS_PER_PAGE);
  const visibleStandings=standings.slice(page*STANDINGS_PER_PAGE,page*STANDINGS_PER_PAGE+STANDINGS_PER_PAGE);
  const playing=state.fixtures.filter((fixture)=>fixture.status==='playing'||fixture.status==='suspended');

  return <div className="tv1 tv1-tv"><header><div className="tv1-brand"><BrandLogo/><span>{state.title}<small>COMMITTED LIVE TOURNAMENT</small></span></div><div>{state.entries.filter((entry)=>entry.admission==='confirmed').length} PAIRS · {state.courts.filter((court)=>court.available).length} COURTS</div><ThemeSwitch/></header><main>
    <section className="tv1-tv-hero"><div><p className="eyebrow">NOW PLAYING</p><h1>{playing.length?`${playing.length} matches live`:'Courts ready'}</h1></div><div className="tv1-tv-status"><span className={stale||error?'tv1-tv-stale':''}>{stale?'OFFLINE / STALE · ':''}Last verified {verifiedAt?new Date(verifiedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'pending'}</span><button className="btn" onClick={()=>setPaused((value)=>!value)}>{paused?'Resume pages':'Pause pages'}</button><span>Page {page+1}/{pageCount}</span></div></section>
    {error&&<div className="tv1-alert error">{error} The last verified display remains visible.</div>}
    <div className="tv1-tv-layout"><section className="tv1-tv-standings"><h2>Standings</h2>{visibleStandings.length?visibleStandings.map((row,index)=><article key={`${row.groupName}:${row.label}:${index}`}><span>{page*STANDINGS_PER_PAGE+index+1}</span><div><strong>{row.label}</strong><small>{row.players.join(' & ')} · {row.groupName} · {row.played} played</small></div><b>{row.matchPoints}</b></article>):<p>No group standings yet.</p>}</section><div className="tv1-tv-courts">{courts.map((court)=>{
      const match=playing.find((fixture)=>fixture.courtId===court.id);
      const next=state.fixtures.filter((fixture)=>fixture.courtId===court.id&&fixture.status==='planned').sort((a,b)=>a.queueOrder-b.queueOrder)[0];
      return <section key={court.id}><div className="tv1-tv-court-head"><span>{court.name}</span><small>{court.available?match?match.status:'READY':'CLOSED'}</small></div>{match?<div className="tv1-tv-match"><Team label={match.entryA} players={match.playersA}/><div className="tv1-tv-score">{match.liveScore?humanScore(match.liveScore):'SCORE BLANK'}</div><Team label={match.entryB} players={match.playersB}/></div>:<div className="tv1-tv-empty">No active match</div>}<div className="tv1-tv-next"><small>NEXT</small>{next?<div className="tv1-tv-next-pair"><Team label={next.entryA} players={next.playersA}/><span>vs</span><Team label={next.entryB} players={next.playersB}/></div>:<strong>Queue clear</strong>}</div></section>;
    })}</div></div>
  </main></div>;
}

function Team({label,players}:{label:string|null;players:[string,string]|null}) { return <div className="tv1-tv-team"><strong>{label??'To be decided'}</strong>{players&&<small>{players.join(' & ')}</small>}</div>; }
