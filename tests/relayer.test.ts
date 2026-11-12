import {createHash,randomBytes} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {KeyPair,SCHEMA,Signature,actions,buildDelegateAction,encodeDelegateAction} from 'near-api-js';
import {serialize} from 'borsh';
import {isImplicitAccountOf,nep413Hash,verifyNep413Signature} from '../src/server/near';
import {checkDelegate} from '../src/server/relayer';
import {handSeed} from '../src/server/production/commitments';

beforeAll(()=>{process.env.ARENA_CONTRACT_ID='arena.testnet';});

function signed(sender:string,receiver:string,method:string,gas=30_000_000_000_000n){
  const kp=KeyPair.fromRandom('ed25519');
  const da=buildDelegateAction({senderId:sender,receiverId:receiver,actions:[actions.functionCall(method,{agent:'a.arena.testnet'},gas,1n)],nonce:1n,maxBlockHeight:10n,publicKey:kp.getPublicKey()});
  const sig=kp.sign(createHash('sha256').update(encodeDelegateAction(da)).digest());
  const sd=actions.signedDelegate({delegateAction:da,signature:new Signature({keyType:0,data:sig.signature})}).signedDelegate;
  return Buffer.from(serialize(SCHEMA.SignedDelegate,sd as never)).toString('base64');
}

describe('NEP-366 relayer policy',()=>{
  it('relays a deposit signed by the session account to the arena',()=>{
    expect(checkDelegate(signed('alice.testnet','arena.testnet','deposit'),'alice.testnet').delegateAction.senderId).toBe('alice.testnet');
  });
  it('refuses other senders, other contracts, other methods and excess gas',()=>{
    expect(()=>checkDelegate(signed('mallory.testnet','arena.testnet','deposit'),'alice.testnet')).toThrow(/signed-in account/);
    expect(()=>checkDelegate(signed('alice.testnet','wrap.testnet','deposit'),'alice.testnet')).toThrow(/arena contract/);
    expect(()=>checkDelegate(signed('alice.testnet','arena.testnet','create_agent'),'alice.testnet')).toThrow(/deposit and withdraw/);
    expect(()=>checkDelegate(signed('alice.testnet','arena.testnet','deposit',300_000_000_000_000n),'alice.testnet')).toThrow(/gas/);
    expect(()=>checkDelegate('not-borsh','alice.testnet')).toThrow(/Invalid/);
  });
});

describe('NEAR Auth implicit-account sign-in',()=>{
  it('accepts an implicit account derived from the signing key and nothing else',()=>{
    const kp=KeyPair.fromRandom('ed25519'),pk=kp.getPublicKey().toString();
    const implicit=Buffer.from(kp.getPublicKey().data).toString('hex');
    expect(isImplicitAccountOf(implicit,pk)).toBe(true);
    expect(isImplicitAccountOf('alice.testnet',pk)).toBe(false);
    expect(isImplicitAccountOf('0'.repeat(64),pk)).toBe(false);
    const nonce=randomBytes(32),message='Agent Arena sign-in',recipient='localhost';
    const signature=Buffer.from(kp.sign(nep413Hash({message,nonce,recipient})).signature).toString('base64');
    expect(verifyNep413Signature({publicKey:pk,signature,message,nonce,recipient})).toBe(true);
  });
});

describe('VRF-mixed deck seeds',()=>{
  it('changes every hand seed when the verified VRF output changes',()=>{
    const seed='ab'.repeat(32);
    expect(handSeed(seed,'t',1,'11'.repeat(32))).not.toBe(handSeed(seed,'t',1,'22'.repeat(32)));
    expect(handSeed(seed,'t',1,'11'.repeat(32))).not.toBe(handSeed(seed,'t',1));
    expect(handSeed(seed,'t',1)).toBe(handSeed(seed,'t',1,undefined));
  });
});
