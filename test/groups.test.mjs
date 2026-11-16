import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createGroupActions} from '../src/group-actions.mjs';
import {createCommands,adminOnlyReply} from '../src/commands.mjs';

const bot='910000000001@c.us',admin='910000000002@c.us',member='910000000003@c.us';
const chat='12345@g.us';
function fixture(){
 const db=new DatabaseSync(':memory:');const calls=[];const replies=[];const interpretations=[];const presence=[];
 const group={id:chat,participants:[{id:'11111@lid',phoneNumber:bot,admin:'admin'},{id:'22222@lid',phoneNumber:admin,admin:'admin'},{id:'33333@lid',phoneNumber:member,admin:null}]};
 let fail=false,result=true,interpretError,sendError,plan={intent:'act',message:'',actions:[{action:'promote',participants:[member]}]};
 const waha=async(path,body,method)=>{if(path==='/api/sessions/default')return {status:'WORKING',me:{id:bot,lid:'11111@lid'}};if(path.startsWith('/api/contacts/all'))return [];if(path==='/api/default/groups/'+encodeURIComponent(chat)&&body===undefined)return group;calls.push({path,body,method});if(fail)throw Error('network interrupted');return result;};
 const groups=createGroupActions({db,waha});const commands=createCommands({db,groups,waha,startTyping:async id=>{presence.push(['start',id]);return {beforeSend:async()=>{presence.push(['ready',id]);},stop:async()=>{presence.push(['stop',id]);}};},interpret:async input=>{interpretations.push(input);if(interpretError)throw interpretError;return plan;},send:async(body,id)=>{presence.push(['send',body.chatId]);if(sendError)throw sendError;replies.push({body,id});return {state:'sent'};},media:async()=>{throw Error('no media');},intervalMs:0});
 const event=(extra={})=>({id:'evt1',event:'message',session:'default',me:{id:bot,lid:'11111@lid'},payload:{id:'wa-message-1',timestamp:Date.now()/1000,from:chat,to:bot,participant:'22222@lid',fromMe:false,body:'@910000000001 promote @910000000003',_data:{message:{extendedTextMessage:{contextInfo:{mentionedJid:[bot,member]}}}},...extra}});
 return {db,calls,replies,interpretations,presence,group,groups,commands,event,setFailure:value=>fail=value,setResult:value=>result=value,setPlan:value=>plan=value,setInterpretError:value=>interpretError=value,setSendError:value=>sendError=value};
}
test('group actions resolve LIDs, require bot admin, and never replay an uncertain mutation',async()=>{
 const f=fixture();try{
  const first=await f.groups.execute(chat,{action:'promote',participants:[member]},'promote-001',admin);
  assert.equal(first.state,'completed');assert.deepEqual(f.calls[0].body,{participants:[{id:'33333@lid'}]});
  assert.equal((await f.groups.execute(chat,{action:'promote',participants:[member]},'promote-001',admin)).replayed,true);assert.equal(f.calls.length,1);
  await assert.rejects(()=>f.groups.execute(chat,{action:'remove',participants:[member]},'promote-001',admin),/another group action/);
  await assert.rejects(()=>f.groups.execute(chat,{action:'promote',participants:[member]},'promote-002',member),/approved operator/);
  f.group.participants[0].admin=null;await assert.rejects(()=>f.groups.execute(chat,{action:'description',description:'Test'},'describe-001'),/Make SuperSkope an admin/);f.group.participants[0].admin='admin';
  f.setFailure(true);assert.equal((await f.groups.execute(chat,{action:'description',description:'Test'},'describe-002')).state,'unknown');
  f.setFailure(false);assert.equal((await f.groups.execute(chat,{action:'description',description:'Test'},'describe-002')).state,'unknown');assert.equal(f.calls.length,2);
 }finally{await f.commands.close();f.db.close();}
});
test('partial WhatsApp participant errors are not reported as success',async()=>{
 const f=fixture();try{f.setResult([{jid:member,status:'403'}]);assert.equal((await f.groups.execute(chat,{action:'add',participants:[member]},'add-test-001')).state,'failed');}finally{await f.commands.close();f.db.close();}
});
test('mention commands require an actual mention and current group-admin membership; events deduplicate',async()=>{
 const f=fixture();try{
  f.commands.configure({enabled:true});
  f.commands.enqueue(f.event());f.commands.enqueue({...f.event(),event:'message.any',id:'evt2'});await f.commands.tick();
  assert.equal(f.calls.length,1);assert.equal(f.replies.length,1);assert.equal(f.commands.history().length,1);
  f.commands.enqueue(f.event({id:'nonadmin',participant:'33333@lid'}));await f.commands.tick();assert.equal(f.calls.length,1);assert.equal(f.replies.length,2);assert.equal(f.interpretations.length,1);
  f.commands.enqueue(f.event({id:'plain-text',_data:{}}));await f.commands.tick();assert.equal(f.commands.history().length,2);
  f.commands.enqueue(f.event({id:'old',timestamp:Date.now()/1000-1000}));await f.commands.tick();assert.equal(f.commands.history().length,2);
  f.commands.enqueue(f.event({id:'api',fromMe:true,source:'api',to:chat,body:'SuperSkope set name: Loop'}));await f.commands.tick();assert.equal(f.calls.length,1);
  f.setPlan({intent:'act',message:'',actions:[{action:'description',description:'Kitchen test'}]});
  f.commands.enqueue(f.event({id:'self',fromMe:true,source:'app',to:chat,body:'SuperSkope can you put Kitchen test in the group description?',_data:{}}));await f.commands.tick();assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.description,'Kitchen test');
 }finally{await f.commands.close();f.db.close();}
});
test('non-admin members get one preset reply without AI or actions; unknown senders get no reply',async()=>{
 const f=fixture();try{
  f.commands.configure({enabled:true});const event=f.event({id:'nonadmin-preset',participant:'33333@lid',body:'@910000000001 please make me an admin'});
  f.commands.enqueue(event);f.commands.enqueue({...event,event:'message.any',id:'duplicate-envelope'});await f.commands.tick();await f.commands.tick();
  assert.equal(f.interpretations.length,0);assert.equal(f.calls.length,0);assert.equal(f.replies.length,1);
  assert.equal(f.replies[0].body.chatId,chat);assert.equal(f.replies[0].body.text,'SuperSkope: '+adminOnlyReply);assert.equal(f.commands.history()[0].state,'rejected');
  assert.deepEqual(f.presence,[['start',chat],['ready',chat],['send',chat],['stop',chat]]);
  f.commands.enqueue(f.event({id:'unknown-sender',participant:'99999@lid'}));await f.commands.tick();
  assert.equal(f.replies.length,1);assert.equal(f.interpretations.length,0);assert.equal(f.calls.length,0);
  assert.equal(f.presence.length,4);
 }finally{await f.commands.close();f.db.close();}
});
test('typing surrounds AI answers, clarifications and errors, and stops after a failed send',async()=>{
 for(const mode of ['answer','clarify','model-error','send-error']){
  const f=fixture();try{
   f.commands.configure({enabled:true});f.setPlan({intent:mode==='clarify'?'clarify':'answer',message:'Test response.',actions:[]});
   if(mode==='model-error')f.setInterpretError(Object.assign(Error('AI is unavailable.'),{status:503}));
   if(mode==='send-error')f.setSendError(Error('Delivery unavailable.'));
   f.commands.enqueue(f.event());await f.commands.tick();
   assert.deepEqual(f.presence,[['start',chat],['ready',chat],['send',chat],['stop',chat]],mode);
   assert.equal(f.interpretations.length,1);assert.equal(f.calls.length,0);
  }finally{await f.commands.close();f.db.close();}
 }
});
test('clarifications and completed actions persist for the same admin without leaking to another admin',async()=>{
 const f=fixture();try{
  f.commands.configure({enabled:true});f.setPlan({intent:'clarify',message:'Who should become an admin?',actions:[]});
  f.commands.enqueue(f.event({id:'unclear',body:'@910000000001 make him admin'}));await f.commands.tick();assert.equal(f.calls.length,0);assert.equal(f.commands.history()[0].state,'clarification');
  f.setPlan({intent:'answer',message:'I can help manage this group.',actions:[]});
  f.commands.enqueue(f.event({id:'other-admin',fromMe:true,source:'app',to:chat,body:'SuperSkope what can you do?'}));await f.commands.tick();assert.equal(f.interpretations[1].conversation.recent.length,0);
  f.setPlan({intent:'act',message:'',actions:[{action:'promote',participants:[member]}]});
  f.commands.enqueue(f.event({id:'answer',body:'@910000000001 I meant @910000000003'}));await f.commands.tick();assert.equal(f.interpretations[2].conversation.recent.length,1);assert.equal(f.interpretations[2].conversation.recent[0].clarificationOpen,true);assert.equal(f.calls.length,1);
  f.setPlan({intent:'answer',message:'The admin change was completed.',actions:[]});
  f.commands.enqueue(f.event({id:'new-request',body:'@910000000001 what happened?'}));await f.commands.tick();
  const previous=f.interpretations[3].conversation.recent;
  assert.equal(previous.length,2);assert.equal(previous[0].clarificationOpen,false);
  assert.equal(previous[1].actions[0].state,'completed');assert.deepEqual(previous[1].actions[0].participants,[member]);assert.equal(f.calls.length,1);
  // Revocation is checked before reading memory or invoking the model.
  f.group.participants[1].admin=null;
  f.commands.enqueue(f.event({id:'revoked',body:'@910000000001 undo that'}));await f.commands.tick();
  assert.equal(f.interpretations.length,4);assert.equal(f.calls.length,1);assert.equal(f.commands.history()[0].state,'rejected');
 }finally{await f.commands.close();f.db.close();}
});
test('multi-action requests stop at an uncertain action and do not re-run on duplicate webhooks',async()=>{
 const f=fixture();try{
  f.commands.configure({enabled:true});f.setPlan({intent:'act',message:'',actions:[{action:'description',description:'Example'},{action:'promote',participants:[member]}]});f.setFailure(true);
  f.commands.enqueue(f.event());await f.commands.tick();assert.equal(f.calls.length,1);assert.equal(f.commands.history()[0].state,'unknown');assert.match(f.replies[0].body.text,/stopped/);
  f.setFailure(false);f.commands.enqueue(f.event());await f.commands.tick();assert.equal(f.calls.length,1);
  f.setPlan({intent:'answer',message:'The first change is unconfirmed; the next was not attempted.',actions:[]});
  f.commands.enqueue(f.event({id:'ask-outcome',body:'@910000000001 what happened?'}));await f.commands.tick();
  assert.deepEqual(f.interpretations[1].conversation.recent[0].actions.map(a=>a.state),['unknown','not-run']);assert.equal(f.calls.length,1);
 }finally{await f.commands.close();f.db.close();}
});
