import '../env';
import express from 'express';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {arcStatus} from '../arc';
import {agentTransfers,arcActivity,arcWalletBalance,indexArcTransfers,verifyAgentFunding} from './arcEvents';
import {agentIdentityMetadata,identityStatus,registerAgentIdentity,syncAgentIdentities} from './identity';
import {ARC_EXPLORER,FUNDING_CHAINS} from '../../shared/arc';
import type {Address} from 'viem';
import {circleConfigured} from '../wallet';
import {pool,migrate} from './db';
import {clearSessionCookie,makeChallenge,requireOwner,revokeSession,sessionCookie,sessionOwner,verifyChallenge} from './auth';
import {agentAnalytics,createAgent,createTournament,getAgent,getTournament,launchTournament,leaderboard,listAgents,listTournaments,makeWithdrawalChallenge,operationHistory,provisionAgentWallet,replayHand,reserveSeat,submitEntry,tickArena,verifyMatch,walletBalance,walletOperations,withdrawAgentFunds} from './arena';

const app=express();app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
const server=createServer(app),wss=new WebSocketServer({noServer:true});
const PORT=Number(process.env.PORT||8787),HOST=process.env.HOST||'127.0.0.1';
const origin=process.env.PUBLIC_ORIGIN||`http://${HOST}:${PORT}`;
const param=(value:string|string[])=>Array.isArray(value)?value[0]:value;
function broadcast(event:string,data:unknown){const payload=JSON.stringify({event,data});for(const ws of wss.clients)if(ws.readyState===WebSocket.OPEN)ws.send(payload);}
const secure=origin.startsWith('https://');
const requestCounts=new Map<string,{count:number;until:number}>();
app.use((req,res,next)=>{
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
    const requestOrigin=req.headers.origin;
    if(requestOrigin!==origin){res.status(403).json({error:'Request origin does not match this arena.'});return;}
  }
  if(req.path==='/api/auth/challenge'){
    const ip=req.ip||req.socket.remoteAddress||'unknown',now=Date.now(),prior=requestCounts.get(ip);
    const item=prior&&prior.until>now?prior:{count:0,until:now+60000};item.count++;requestCounts.set(ip,item);
    if(item.count>10){res.status(429).json({error:'Too many sign-in challenges. Try again shortly.'});return;}
  }
  next();
});
const handle=(fn:(req:express.Request,res:express.Response)=>Promise<void>):express.RequestHandler=>(req,res,next)=>{void fn(req,res).catch(next);};

app.get('/api/ready',handle(async(_req,res)=>{await pool.query('SELECT 1');res.json({ok:true});}));
app.get('/api/health',handle(async(_req,res)=>{const network=await arcStatus();res.json({ok:true,mode:'arc-testnet',network,walletProvider:circleConfigured()?'circle':'unconfigured',
  tournamentLaunchReady:Boolean(network.settlementEnabled&&circleConfigured()&&process.env.ARENA_OPERATOR_WALLET_ID&&process.env.MODEL_API_KEY&&process.env.MODEL_ALLOWED_MODELS),
  operatorTrust:'Poker results are operator asserted; Arc escrows entry fees and pays the frozen shares.'});}));
app.get('/api/config',(_req,res)=>res.json({network:'Arc Testnet',chainId:5042002,usdcAddress:process.env.ARC_USDC_ADDRESS||'0x3600000000000000000000000000000000000000',
  explorer:ARC_EXPLORER,fundingChains:FUNDING_CHAINS,models:(process.env.MODEL_ALLOWED_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean),circleReady:circleConfigured(),factoryAddress:process.env.ARENA_FACTORY_ADDRESS||null}));
app.get('/api/arc/activity',handle(async(_req,res)=>{res.json(await arcActivity());}));
app.post('/api/auth/challenge',handle(async(req,res)=>{res.json(await makeChallenge(req.body?.address));}));
app.post('/api/auth/verify',handle(async(req,res)=>{const session=await verifyChallenge(req.body?.address,req.body?.message,req.body?.signature);res.setHeader('Set-Cookie',sessionCookie(session.token,secure));res.json({address:session.address});}));
app.post('/api/auth/logout',handle(async(req,res)=>{await revokeSession(req);res.setHeader('Set-Cookie',clearSessionCookie(secure));res.json({ok:true});}));
app.get('/api/me',handle(async(req,res)=>{res.json({address:await sessionOwner(req)});}));

app.get('/api/agents',handle(async(_req,res)=>{res.json(await listAgents());}));
app.get('/api/agents/:id',handle(async(req,res)=>{const a=await getAgent(param(req.params.id));if(!a){res.status(404).json({error:'Agent not found'});return;}const leaderboardRows=await leaderboard();res.json({...a,wallet_id:undefined,wallet_key:undefined,...leaderboardRows.find(x=>x.id===a.id)});}));
app.get('/api/agents/:id/analytics',handle(async(req,res)=>{const data=await agentAnalytics(param(req.params.id));if(!data){res.status(404).json({error:'Agent not found'});return;}res.json(data);}));
app.post('/api/agents',requireOwner,handle(async(req,res)=>{const agent=await createAgent(res.locals.owner,req.body||{});broadcast('agent.created',agent);res.status(201).json(agent);}));
app.post('/api/agents/:id/wallet',requireOwner,handle(async(req,res)=>{res.json(await provisionAgentWallet(param(req.params.id),res.locals.owner));}));
app.get('/api/agents/:id/wallet/balance',handle(async(req,res)=>{const a=await getAgent(param(req.params.id));if(!a?.wallet_address){res.status(404).json({error:'Agent wallet not found'});return;}res.json(await arcWalletBalance(a.wallet_address as Address));}));
app.get('/api/agents/:id/wallet/transfers',handle(async(req,res)=>{res.json(await agentTransfers(param(req.params.id)));}));
app.post('/api/agents/:id/wallet/funding/verify',requireOwner,handle(async(req,res)=>{res.json(await verifyAgentFunding(param(req.params.id),res.locals.owner,req.body?.txHash));}));
app.get('/api/agents/:id/identity.json',handle(async(req,res)=>{const metadata=await agentIdentityMetadata(param(req.params.id));if(!metadata){res.status(404).json({error:'Agent not found'});return;}res.json(metadata);}));
app.get('/api/agents/:id/identity',handle(async(req,res)=>{const status=await identityStatus(param(req.params.id));if(!status){res.status(404).json({error:'Agent not found'});return;}res.json(status);}));
app.post('/api/agents/:id/identity',requireOwner,handle(async(req,res)=>{res.status(202).json(await registerAgentIdentity(param(req.params.id),res.locals.owner));}));
app.get('/api/agents/:id/wallet/operations',requireOwner,handle(async(req,res)=>{const a=await getAgent(param(req.params.id));if(!a||a.owner!==res.locals.owner){res.status(404).json({error:'Agent not found'});return;}res.json(await walletOperations(a.id));}));
app.post('/api/agents/:id/wallet/withdraw/challenge',requireOwner,handle(async(req,res)=>{res.json(await makeWithdrawalChallenge(res.locals.owner,param(req.params.id),req.body?.amountUsdc,req.body?.requestId));}));
app.post('/api/agents/:id/wallet/withdraw',requireOwner,handle(async(req,res)=>{res.status(202).json(await withdrawAgentFunds(res.locals.owner,param(req.params.id),req.body?.amountUsdc,req.body?.requestId,req.body?.expiresAt,req.body?.message,req.body?.signature));}));

app.get('/api/tournaments',handle(async(_req,res)=>{res.json(await listTournaments());}));
app.get('/api/tournaments/:id',handle(async(req,res)=>{const data=await getTournament(param(req.params.id));if(!data){res.status(404).json({error:'Tournament not found'});return;}res.json(data.public);}));
app.get('/api/tournaments/:id/operations',handle(async(req,res)=>{res.json(await operationHistory(param(req.params.id)));}));
app.get('/api/tournaments/:id/verification',handle(async(req,res)=>{const report=await verifyMatch(param(req.params.id));if(!report){res.status(404).json({error:'Tournament not found'});return;}res.json(report);}));
app.get('/api/tournaments/:id/replay/:hand',handle(async(req,res)=>{const hand=await replayHand(param(req.params.id),Number(param(req.params.hand)));if(!hand){res.status(404).json({error:'Hand not found'});return;}res.json(hand);}));
app.post('/api/tournaments',requireOwner,handle(async(req,res)=>{const t=await createTournament(res.locals.owner,req.body||{});broadcast('tournament.created',t);res.status(201).json(t);}));
app.post('/api/tournaments/:id/reserve',requireOwner,handle(async(req,res)=>{const t=await reserveSeat(res.locals.owner,param(req.params.id),req.body?.agentId);broadcast('tournament.updated',t);res.status(201).json(t);}));
app.post('/api/tournaments/:id/launch',requireOwner,handle(async(req,res)=>{const result=await launchTournament(res.locals.owner,param(req.params.id));res.status(202).json(result);}));
app.post('/api/tournaments/:id/entries/:agentId/submit',requireOwner,handle(async(req,res)=>{res.status(202).json(await submitEntry(res.locals.owner,param(req.params.id),param(req.params.agentId)));}));
app.get('/api/leaderboard',handle(async(_req,res)=>{res.json(await leaderboard());}));

server.on('upgrade',(request,socket,head)=>{if(new URL(request.url||'/',`http://${request.headers.host}`).pathname!=='/ws'){socket.destroy();return;}wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request));});
wss.on('connection',ws=>{ws.send(JSON.stringify({event:'connected',data:{network:'Arc Testnet'}}));});
app.use('/api',(_req,res)=>{res.status(404).json({error:'API route not found'});});
if(existsSync(resolve('dist/index.html'))){app.use(express.static(resolve('dist')));app.get(/.*/,(_req,res)=>res.sendFile(resolve('dist/index.html')));}
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const err=error as {code?:string;message?:string};
  const conflict=err.code==='23505';const badInput=err.code==='22P02'||/invalid|required|closed|full|missing|enough|configured|roster|agent|tournament|wallet|owner|strategy|model|share|fee/i.test(err.message||'');
  const status=conflict?409:badInput?400:500;
  if(status===500)console.error('Arena request failed',err.message);
  res.status(status).json({error:status===500?'The arena could not complete this request.':conflict?'This agent or seat already exists.':err.message});
});

export {app,server};
if(process.env.NODE_ENV!=='test'){
  await migrate();
  server.listen(PORT,HOST,()=>console.log(`Agent Arena production API listening on ${HOST}:${PORT}`));
  let busy=false;
  let indexing=false;
  const index=()=>{if(indexing)return;indexing=true;void Promise.all([indexArcTransfers(),syncAgentIdentities()]).catch(error=>console.error('Arc evidence sync failed',(error as Error).message)).finally(()=>{indexing=false;});};
  index();setInterval(index,5000);
  setInterval(()=>{if(busy)return;busy=true;void tickArena((action,tournamentId)=>broadcast('hand.action',{tournamentId,action}),(turn,tournamentId)=>broadcast('turn.thinking',{tournamentId,turn})).catch(error=>console.error('Arena tick failed',(error as Error).message)).finally(()=>{busy=false;});},2500);
  setInterval(()=>{void pool.query('DELETE FROM auth_challenges WHERE expires_at<now(); DELETE FROM auth_sessions WHERE expires_at<now()').catch(()=>{});for(const [ip,item] of requestCounts)if(item.until<Date.now())requestCounts.delete(ip);},300000);
}
