import { useState } from 'react';
import { entryLabel } from '@/logic/tournament';
import { tournamentIds, useTournamentStore } from '@/store/tournamentStore';

type ImportRow={divisionId:string;teamName:string;playerNames:[string,string];contact:string;allowDuplicate?:boolean};

export function TournamentEntries() {
  const record = useTournamentStore((store) => store.active)!;
  const apply = useTournamentStore((store) => store.applyCommand);
  const saveContact = useTournamentStore((store) => store.setContact);
  const importEntries = useTournamentStore((store) => store.importEntries);
  const saveFormDraft = useTournamentStore((store) => store.saveFormDraft);
  const state = record.projected;
  const savedImport = record.drafts.formByKey['entries-import'] as { paste?: string; preview?: ImportRow[]; duplicateReason?:string } | undefined;
  const savedAdd=record.drafts.formByKey['entry-add'] as Partial<{divisionId:string;teamName:string;playerOne:string;playerTwo:string;contact:string;lateReason:string;existingPlayerOne:string;existingPlayerTwo:string;allowDuplicate:boolean;duplicateReason:string}>|undefined;
  const [divisionId, setDivisionId] = useState(savedAdd?.divisionId??state.divisions[0].id);
  const [teamName, setTeamName] = useState(savedAdd?.teamName??'');
  const [playerOne, setPlayerOne] = useState(savedAdd?.playerOne??'');
  const [playerTwo, setPlayerTwo] = useState(savedAdd?.playerTwo??'');
  const [contact, setContact] = useState(savedAdd?.contact??'');
  const [paste, setPaste] = useState(savedImport?.paste ?? '');
  const [lateReason, setLateReason] = useState(savedAdd?.lateReason??'');
  const [existingPlayerOne, setExistingPlayerOne] = useState(savedAdd?.existingPlayerOne??'');
  const [existingPlayerTwo, setExistingPlayerTwo] = useState(savedAdd?.existingPlayerTwo??'');
  const [allowDuplicate, setAllowDuplicate] = useState(savedAdd?.allowDuplicate??false);
  const [duplicateReason, setDuplicateReason] = useState(savedAdd?.duplicateReason??'');
  const [importPreview, setImportPreview] = useState<ImportRow[] | null>(savedImport?.preview ?? null);
  const [importDuplicateReason,setImportDuplicateReason]=useState(savedImport?.duplicateReason??'');
  const [message, setMessage] = useState('');
  const activeEntries = state.entries.filter((entry) => entry.admission !== 'cancelled');
  const persistAdd=(patch:Partial<NonNullable<typeof savedAdd>>)=>void saveFormDraft('entry-add',{divisionId,teamName,playerOne,playerTwo,contact,lateReason,existingPlayerOne,existingPlayerTwo,allowDuplicate,duplicateReason,...patch});

  async function addOne() {
    try {
      const ids = { entryId: tournamentIds.entry(), playerIds: [tournamentIds.player(), tournamentIds.player()] as [string,string], lineupRevisionId: tournamentIds.lineup() };
      const kind = state.lifecycle === 'live' ? 'add-late-entry' : 'add-entry';
      await apply(kind, { divisionId, teamName, playerNames: [playerOne, playerTwo], ids, allowDuplicate, existingPlayerIds: [existingPlayerOne || null, existingPlayerTwo || null] }, state.lifecycle === 'live' ? lateReason : allowDuplicate ? duplicateReason : undefined);
      if (contact.trim()) await saveContact(ids.entryId, contact);
      setTeamName(''); setPlayerOne(''); setPlayerTwo(''); setContact(''); setLateReason(''); setExistingPlayerOne(''); setExistingPlayerTwo(''); setAllowDuplicate(false); setDuplicateReason(''); await saveFormDraft('entry-add', null); setMessage(state.lifecycle === 'live' ? 'Late entry added with an audited reason. Place it in future fixtures explicitly.' : 'Entry added to the canonical roster.');
    } catch (error) { const text = error instanceof Error ? error.message : 'Could not add entry.'; if (/already be entered/i.test(text)){setAllowDuplicate(true);persistAdd({allowDuplicate:true});} setMessage(text); }
  }

  async function validateImportRows() {
    const rows = paste.trim().split(/\r?\n/).map((line) => line.split('\t'));
    const divisionFor = (name?: string) => name?.trim()
      ? state.divisions.find((division) => division.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
      : state.divisions[0];
    const invalid = rows.find((columns) => columns.length < 3 || !columns[1]?.trim() || !columns[2]?.trim() || !divisionFor(columns[4]));
    if (invalid) { setImportPreview(null); setMessage('Every row needs team, player one, player two, optional contact, and an optional valid division name. Nothing was imported.'); return; }
    const known=new Set(activeEntries.map((entry)=>entry.playerIds.map((id)=>state.players.find((player)=>player.id===id)?.name.trim().toLocaleLowerCase()).sort().join('|')));const seen=new Set<string>();
    const preview = rows.map((columns) => {const playerNames=[columns[1].trim(),columns[2].trim()] as [string,string];const key=playerNames.map((name)=>name.toLocaleLowerCase()).sort().join('|');const allowDuplicate=known.has(key)||seen.has(key);seen.add(key);return { divisionId: divisionFor(columns[4])!.id, teamName: columns[0].trim(), playerNames, contact: columns[3]?.trim() ?? '',allowDuplicate };});
    setImportPreview(preview); await saveFormDraft('entries-import', { paste, preview,duplicateReason:importDuplicateReason }); setMessage(`Review ${preview.length} rows, then Apply or Cancel.${preview.some((row)=>row.allowDuplicate)?' Duplicate pairs need one audited override reason.':''}`);
  }
  async function applyImportRows() {
    if (!importPreview) return;
    try { if(importPreview.some((row)=>row.allowDuplicate)&&!importDuplicateReason.trim())throw new Error('Enter an audited reason for the duplicate pair rows.');await importEntries(importPreview,importDuplicateReason.trim()||undefined); setPaste(''); setImportPreview(null); setImportDuplicateReason(''); await saveFormDraft('entries-import', null); setMessage(`${importPreview.length} rows imported atomically.`); }
    catch (error) { setMessage(`Nothing was imported: ${error instanceof Error ? error.message : 'invalid row'}.`); }
  }

  return <main className="tv1-main">
    <div className="tv1-page-head"><div><p className="eyebrow">ONE CANONICAL ROSTER</p><h1>Entries</h1><p>Each division has its own capacity. Overflow waits without changing a published draw.</p></div></div>
    {message && <div className="tv1-alert" role="status">{message}</div>}
    <section className="tv1-panel"><h2>Add a pair</h2><div className="tv1-entry-form">
      <select aria-label="Division" value={divisionId} onChange={(event) => {setDivisionId(event.target.value);persistAdd({divisionId:event.target.value});}}>{state.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select>
      <input aria-label="Team name" maxLength={80} placeholder="Team name (optional)" value={teamName} onChange={(event) => {setTeamName(event.target.value);persistAdd({teamName:event.target.value});}}/>
      <input aria-label="Player one" maxLength={80} placeholder="Player one" value={playerOne} onChange={(event) => {setPlayerOne(event.target.value);persistAdd({playerOne:event.target.value});}}/>
      <input aria-label="Player two" maxLength={80} placeholder="Player two" value={playerTwo} onChange={(event) => {setPlayerTwo(event.target.value);persistAdd({playerTwo:event.target.value});}}/>
      <input aria-label="Private contact" maxLength={100} placeholder="WhatsApp or phone (private)" value={contact} onChange={(event) => {setContact(event.target.value);persistAdd({contact:event.target.value});}}/>
      {state.players.length > 0 && <><label>Reuse existing player one<select value={existingPlayerOne} onChange={(event) => { const id=event.target.value;const name=id?state.players.find((player)=>player.id===id)?.name??'':playerOne; setExistingPlayerOne(id); if(id)setPlayerOne(name);persistAdd({existingPlayerOne:id,playerOne:name}); }}><option value="">Create new player</option>{state.players.map((player)=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label>Reuse existing player two<select value={existingPlayerTwo} onChange={(event) => { const id=event.target.value;const name=id?state.players.find((player)=>player.id===id)?.name??'':playerTwo; setExistingPlayerTwo(id); if(id)setPlayerTwo(name);persistAdd({existingPlayerTwo:id,playerTwo:name}); }}><option value="">Create new player</option>{state.players.map((player)=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label></>}
      {allowDuplicate && <label>Duplicate override reason<input aria-label="Duplicate override reason" maxLength={500} value={duplicateReason} onChange={(event)=>{setDuplicateReason(event.target.value);persistAdd({duplicateReason:event.target.value});}} placeholder="Explain why this is a separate entry"/></label>}
      {state.lifecycle === 'live' && <input aria-label="Late-entry reason" maxLength={500} placeholder="Why is this pair being added late?" value={lateReason} onChange={(event) => {setLateReason(event.target.value);persistAdd({lateReason:event.target.value});}}/>}<button className="btn primary" disabled={!playerOne.trim() || !playerTwo.trim() || state.lifecycle === 'live' && !lateReason.trim() || allowDuplicate && !duplicateReason.trim()} onClick={() => void addOne()}>{allowDuplicate ? 'Add separate duplicate' : state.lifecycle === 'live' ? 'Add late pair' : 'Add pair'}</button>
    </div><details className="tv1-import"><summary>Paste from Excel</summary><p>Columns: team, player one, player two, contact, division. All rows apply together or none do.</p><textarea value={paste} onChange={(event) => { setPaste(event.target.value); setImportPreview(null); void saveFormDraft('entries-import',{paste:event.target.value,duplicateReason:importDuplicateReason}); }} placeholder={'Team Alpha\tAlex\tSam\t+62…\tOpen'}/>{importPreview ? <div className="tv1-alert"><strong>{importPreview.length} rows ready.</strong>{importPreview.some((row)=>row.allowDuplicate)&&<label>Audited duplicate override reason<input value={importDuplicateReason} maxLength={500} onChange={(event)=>{setImportDuplicateReason(event.target.value);void saveFormDraft('entries-import',{paste,preview:importPreview,duplicateReason:event.target.value});}}/></label>}<div className="tv1-template-actions"><button className="btn primary" disabled={importPreview.some((row)=>row.allowDuplicate)&&!importDuplicateReason.trim()} onClick={() => void applyImportRows()}>Apply all rows</button><button className="btn" onClick={() => { setImportPreview(null); void saveFormDraft('entries-import',{paste,duplicateReason:importDuplicateReason}); setMessage('Import cancelled; no roster changes were made.'); }}>Cancel</button></div></div> : <button className="btn" disabled={!paste.trim()} onClick={() => void validateImportRows()}>Validate rows</button>}</details></section>
    {state.divisions.map((division) => <div className="tv1-roster-columns" key={division.id}>
      <section className="tv1-panel"><div className="tv1-panel-head"><div><h2>{division.name} · Confirmed</h2><p>{activeEntries.filter((entry) => entry.divisionId === division.id && entry.admission === 'confirmed').length}/{division.capacity}</p></div></div><div className="tv1-roster-list">{activeEntries.filter((entry) => entry.divisionId === division.id && entry.admission === 'confirmed').map((entry,index) => <EntryRow key={entry.id} index={index + 1} entryId={entry.id}/>)}</div></section>
      <section className="tv1-panel"><div className="tv1-panel-head"><h2>{division.name} · Waiting</h2><span>{activeEntries.filter((entry) => entry.divisionId === division.id && entry.admission === 'waiting').length}</span></div><div className="tv1-roster-list">{activeEntries.filter((entry) => entry.divisionId === division.id && entry.admission === 'waiting').sort((a,b) => (a.waitRank ?? 0) - (b.waitRank ?? 0)).map((entry) => <EntryRow key={entry.id} index={entry.waitRank ?? 0} entryId={entry.id}/>)}</div></section>
    </div>)}
  </main>;
}

function EntryRow({ entryId, index }: { entryId: string; index: number }) {
  const record = useTournamentStore((store) => store.active)!;
  const apply = useTournamentStore((store) => store.applyCommand);
  const saveContact = useTournamentStore((store) => store.setContact);
  const state = record.projected;
  const entry = state.entries.find((item) => item.id === entryId)!;
  const players = entry.playerIds.map((id) => state.players.find((player) => player.id === id)?.name ?? '?');
  const [editing, setEditing] = useState(false);
  const [teamName, setTeamName] = useState(entry.teamName);
  const [playerOne, setPlayerOne] = useState(players[0]);
  const [playerTwo, setPlayerTwo] = useState(players[1]);
  const futureFixtureIds = state.fixtures.filter((fixture) => fixture.status === 'planned' && (fixture.resolvedEntryAId === entryId || fixture.resolvedEntryBId === entryId)).map((fixture) => fixture.id);
  const [substituting, setSubstituting] = useState(false);
  const [outgoingPlayerId, setOutgoingPlayerId] = useState(entry.playerIds[0]);
  const [incomingName, setIncomingName] = useState('');
  const [substitutionReason, setSubstitutionReason] = useState('');
  const [selectedFixtures, setSelectedFixtures] = useState<string[]>(futureFixtureIds);
  const waiting = state.entries.filter((item) => item.divisionId === entry.divisionId && item.admission === 'waiting').sort((a,b)=>(a.waitRank ?? 0)-(b.waitRank ?? 0));
  async function moveWaiting(direction: -1 | 1) {
    const current = waiting.findIndex((item)=>item.id===entryId); const target=current+direction;
    if(current<0 || target<0 || target>=waiting.length) return;
    const ids=waiting.map((item)=>item.id); [ids[current],ids[target]]=[ids[target],ids[current]];
    await apply('reorder-waiting',{divisionId:entry.divisionId,entryIds:ids});
  }
  async function substitute() {
    await apply('substitute-player', { entryId, outgoingPlayerId, incomingPlayer: { id: tournamentIds.player(), name: incomingName }, fixtureIds: selectedFixtures, lineupRevisionId: tournamentIds.lineup(), reason: substitutionReason }, substitutionReason);
    setSubstituting(false); setIncomingName(''); setSubstitutionReason('');
  }
  return <article className="tv1-entry-row"><span className="tv1-rank">{index}</span><div className="tv1-entry-copy">{editing ? <div className="tv1-inline-edit"><input aria-label="Edit team name" maxLength={80} value={teamName} onChange={(event) => setTeamName(event.target.value)}/><input aria-label="Edit player one" maxLength={80} value={playerOne} onChange={(event) => setPlayerOne(event.target.value)}/><input aria-label="Edit player two" maxLength={80} value={playerTwo} onChange={(event) => setPlayerTwo(event.target.value)}/></div> : substituting ? <div className="tv1-substitution"><strong>Substitute for selected future matches</strong><select aria-label="Outgoing player" value={outgoingPlayerId} onChange={(event) => setOutgoingPlayerId(event.target.value)}>{entry.playerIds.map((playerId) => <option key={playerId} value={playerId}>{state.players.find((player) => player.id === playerId)?.name}</option>)}</select><input aria-label="Incoming player" placeholder="Incoming player name" value={incomingName} onChange={(event) => setIncomingName(event.target.value)}/><input aria-label="Substitution reason" placeholder="Required reason" value={substitutionReason} maxLength={500} onChange={(event) => setSubstitutionReason(event.target.value)}/><div>{futureFixtureIds.map((fixtureId) => <label className="tv1-private-check" key={fixtureId}><input type="checkbox" checked={selectedFixtures.includes(fixtureId)} onChange={(event) => setSelectedFixtures((current) => event.target.checked ? [...current,fixtureId] : current.filter((id) => id !== fixtureId))}/>{state.fixtures.find((fixture) => fixture.id === fixtureId)?.label}</label>)}</div><div className="tv1-template-actions"><button className="btn primary" disabled={!incomingName.trim() || !substitutionReason.trim() || !selectedFixtures.length} onClick={() => void substitute()}>Apply substitution</button><button className="btn" onClick={() => setSubstituting(false)}>Cancel</button></div></div> : <><strong>{entryLabel(state,entry.id)}</strong><span>{players.join(' & ')} · {entry.readiness.replaceAll('-', ' ')}</span></>}</div><div className="tv1-entry-actions">{editing || substituting ? editing ? <><button className="btn primary" onClick={() => void apply('edit-entry',{entryId,teamName,playerNames:[playerOne,playerTwo]}).then(() => setEditing(false))}>Save</button><button className="btn" onClick={() => setEditing(false)}>Cancel</button></> : null : <><button className="btn" onClick={() => setEditing(true)}>Edit label</button>{futureFixtureIds.length > 0 && <button className="btn" onClick={() => { setSelectedFixtures(futureFixtureIds); setSubstituting(true); }}>Substitute</button>}<select aria-label="Readiness" value={entry.readiness} onChange={(event) => void apply('set-readiness',{entryId,readiness:event.target.value})}><option value="not-checked-in">Not checked in</option><option value="ready">Ready</option><option value="late">Late</option><option value="withdrawn">Withdrawn</option></select>{entry.admission === 'waiting' && <><button className="btn" disabled={waiting[0]?.id===entryId} onClick={() => void moveWaiting(-1)}>Move up</button><button className="btn" disabled={waiting.at(-1)?.id===entryId} onClick={() => void moveWaiting(1)}>Move down</button><button className="btn" onClick={() => void apply('promote-entry',{entryId}).catch(() => undefined)}>Promote</button></>}{record.contacts[entryId] && <button className="btn" onClick={() => void saveContact(entryId,'')}>Delete private contact</button>}<button className="btn danger" onClick={() => void apply('cancel-entry',{entryId})}>Cancel entry</button></>}</div></article>;
}
