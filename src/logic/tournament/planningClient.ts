import { TOURNAMENT_CONTRACT_VERSION } from '@/logic/tournament';
import type { TournamentPlanningRequest, TournamentPlanningResult } from './planningTasks';

export interface TournamentPlanningJob { requestId:string; promise:Promise<TournamentPlanningResult>; cancel:()=>void }
type TournamentPlanningStartRequest = TournamentPlanningRequest extends infer Request ? Request extends TournamentPlanningRequest ? Omit<Request,'requestId'|'contractVersion'> : never : never;

export function startTournamentPlanning(request:TournamentPlanningStartRequest,{onProgress}:{onProgress?:(progress:number,status:string)=>void}={}):TournamentPlanningJob {
  if(typeof Worker==='undefined')throw new Error('This browser cannot run safe background tournament planning. Use a supported modern browser; no blocking fallback was used.');
  const requestId=crypto.randomUUID();
  const worker=new Worker(new URL('./planning.worker.ts',import.meta.url),{type:'module'});
  let settled=false;
  let rejectJob:(reason?:unknown)=>void=()=>undefined;
  const promise=new Promise<TournamentPlanningResult>((resolve,reject)=>{
    rejectJob=reject;
    worker.onmessage=(event:MessageEvent<Record<string,unknown>>)=>{
      const message=event.data;
      if(message.requestId!==requestId||message.baseRevision!==request.baseRevision||message.contractVersion!==TOURNAMENT_CONTRACT_VERSION)return;
      if(message.type==='progress'){onProgress?.(Number(message.progress),String(message.status));return;}
      settled=true;worker.terminate();
      if(message.type==='result')resolve(message.result as TournamentPlanningResult);else reject(new Error(String(message.error??'Tournament planning failed.')));
    };
    worker.onerror=()=>{settled=true;worker.terminate();reject(new Error('Tournament planning worker failed. No changes were applied.'));};
    worker.postMessage({...request,requestId,contractVersion:TOURNAMENT_CONTRACT_VERSION});
  });
  return {requestId,promise,cancel:()=>{if(settled)return;settled=true;worker.terminate();rejectJob(new DOMException('Planning cancelled.','AbortError'));}};
}
