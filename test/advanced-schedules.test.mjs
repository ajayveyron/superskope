import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHub} from '../src/server.mjs';
import {nextRun} from '../src/time.mjs';

const schedule={frequency:'monthly',start_local:'2026-01-31T08:00',timezone:'Asia/Kolkata'};
test('advanced recurrence anchors intervals, skips absent month dates and respects inclusive end dates',()=>{
 assert.equal(nextRun(schedule,'2026-01-31T02:30:00Z'),'2026-03-31T02:30:00.000Z');
 assert.equal(nextRun({...schedule,start_local:'2028-01-29T08:00'},'2028-01-29T02:30:00Z'),'2028-02-29T02:30:00.000Z');
 assert.equal(nextRun({...schedule,start_local:'2026-01-01T08:00',month_days:[1,15],repeat_interval:2},'2026-01-15T02:30:00Z'),'2026-03-01T02:30:00.000Z');
 assert.equal(nextRun({...schedule,frequency:'daily',start_local:'2026-11-16T08:00',repeat_interval:3},'2026-11-17T00:00:00Z'),'2026-11-19T02:30:00.000Z');
 const weekly={...schedule,frequency:'weekly',start_local:'2026-11-16T08:00',repeat_interval:2,weekdays:[1,4]};
 assert.equal(nextRun(weekly,'2026-11-16T02:30:00Z'),'2026-11-19T02:30:00.000Z');
 assert.equal(nextRun(weekly,'2026-11-19T02:30:00Z'),'2026-11-30T02:30:00.000Z');
 assert.equal(nextRun({...weekly,end_date:'2026-11-19'},'2026-11-19T02:30:00Z'),null);
 assert.equal(nextRun({...weekly,end_date:'2026-11-19'},'2026-11-16T02:30:00Z'),'2026-11-19T02:30:00.000Z');
 assert.equal(nextRun({frequency:'daily',start_local:'2026-03-07T02:30',timezone:'America/New_York',weekdays:[0,1,6]},'2026-03-07T07:30:00Z'),'2026-03-09T06:30:00.000Z');
 assert.equal(nextRun({...schedule,start_local:'2026-01-31T08:00',end_date:'2026-02-28'},'2026-01-31T02:30:00Z'),null);
});

test('attachments persist privately, send once, and advanced schedules support safe skip and expiry',async t=>{
 let now=new Date('2026-11-16T06:00:00Z'),fail=false,onStatus=null;
 const deliveries=[];
 const engine=createServer(async(req,res)=>{
  if(req.url==='/api/sessions/default'){await onStatus?.();res.setHeader('Content-Type','application/json');res.end('{"status":"WORKING"}');return;}
  let body='';for await(const c of req)body+=c;deliveries.push({path:req.url,body:JSON.parse(body)});
  res.writeHead(fail?500:201,{'Content-Type':'application/json'}).end('{"id":"true_123@g.us_fixture"}');
 });engine.listen(0,'127.0.0.1');await once(engine,'listening');
 const dataDir=mkdtempSync(join(tmpdir(),'superskope-advanced-'));
 const config={wahaUrl:`http://127.0.0.1:${engine.address().port}`,wahaKey:'w'.repeat(32),apiKey:'a'.repeat(32),webhookSecret:'s'.repeat(32),dataDir,now:()=>now,schedulerIntervalMs:0,commandIntervalMs:0};
 let hub,base;
 async function start(){hub=createHub(config);hub.listen(0,'127.0.0.1');await once(hub,'listening');base=`http://127.0.0.1:${hub.address().port}`;}
 async function stop(){await new Promise(r=>hub.close(r));await new Promise(r=>setImmediate(r));}
 await start();t.after(async()=>{await stop();await new Promise(r=>engine.close(r));rmSync(dataDir,{recursive:true,force:true});});
 const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const body={name:'PDF update',chatId:'123@g.us',groupName:'Fixture',type:'pdf',filename:'plan.pdf',data:Buffer.from('%PDF-1.4\nfixture').toString('base64'),text:'See attached',timezone:'Asia/Kolkata',startLocal:'2026-11-16T11:31',frequency:'weekly',interval:2,weekdays:[1,4],endDate:'2026-12-01',enabled:true};
 let first;
 await t.test('validates files and recurrence before storing; omits attachment bytes from responses',async()=>{
  for(const delta of [{data:'aGVsbG8='},{interval:0},{weekdays:[2]},{endDate:'2026-02-31'},{endDate:'2026-11-15'},{monthDays:[0]},{type:'text',text:''},{weekdays:[1,1]}])assert.equal((await call('/v1/schedules','POST',{...body,...delta})).status,400,JSON.stringify(delta));
  const result=await call('/v1/schedules','POST',body);assert.equal(result.status,201);first=result.data;
  assert.equal(first.has_attachment,true);assert.equal(first.attachment_data,undefined);assert.equal(first.data,undefined);assert.deepEqual(first.weekdays,[1,4]);
  await stop();await start();
  const {data,...withoutBytes}=body;assert.equal((await call('/v1/schedules/'+first.id,'PUT',{...withoutBytes,name:'Retained attachment'})).status,200);
 });
 await t.test('sends stored PDF after restart and returns actionable message ID',async()=>{
  now=new Date('2026-11-16T06:01:01Z');await hub.scheduler.tick();assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].path,'/api/sendFile');assert.equal(deliveries[0].body.file.data,body.data);assert.equal(deliveries[0].body.caption,'See attached');
  assert.equal((await call('/v1/history')).data[0].message_id,'true_123@g.us_fixture');
 });
 await t.test('skip advances exactly one occurrence and logs it, including on a paused schedule',async()=>{
  const current=(await call('/v1/schedules')).data[0];assert.equal(current.next_run,'2026-11-19T06:01:00.000Z');
  await call(`/v1/schedules/${first.id}/enabled`,'PATCH',{enabled:false});
  const path=`/v1/schedules/${first.id}/skip`,request={expectedNextRun:current.next_run};
  const skipped=await call(path,'POST',request);assert.equal(skipped.status,200);assert.equal(skipped.data.next_run,'2026-11-30T06:01:00.000Z');assert.equal(skipped.data.enabled,false);
  assert.equal((await call(path,'POST',request)).status,409);assert.equal(deliveries.length,1);
  assert.ok((await call('/v1/history')).data.some(r=>r.state==='skipped'&&r.error==='Skipped by operator.'));
 });
 await t.test('expired end dates cannot be resumed; finishing final occurrence disables series',async()=>{
  now=new Date('2026-12-02T06:00:00Z');assert.equal((await call(`/v1/schedules/${first.id}/enabled`,'PATCH',{enabled:true})).status,400);
  const s=(await call('/v1/schedules','POST',{...body,frequency:'daily',interval:1,weekdays:[],startLocal:'2026-12-02T11:31',endDate:'2026-12-02'})).data;
  now=new Date('2026-12-02T06:01:01Z');await hub.scheduler.tick();
  const ended=(await call('/v1/schedules')).data.find(x=>x.id===s.id);assert.equal(ended.next_run,null);assert.equal(ended.enabled,false);
 });
 await t.test('skip cannot race an in-flight send and uncertain media is never resubmitted',async()=>{
  const image={...body,type:'image',filename:undefined,data:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64'),frequency:'once',interval:1,weekdays:[],endDate:null,startLocal:'2026-12-02T11:32'};
  const s=(await call('/v1/schedules','POST',image)).data;
  now=new Date('2026-12-02T06:02:01Z');let skipStatus;
  onStatus=async()=>{onStatus=null;skipStatus=(await call(`/v1/schedules/${s.id}/skip`,'POST',{expectedNextRun:s.next_run})).status;};
  fail=true;await hub.scheduler.tick();assert.equal(skipStatus,409);assert.equal(deliveries.at(-1).path,'/api/sendImage');const count=deliveries.length;
  await stop();await start();fail=false;await hub.scheduler.tick();assert.equal(deliveries.length,count);
  assert.ok((await call('/v1/history')).data.some(r=>r.state==='unknown'));
 });
});

test('legacy text schedules migrate without changing cadence or content',async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'superskope-migrate-'));
 const db=new DatabaseSync(join(dataDir,'hub.sqlite'));
 db.exec(`CREATE TABLE schedules (id TEXT PRIMARY KEY,name TEXT NOT NULL,chat_id TEXT NOT NULL,group_name TEXT NOT NULL,text TEXT NOT NULL,timezone TEXT NOT NULL,start_local TEXT NOT NULL,frequency TEXT NOT NULL,next_run TEXT,enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT);
 INSERT INTO schedules VALUES ('legacy','Existing','123@g.us','Fixture','Keep this','UTC','2026-11-17T08:00','daily','2026-11-17T08:00:00.000Z',0,'2026-11-16','2026-11-16',NULL);`);db.close();
 const hub=createHub({wahaUrl:'http://127.0.0.1:1',wahaKey:'w'.repeat(32),apiKey:'a'.repeat(32),webhookSecret:'s'.repeat(32),dataDir,schedulerIntervalMs:0,commandIntervalMs:0});
 hub.listen(0,'127.0.0.1');await once(hub,'listening');
 t.after(async()=>{await new Promise(r=>hub.close(r));await new Promise(r=>setImmediate(r));rmSync(dataDir,{recursive:true,force:true});});
 const [s]=hub.scheduler.list();assert.equal(s.text,'Keep this');assert.equal(s.message_type,'text');assert.equal(s.repeat_interval,1);assert.equal(s.next_run,'2026-11-17T08:00:00.000Z');assert.equal(s.enabled,false);
});
