import {describe,it,expect} from 'vitest';
import {runPractice,practiceInput} from '../src/server/production/practice';
import {ELO_START,eloRatings} from '../src/server/production/rating';

describe('practice sit-and-go',()=>{
  it('plays a complete game that conserves chips and explains every decision',async()=>{
    const r=await runPractice({name:'nightowl',strategy:'Aggressive'});
    expect(r.seats.map(s=>s.name)).toEqual(['NIGHTOWL','GRANITE','VIPER','MIRAGE']);
    expect(r.hands.length).toBeGreaterThan(0);
    expect(r.hands.length).toBeLessThanOrEqual(30);
    for(const h of r.hands){
      const before=Object.values(h.startStacks).reduce((a,b)=>a+b,0),after=Object.values(h.endStacks).reduce((a,b)=>a+b,0);
      expect(after).toBe(before);
      expect(before).toBe(4000);
      for(const d of h.decisions){expect(d.reason).toMatch(/[a-z]/);expect(d.reason).not.toMatch(/within the configured strategy|legal range/);}
    }
    expect(r.standings.map(s=>s.place)).toEqual([1,2,3,4]);
    expect(r.standings.reduce((n,s)=>n+s.stack,0)).toBe(4000);
    expect(r.you.net).toBe(r.standings.find(s=>s.id==='you')!.stack-1000);
    expect(r.seed).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects bad names, house-bot names and unknown strategies',()=>{
    expect(()=>practiceInput({name:'',strategy:'Balanced'})).toThrow();
    expect(()=>practiceInput({name:'<script>',strategy:'Balanced'})).toThrow();
    expect(()=>practiceInput({name:'viper',strategy:'Balanced'})).toThrow(/house bot/);
    expect(()=>practiceInput({name:'ok',strategy:'Custom'})).toThrow();
    expect(practiceInput({name:' ace 7 ',strategy:'Mathematical'})).toEqual({name:'ACE 7',strategy:'Mathematical'});
  });
});

describe('Elo rating',()=>{
  it('starts everyone at the same rating and rewards higher finishes',()=>{
    const r=eloRatings([['a','b']]);
    expect(r.get('a')).toBe(ELO_START+16);
    expect(r.get('b')).toBe(ELO_START-16);
  });
  it('is zero-sum per table and orders a multi-seat finish',()=>{
    const r=eloRatings([['a','b','c','d']]);
    expect([...r.values()].reduce((n,x)=>n+x,0)).toBe(4*ELO_START);
    expect(r.get('a')!).toBeGreaterThan(r.get('b')!);
    expect(r.get('b')!).toBeGreaterThan(r.get('c')!);
    expect(r.get('c')!).toBeGreaterThan(r.get('d')!);
  });
  it('gains less for beating a weaker opponent than an equal one',()=>{
    const r=eloRatings([['a','b'],['a','b'],['a','b'],['c','a']]);
    const upset=eloRatings([['c','d']]);
    expect(r.get('c')!-ELO_START).toBeGreaterThan(upset.get('c')!-ELO_START);
  });
});
