import '../env';
import express from 'express';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {pool,migrate} from './db';
import {clearSessionCookie,makeChallenge,requireOwner,revokeSession,sessionCookie,sessionOwner,signInRecipient,verifyChallenge} from './auth';
import {agentAnalytics,agentWallet,createAgent,createTournament,decisionMode,getAgent,getTournament,launchTournament,leaderboard,listAgents,listTournaments,
  operationHistory,provisionAgent,replayHand,reserveSeat,submitEntry,teeReceipts,tickArena,verifyMatch} from './arena';
import {publicAgent} from './types';
import {NEAR_EXPLORER,NEAR_NETWORK,NEAR_RPC_URL,contractId,nearConfigured,view} from '../near';
import {allowedModels,attestModel,nearAiConfigured} from '../nearai';
import {FUNDING_SOURCES,fundingQuote} from '../intents';
import {agentMarketStatus,coachReport,pollAgentMarket} from '../agentMarket';

const app=express();app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
const server=createServer(app),wss=new WebSocketServer({noServer:true});
const PORT=Number(process.env.PORT||8787),HOST=process.env.HOST||'127.0.0.1';
const origin=process.env.PUBLIC_ORIGIN||`http://${HOST}:${PORT}`;
const param=(value:string|string[])=>Array.isArray(value)?value[0]:value;
function broadcast(event:string,data:unknown){const payload=JSON.stringify({event,data});for(const ws of wss.clients)if(ws.readyState===WebSocket.OPEN)ws.send(payload);}
const secure=origin.startsWith('https://');
const requestCounts=new Map<string,{count:number;until:number}>();
const limited=new Set(['/api/auth/challenge','/api/intents/quote','/api/agent-market/preview']);
app.use((req,res,next)=>{
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin!==origin){res.status(403).json({error:'Request origin does not match this arena.'});return;}
  if(limited.has(req.path)){
    const key=`${req.path}:${req.ip||req.socket.remoteAddress||'unknown'}`,now=Date.now(),prior=requestCounts.get(key);
    const item=prior&&prior.until>now?prior:{count:0,until:now+60000};item.count++;requestCounts.set(key,item);
    if(item.count>10){res.status(429).json({error:'Too many requests. Try again shortly.'});return;}
  }
  next();
});
const handle=(fn:(req:express.Request,res:express.Response)=>Promise<void>):express.RequestHandler=>(req,res,next)=>{void fn(req,res).catch(next);};
const safeContract=()=>{try{return contractId();}catch{return null;}};

app.get('/api/ready',handle(async(_req,res)=>{await pool.query('SELECT 1');res.json({ok:true});}));
app.get('/api/health',handle(async(_req,res)=>{
  const config=nearConfigured()?await view<Record<string,unknown>>('get_config').catch(error=>({error:(error as Error).message})):null;
  res.json({ok:true,network:NEAR_NETWORK,contractId:safeContract(),contract:config,nearConfigured:nearConfigured(),nearAiConfigured:nearAiConfigured(),decisionPolicy:decisionMode(),
    tournamentLaunchReady:nearConfigured()&&(decisionMode()==='fixture'||nearAiConfigured()),agentMarket:agentMarketStatus(),
    operatorTrust:'Poker results are operator asserted; the NEAR contract escrows entry fees, checks the seed reveal and pays the frozen shares.'});
}));
app.get('/api/config',(_req,res)=>res.json({network:NEAR_NETWORK,rpcUrl:NEAR_RPC_URL,explorer:NEAR_EXPLORER,contractId:safeContract(),signInRecipient:signInRecipient(),
  models:decisionMode()==='fixture'?['fixture-policy']:allowedModels(),decisionPolicy:decisionMode(),nearAiReady:nearAiConfigured(),nearReady:nearConfigured(),
  fundingSources:FUNDING_SOURCES.map(({id,label})=>({id,label})),intentsReady:Boolean(process.env.INTENTS_QUOTE_RECIPIENT),agentMarket:agentMarketStatus()}));

app.post('/api/auth/challenge',handle(async(_req,res)=>{res.json(await makeChallenge());}));
app.post('/api/auth/verify',handle(async(req,res)=>{const session=await verifyChallenge(req.body||{});res.setHeader('Set-Cookie',sessionCookie(session.token,secure));res.json({accountId:session.accountId});}));
app.post('/api/auth/logout',handle(async(req,res)=>{await revokeSession(req);res.setHeader('Set-Cookie',clearSessionCookie(secure));res.json({ok:true});}));
app.get('/api/me',handle(async(req,res)=>{const s=await sessionOwner(req);res.json({accountId:s?.accountId||null});}));

app.get('/api/agents',handle(async(_req,res)=>{res.json(await listAgents());}));
app.get('/api/agents/:id',handle(async(req,res)=>{const a=await getAgent(param(req.params.id));if(!a){res.status(404).json({error:'Agent not found'});return;}const row=(await leaderboard()).find(x=>x.id===a.id);res.json(publicAgent(a,row));}));
app.get('/api/agents/:id/analytics',handle(async(req,res)=>{const data=await agentAnalytics(param(req.params.id));if(!data){res.status(404).json({error:'Agent not found'});return;}res.json(data);}));
app.get('/api/agents/:id/wallet',handle(async(req,res)=>{const data=await agentWallet(param(req.params.id));if(!data){res.status(404).json({error:'Agent not found'});return;}res.json(data);}));
app.post('/api/agents',requireOwner,handle(async(req,res)=>{const agent=await createAgent(res.locals.owner,res.locals.ownerPublicKey,req.body||{});broadcast('agent.created',agent);res.status(201).json(agent);}));
app.post('/api/agents/:id/provision',requireOwner,handle(async(req,res)=>{res.json(await provisionAgent(param(req.params.id),res.locals.owner,res.locals.ownerPublicKey));}));

app.post('/api/intents/quote',handle(async(req,res)=>{res.json(await fundingQuote({source:req.body?.source,amountYocto:String(req.body?.amountYocto||'')}));}));
app.get('/api/nearai/attestation',handle(async(req,res)=>{res.json(await attestModel(String(req.query.model||allowedModels()[0]||'')));}));
app.get('/api/agent-market',(_req,res)=>res.json(agentMarketStatus()));
app.post('/api/agent-market/preview',requireOwner,handle(async(req,res)=>{const brief=String(req.body?.brief||'').trim();if(brief.length<5||brief.length>2000)throw new Error('Brief must be 5–2000 characters');res.json({markdown:await coachReport(brief)});}));

app.get('/api/tournaments',handle(async(_req,res)=>{res.json(await listTournaments());}));
app.get('/api/tournaments/:id',handle(async(req,res)=>{const data=await getTournament(param(req.params.id));if(!data){res.status(404).json({error:'Tournament not found'});return;}res.json(data.public);}));
app.get('/api/tournaments/:id/operations',handle(async(req,res)=>{res.json(await operationHistory(param(req.params.id)));}));
app.get('/api/tournaments/:id/tee-receipts',handle(async(req,res)=>{res.json(await teeReceipts(param(req.params.id)));}));
app.get('/api/tournaments/:id/verification',handle(async(req,res)=>{const report=await verifyMatch(param(req.params.id));if(!report){res.status(404).json({error:'Tournament not found'});return;}res.json(report);}));
app.get('/api/tournaments/:id/replay/:hand',handle(async(req,res)=>{const hand=await replayHand(param(req.params.id),Number(param(req.params.hand)));if(!hand){res.status(404).json({error:'Hand not found'});return;}res.json(hand);}));
app.post('/api/tournaments',requireOwner,handle(async(req,res)=>{const t=await createTournament(res.locals.owner,req.body||{});broadcast('tournament.created',t);res.status(201).json(t);}));
app.post('/api/tournaments/:id/reserve',requireOwner,handle(async(req,res)=>{const t=await reserveSeat(res.locals.owner,param(req.params.id),req.body?.agentId);broadcast('tournament.updated',t);res.status(201).json(t);}));
app.post('/api/tournaments/:id/launch',requireOwner,handle(async(req,res)=>{res.status(202).json(await launchTournament(res.locals.owner,param(req.params.id)));}));
app.post('/api/tournaments/:id/entries/:agentId/enter',requireOwner,handle(async(req,res)=>{res.status(202).json(await submitEntry(res.locals.owner,param(req.params.id),param(req.params.agentId)));}));
app.get('/api/leaderboard',handle(async(_req,res)=>{res.json(await leaderboard());}));

server.on('upgrade',(request,socket,head)=>{if(new URL(request.url||'/',`http://${request.headers.host}`).pathname!=='/ws'){socket.destroy();return;}wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request));});
wss.on('connection',ws=>{ws.send(JSON.stringify({event:'connected',data:{network:`NEAR ${NEAR_NETWORK}`}}));});
app.use('/api',(_req,res)=>{res.status(404).json({error:'API route not found'});});
if(existsSync(resolve('dist/index.html'))){app.use(express.static(resolve('dist')));app.get(/.*/,(_req,res)=>res.sendFile(resolve('dist/index.html')));}
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const err=error as {code?:string;message?:string};
  const conflict=err.code==='23505';const badInput=err.code==='22P02'||/invalid|required|closed|full|missing|enough|configured|roster|agent|tournament|owner|strategy|model|share|deposit|signature|challenge|amount|quote|brief|registration|near/i.test(err.message||'');
  const status=conflict?409:badInput?400:500;
  if(status===500)console.error('Arena request failed',err.message);
  res.status(status).json({error:status===500?'The arena could not complete this request.':conflict?'This agent or seat already exists.':err.message});
});

export {app,server};
if(process.env.NODE_ENV!=='test'){
  await migrate();
  server.listen(PORT,HOST,()=>console.log(`Agent Arena (NEAR ${NEAR_NETWORK}) listening on ${HOST}:${PORT}`));
  let busy=false;
  setInterval(()=>{if(busy)return;busy=true;void tickArena((action,tournamentId)=>broadcast('hand.action',{tournamentId,action}),(turn,tournamentId)=>broadcast('turn.thinking',{tournamentId,turn}))
    .catch(error=>console.error('Arena tick failed',(error as Error).message)).finally(()=>{busy=false;});},2500);
  setInterval(()=>{void pollAgentMarket();},60_000);void pollAgentMarket();
  setInterval(()=>{void pool.query('DELETE FROM sign_in_challenges WHERE expires_at<now(); DELETE FROM sessions WHERE expires_at<now()').catch(()=>{});for(const [k,item] of requestCounts)if(item.until<Date.now())requestCounts.delete(k);},300000);
}
