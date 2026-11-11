import {afterAll,beforeAll,expect,it} from 'vitest';
import {WebSocket} from 'ws';
import {server} from '../src/server/production/index';

let base:string;
beforeAll(async()=>{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('Test server did not bind');
  base=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});

it('leaves unknown API routes unavailable',async()=>{
  const demo=await fetch(`${base}/api/demo/tournaments`);
  expect(demo.status).toBe(404);
  expect(await demo.json()).toEqual({error:'API route not found'});
});

it('protects writes with same-origin and creator authentication',async()=>{
  const crossOrigin=await fetch(`${base}/api/agents`,{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'});
  expect(crossOrigin.status).toBe(403);
  for(const path of ['/api/agents','/api/tournaments','/api/agents/00000000-0000-4000-8000-000000000000/provision','/api/tournaments/00000000-0000-4000-8000-000000000000/launch','/api/agent-market/preview']){
    const response=await fetch(`${base}${path}`,{method:'POST',headers:{origin:'http://127.0.0.1:8787','content-type':'application/json'},body:'{}'});
    expect(response.status,path).toBe(401);
  }
});

it('rejects malformed NEP-413 sign-in before touching storage',async()=>{
  const response=await fetch(`${base}/api/auth/verify`,{method:'POST',headers:{origin:'http://127.0.0.1:8787','content-type':'application/json'},body:JSON.stringify({accountId:'Not An Account',publicKey:'x',signature:'y',nonce:'z'})});
  expect(response.status).toBe(400);
});

it('exposes public NEAR configuration without credentials',async()=>{
  const response=await fetch(`${base}/api/config`);
  const config=await response.json();
  expect(config.network).toBe('testnet');
  expect(config.rpcUrl).toMatch(/^https:\/\//);
  expect(JSON.stringify(config)).not.toMatch(/PRIVATE|ed25519:[1-9A-HJ-NP-Za-km-z]{60,}|NEARAI_API_KEY|aat_/);
});

it('opens a spectator WebSocket without private game state',async()=>{
  const event=await new Promise<any>((resolve,reject)=>{
    const ws=new WebSocket(base.replace('http:','ws:')+'/ws');
    const timer=setTimeout(()=>{ws.close();reject(new Error('Spectator connection timed out'));},3000);
    ws.once('error',error=>{clearTimeout(timer);reject(error);});
    ws.once('message',data=>{clearTimeout(timer);ws.close();resolve(JSON.parse(String(data)));});
  });
  expect(event).toEqual({event:'connected',data:{network:'NEAR testnet'}});
  expect(JSON.stringify(event)).not.toMatch(/seedSecret|holeCards|apiKey/);
});
