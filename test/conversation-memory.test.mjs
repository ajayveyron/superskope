import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationMemory, memoryIdentity, memoryLimits } from '../src/conversation-memory.mjs';
import { createCommands } from '../src/commands.mjs';

const scope={account:'910000000001@c.us',group:'12345@g.us',actor:'910000000002@c.us'};
const target='910000000003@c.us';
function fixture(path=':memory:') {
  const db=new DatabaseSync(path);let time=new Date('2026-11-16T08:00:00Z');
  const commands=createCommands({db,groups:{},waha:async()=>{},send:async()=>{},intervalMs:0});
  const memory=createConversationMemory({db,now:()=>time});
  function add(id,{at=time.toISOString(),request='Please add Rashi.',state='completed',plan=[{action:'add',participants:[target]}],results=[{state:'completed'}],message='Added Rashi.'}={}){
    db.prepare('INSERT INTO commands VALUES (?,?,?,?,?,?)').run(id,scope.group,state,at,'{}',JSON.stringify({plan,results,message}));
    memory.begin(scope,{id,created_at:at},request);
    memory.people(id,[{id:target,ids:[target,'33333@lid'],name:'Rashi'}]);
  }
  return {db,commands,memory,add,setTime:value=>time=new Date(value)};
}
test('conversation survives a real SQLite reopen and isolates account, group and actor identities',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'superskope-memory-'));let f;
  try{
    const path=join(dir,'hub.sqlite');f=fixture(path);f.add('first');await f.commands.close();f.db.close();
    f=fixture(path);const recalled=f.memory.read(scope);
    assert.equal(recalled.recent[0].actions[0].state,'completed');assert.equal(recalled.recent[0].people[0].name,'Rashi');
    for(const key of ['account','group','actor'])assert.deepEqual(f.memory.read({...scope,[key]:'other'}),{recent:[],summary:[]});
    assert.equal(memoryIdentity({id:'22222@lid',phoneNumber:scope.actor}),scope.actor);
    assert.equal(memoryIdentity({id:scope.actor,lid:'22222@lid'}),scope.actor);
  }finally{if(f){await f.commands.close();f.db.close();}rmSync(dir,{recursive:true,force:true});}
});
test('compaction bounds context and retains exact action outcomes, people and setting values',async()=>{
  const f=fixture();try{
    for(let i=0;i<35;i++){
      f.setTime(new Date(Date.parse('2026-11-16T08:00:00Z')+i*1000));
      f.add('turn-'+i,{request:'Please update the description. '+ 'x'.repeat(2000),plan:[{action:'description',description:'Keep this exact description.'}],state:i%2?'failed':'completed',results:[{state:i%2?'failed':'completed'}]});
      f.memory.read(scope);
    }
    const context=f.memory.read(scope);
    assert.equal(context.recent.length,8);assert.equal(context.summary.length,12);
    assert.ok(JSON.stringify(context.recent).length<=memoryLimits.recentCharacters);
    assert.ok(JSON.stringify(context.summary).length<=memoryLimits.summaryCharacters);
    assert.match(context.summary[0].requestExcerpt,/remainder omitted/);
    assert.ok(context.summary.some(t=>t.actions[0].state==='failed'));
    assert.ok(context.summary.every(t=>t.actions[0].description==='Keep this exact description.'));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM conversation_turns').get().n,8);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM commands').get().n,35);
    f.setTime('2026-12-17T08:00:00Z');assert.deepEqual(f.memory.read(scope),{summary:[],recent:[]});
  }finally{await f.commands.close();f.db.close();}
});
test('only the latest unresolved clarification is active, expires in ten minutes, and keeps its history',async()=>{
  const f=fixture();try{
    f.add('unclear',{state:'clarification',plan:[],results:[],message:'Who do you mean?'});
    assert.equal(f.memory.read(scope).recent[0].clarificationOpen,true);
    f.setTime('2026-11-16T08:11:00Z');assert.equal(f.memory.read(scope).recent[0].clarificationOpen,false);
    f.add('another',{state:'clarification',plan:[],results:[],message:'What description?'});
    f.add('cancel',{request:'Never mind, cancel that.',plan:[],results:[],message:'Okay.'});
    assert.ok(f.memory.read(scope).recent.every(t=>!t.clarificationOpen));
  }finally{await f.commands.close();f.db.close();}
});
test('long exchanges obey character budgets and summaries never contain attachment bytes or raw provider data',async()=>{
  const f=fixture();try{
    for(let i=0;i<12;i++)f.add('long-'+i,{request:'x'.repeat(8000),plan:[{action:'picture',data:'PRIVATE_IMAGE_BYTES'}],results:[{state:'completed',result:{secret:'PRIVATE_PROVIDER_DATA'}}]});
    const context=f.memory.read(scope);
    assert.ok(context.recent.length<8);assert.ok(context.recent.length>0);
    assert.ok(JSON.stringify(context.recent).length<=memoryLimits.recentCharacters);
    assert.ok(JSON.stringify(context.summary).length<=memoryLimits.summaryCharacters);
    assert.doesNotMatch(JSON.stringify(context),/PRIVATE_IMAGE_BYTES|PRIVATE_PROVIDER_DATA/);
  }finally{await f.commands.close();f.db.close();}
});
test('restart preserves confirmed partial work, labels interrupted work unknown, and never queues it again',async()=>{
  const f=fixture();let reopened;
  try{
    f.add('interrupted',{state:'processing',plan:[{action:'add',participants:[target]},{action:'promote',participants:[target]}],results:[{state:'completed'}],message:''});
    await f.commands.close();
    reopened=createCommands({db:f.db,groups:{},waha:async()=>{throw Error('Must not replay');},send:async()=>{},intervalMs:0});
    assert.equal(reopened.history()[0].state,'unknown');
    assert.deepEqual(f.memory.read(scope).recent[0].actions.map(a=>a.state),['completed','unknown']);
    reopened.configure({enabled:true});await reopened.tick();assert.equal(reopened.history()[0].state,'unknown');
  }finally{await reopened?.close();await f.commands.close();f.db.close();}
});
