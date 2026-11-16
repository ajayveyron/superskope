import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHub} from '../src/server.mjs';

test('message actions validate scope, map native operations and persist no-retry outcomes',async t=>{
 const requests=[];let failure=false,negative=false,now=new Date('2026-11-16T06:00:00Z');
 const engine=createServer(async(req,res)=>{
  if(req.url==='/api/sessions/default'){await new Promise(r=>setTimeout(r,3));res.setHeader('Content-Type','application/json');res.end('{"status":"WORKING"}');return;}
  let body='';for await(const c of req)body+=c;requests.push({path:req.url,method:req.method,body:body?JSON.parse(body):null});
  res.writeHead(failure?500:200,{'Content-Type':'application/json'}).end(JSON.stringify({success:!negative}));
 });engine.listen(0,'127.0.0.1');await once(engine,'listening');
 const dataDir=mkdtempSync(join(tmpdir(),'superskope-actions-'));
 const options={wahaUrl:`http://127.0.0.1:${engine.address().port}`,wahaKey:'w'.repeat(32),apiKey:'a'.repeat(32),webhookSecret:'s'.repeat(32),dataDir,schedulerIntervalMs:0,commandIntervalMs:0,now:()=>now};
 let hub,base;
 async function start(){hub=createHub(options);hub.listen(0,'127.0.0.1');await once(hub,'listening');base=`http://127.0.0.1:${hub.address().port}`;}
 async function stop(){await new Promise(r=>hub.close(r));await new Promise(r=>setImmediate(r));}
 await start();t.after(async()=>{await stop();await new Promise(r=>engine.close(r));rmSync(dataDir,{recursive:true,force:true});});
 const source={chatId:'123@g.us',messageId:'true_123@g.us_ABC'};
 const call=async(id,body)=>{const r=await fetch(base+'/v1/message-actions',{method:'POST',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json',...(id?{'Idempotency-Key':id}:{})},body:JSON.stringify({...source,...body})});return {status:r.status,data:await r.json()};};
 await t.test('validates authentication, key, group ownership, content and reaction before upstream writes',async()=>{
  assert.equal((await fetch(base+'/v1/message-actions')).status,401);
  assert.equal((await call(null,{action:'delete'})).status,400);
  for(const body of [{chatId:'456@g.us',action:'delete'},{messageId:'../../secret',action:'delete'},{action:'edit',messageId:'false_123@g.us_ABC',text:'x'},{action:'edit',text:''},{action:'forward',targetChatId:'456@c.us'},{action:'react',reaction:'word'},{action:'react',reaction:'👍👍'},{action:'pin',days:2},{action:'unknown'}])assert.equal((await call('invalid-test',body)).status,400,JSON.stringify(body));
  assert.equal(requests.length,0);
 });
 await t.test('maps edit, delete, forward, reaction, pin and unpin to documented native APIs',async()=>{
  const cases=[['edit',{text:'Updated'},'PUT','/api/default/chats/123%40g.us/messages/true_123%40g.us_ABC',{text:'Updated'}],['delete',{},'DELETE','/api/default/chats/123%40g.us/messages/true_123%40g.us_ABC',null],['forward',{targetChatId:'456@g.us'},'POST','/api/forwardMessage',{session:'default',chatId:'456@g.us',messageId:source.messageId}],['react',{reaction:'👍🏽'},'PUT','/api/reaction',{session:'default',messageId:source.messageId,reaction:'👍🏽'}],['pin',{days:30},'POST','/api/default/chats/123%40g.us/messages/true_123%40g.us_ABC/pin',{duration:2592000}],['unpin',{},'POST','/api/default/chats/123%40g.us/messages/true_123%40g.us_ABC/unpin',{}]];
  for(const [action,extra,method,path,body]of cases){assert.equal((await call('action-'+action,{action,...extra})).status,201);assert.deepEqual(requests.at(-1),{method,path,body});}
 });
 await t.test('concurrent duplicate actions execute once and survive restart',async()=>{
  const before=requests.length,body={action:'react',reaction:''};
  const results=await Promise.all([call('concurrent-action',body),call('concurrent-action',body)]);assert.ok(results.some(r=>r.status===201));assert.equal(requests.length,before+1);
  await stop();await start();assert.equal((await call('concurrent-action',body)).status,200);assert.equal(requests.length,before+1);
  assert.equal((await call('concurrent-action',{action:'react',reaction:'👍'})).status,409);
 });
 await t.test('uncertain and rejected actions remain recorded and cannot replay',async()=>{
  failure=true;const r=await call('unknown-action',{action:'delete'});assert.equal(r.status,502);assert.equal(r.data.state,'unknown');
  failure=false;negative=true;const f=await call('failed-action',{action:'pin',days:1});assert.equal(f.status,502);assert.equal(f.data.state,'failed');negative=false;
  const before=requests.length;await stop();await start();assert.equal((await call('unknown-action',{action:'delete'})).status,409);assert.equal((await call('failed-action',{action:'pin',days:1})).status,409);assert.equal(requests.length,before);
  const log=await (await fetch(base+'/v1/message-actions',{headers:{Authorization:`Bearer ${options.apiKey}`}})).json();assert.ok(log.some(r=>r.state==='unknown'));assert.ok(log.some(r=>r.state==='failed'));assert.equal(log[0].hash,undefined);
 });
 await t.test('actions are rate limited before mutation',async()=>{
  assert.equal((await call('rate-ten',{action:'pin',days:7})).status,201);const before=requests.length;
  assert.equal((await call('rate-eleven',{action:'pin',days:7})).status,429);assert.equal(requests.length,before);
  now=new Date('2026-11-16T06:02:00Z');assert.equal((await call('rate-eleven',{action:'pin',days:7})).status,201);
 });
 await t.test('forwards and ordinary sends share the existing ten-send quota',async()=>{
  now=new Date('2026-11-16T06:04:00Z');
  const send=async id=>fetch(base+'/v1/messages',{method:'POST',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({type:'text',chatId:'123@g.us',text:'Quota fixture'})});
  for(let i=0;i<10;i++)assert.equal((await send('quota-first-'+i)).status,201);
  assert.equal((await call('quota-forward',{action:'forward',targetChatId:'456@g.us'})).status,429);
  now=new Date('2026-11-16T06:06:00Z');assert.equal((await call('quota-forward',{action:'forward',targetChatId:'456@g.us'})).status,201);
  for(let i=0;i<9;i++)assert.equal((await send('quota-second-'+i)).status,201);
  assert.equal((await send('quota-second-9')).status,429);
 });

});
