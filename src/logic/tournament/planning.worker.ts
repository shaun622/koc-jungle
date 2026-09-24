/// <reference lib="webworker" />
import { executeTournamentPlanning, type TournamentPlanningRequest } from './planningTasks';

self.onmessage=(event:MessageEvent<TournamentPlanningRequest>)=>{
  const request=event.data;
  self.postMessage({type:'progress',requestId:request.requestId,baseRevision:request.baseRevision,contractVersion:request.contractVersion,progress:0.1,status:'Planning…'});
  try {
    const result=executeTournamentPlanning(request);
    self.postMessage({type:'result',requestId:request.requestId,baseRevision:request.baseRevision,contractVersion:request.contractVersion,progress:1,status:'Ready for review',result});
  } catch(error) {
    self.postMessage({type:'error',requestId:request.requestId,baseRevision:request.baseRevision,contractVersion:request.contractVersion,error:error instanceof Error?error.message:'Planning failed.'});
  }
};
export {};
