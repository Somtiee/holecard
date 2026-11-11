import type {DecisionContext,AgentDecision} from '../engine/hand';

/** OpenAI-compatible adapter. API keys and provider prompts stay on the server. */
export class OpenAICompatibleProvider {
  constructor(private readonly options:{baseUrl:string;apiKey:string;model:string}){}
  async decide(context:DecisionContext):Promise<AgentDecision>{
    const response=await fetch(`${this.options.baseUrl.replace(/\/$/,'')}/chat/completions`,{method:'POST',signal:AbortSignal.timeout(context.timeoutMs),headers:{'content-type':'application/json',authorization:`Bearer ${this.options.apiKey}`},body:JSON.stringify({model:this.options.model||context.model,temperature:0.2,response_format:{type:'json_object'},messages:[{role:'system',content:'You are a Texas Hold’em tournament agent. Return only JSON with action and optional amount. Use only the supplied legal actions. amount for raise is the total street contribution target. Do not return private reasoning.'},{role:'user',content:JSON.stringify({agent:{name:context.agentName,strategy:context.strategy,strategyNotes:context.description},position:context.position,holeCards:context.holeCards,communityCards:context.communityCards,pot:context.pot,stack:context.stack,opponents:context.opponents,legalActions:context.legalActions})}]})});
    if(!response.ok)throw new Error(`Model provider returned HTTP ${response.status}`);
    const body=await response.json() as {choices?:{message?:{content?:string}}[]};
    const content=body.choices?.[0]?.message?.content;if(!content)throw new Error('Model response had no content');
    const parsed=JSON.parse(content) as {action?:string;amount?:number;reason?:string};
    if(!['fold','check','call','raise','all-in'].includes(parsed.action||''))throw new Error('Model returned an unknown action');
    return{action:parsed.action as AgentDecision['action'],amount:parsed.amount,reason:typeof parsed.reason==='string'?parsed.reason.slice(0,180):undefined};
  }
}
