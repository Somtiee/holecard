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

it('serves the production app and leaves the demo API unavailable',async()=>{
  const page=await fetch(base);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('AGENT ARENA');
  const demo=await fetch(`${base}/api/demo/tournaments`);
  expect(demo.status).toBe(404);
  expect(await demo.json()).toEqual({error:'API route not found'});
});

it('protects writes with same-origin and creator authentication',async()=>{
  const crossOrigin=await fetch(`${base}/api/agents`,{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'});
  expect(crossOrigin.status).toBe(403);
  const unauthenticated=await fetch(`${base}/api/agents`,{method:'POST',headers:{origin:'http://127.0.0.1:8787','content-type':'application/json'},body:'{}'});
  expect(unauthenticated.status).toBe(401);
  const withdrawal=await fetch(`${base}/api/agents/00000000-0000-4000-8000-000000000000/wallet/withdraw`,{method:'POST',headers:{origin:'http://127.0.0.1:8787','content-type':'application/json'},body:JSON.stringify({amountUsdc:'1',requestId:'00000000-0000-4000-8000-000000000001'})});
  expect(withdrawal.status).toBe(401);
});

it('rejects invalid sign-in challenges before touching storage',async()=>{
  const response=await fetch(`${base}/api/auth/challenge`,{method:'POST',headers:{origin:'http://127.0.0.1:8787','content-type':'application/json'},body:JSON.stringify({address:'not-an-address'})});
  expect(response.status).toBe(400);
});

it('exposes public network configuration without credentials',async()=>{
  const response=await fetch(`${base}/api/config`);
  const config=await response.json();
  expect(config.chainId).toBe(5042002);
  expect(config.network).toBe('Arc Testnet');
  expect(config).not.toHaveProperty('apiKey');
  expect(config).not.toHaveProperty('entitySecret');
});

it('opens a spectator WebSocket without private game state',async()=>{
  const event=await new Promise<any>((resolve,reject)=>{
    const ws=new WebSocket(base.replace('http:','ws:')+'/ws');
    const timer=setTimeout(()=>{ws.close();reject(new Error('Spectator connection timed out'));},3000);
    ws.once('error',error=>{clearTimeout(timer);reject(error);});
    ws.once('message',data=>{clearTimeout(timer);ws.close();resolve(JSON.parse(String(data)));});
  });
  expect(event).toEqual({event:'connected',data:{network:'Arc Testnet'}});
  expect(JSON.stringify(event)).not.toMatch(/seedSecret|holeCards|entitySecret|apiKey/);
});

it('requires creator authentication for funding verification and identity registration',async()=>{
  for(const route of ['wallet/funding/verify','identity']){
    const response=await fetch(`${base}/api/agents/00000000-0000-4000-8000-000000000000/${route}`,{method:'POST',headers:{origin:'http://127.0.0.1:8787','content-type':'application/json'},body:'{}'});
    expect(response.status).toBe(401);
  }
});
