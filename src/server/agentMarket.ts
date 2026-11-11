import {pool} from './production/db';
import {agentAnalytics,leaderboard} from './production/arena';
import {NEARAI_BASE_URL,allowedModels,nearAiConfigured} from './nearai';

/** Agent Market (market.near.ai) self-hosted worker: "Arena Coach".
 * Buyers hire it with a brief such as "Review agent NIGHTOWL" or "Write a tight-aggressive strategy for
 * my agent". It reads public arena records, drafts the report with a NEAR AI Cloud TEE model, and
 * submits Markdown. The marketplace holds the buyer's payment until delivery. Enabled only when
 * AGENT_MARKET_TOKEN (an `aat_…` agent API token) is set. */
const BASE='https://market.near.ai';
export const agentMarketConfigured=()=>Boolean(process.env.AGENT_MARKET_TOKEN);
const status={lastPollAt:null as string|null,lastError:null as string|null,delivered:0};
export const agentMarketStatus=()=>({enabled:agentMarketConfigured(),...status,listing:process.env.AGENT_MARKET_LISTING_URL||null});

async function api(method:string,path:string,body?:unknown){
  const res=await fetch(`${BASE}${path}`,{method,signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${process.env.AGENT_MARKET_TOKEN}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const text=await res.text();if(!res.ok)throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0,200)}`);
  return text?JSON.parse(text):{};
}

async function arenaFacts(brief:string){
  const board=await leaderboard();
  const named=board.filter(r=>brief.toUpperCase().includes(r.name));
  const details=await Promise.all(named.slice(0,3).map(async r=>({...r,analytics:await agentAnalytics(r.id)})));
  const recent=(await pool.query<{name:string;state:string;hand_number:number}>(`SELECT name,state,hand_number FROM tournaments ORDER BY created_at DESC LIMIT 5`)).rows;
  return{leaderboardTop:board.slice(0,5),requestedAgents:details,recentTournaments:recent};
}

export async function coachReport(brief:string){
  const facts=await arenaFacts(brief);
  if(!nearAiConfigured())return`# Arena Coach\n\nNEAR AI Cloud is not configured on this arena, so this report contains records only.\n\n\`\`\`json\n${JSON.stringify(facts,null,2).slice(0,6000)}\n\`\`\``;
  const res=await fetch(`${NEARAI_BASE_URL}/v1/chat/completions`,{method:'POST',signal:AbortSignal.timeout(60000),
    headers:{'content-type':'application/json',authorization:`Bearer ${process.env.NEARAI_API_KEY}`},
    body:JSON.stringify({model:allowedModels()[0],temperature:0.3,max_tokens:1500,messages:[
      {role:'system',content:'You are Arena Coach, a Texas Hold’em analyst for AI agents competing in Agent Arena on NEAR. Write a concise Markdown report for the buyer: findings backed by the numbers given, then concrete strategy-note text they can paste into their agent. Never invent statistics that are not in the data.'},
      {role:'user',content:`Brief:\n${brief.slice(0,2000)}\n\nArena records (public):\n${JSON.stringify(facts).slice(0,12000)}`}]})});
  if(!res.ok)throw new Error(`NEAR AI Cloud HTTP ${res.status}`);
  const body=await res.json() as {choices?:{message?:{content?:string}}[]};
  return`${body.choices?.[0]?.message?.content||'No report was produced.'}\n\n---\n_Generated inside a NEAR AI Cloud TEE from public Agent Arena records._`;
}

export async function pollAgentMarket(){
  if(!agentMarketConfigured())return;
  try{
    const {assignments=[]}=await api('GET','/v1/agents/me/assignments') as {assignments?:{assignment:{assignmentId:string;startedAt?:string;slaDeadlineAt?:string};job:{description:string}}[]};
    for(const row of assignments){
      const a=row.assignment;if(a.startedAt)continue;
      await api('POST',`/v1/assignments/${a.assignmentId}/start`);
      await api('POST',`/v1/assignments/${a.assignmentId}/messages`,{body:'Arena Coach picked up your brief and is reading the arena records now.'});
      await api('POST',`/v1/assignments/${a.assignmentId}/submit`,{deliverableMarkdown:await coachReport(row.job.description)});
      status.delivered++;
    }
    status.lastPollAt=new Date().toISOString();status.lastError=null;
  }catch(error){status.lastError=(error as Error).message;}
}
