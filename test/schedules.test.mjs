import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHub} from '../src/server.mjs';
import {localToUtc,nextRun} from '../src/time.mjs';

test('wall-clock recurrence handles IST, weekends, DST gaps and repeated hours',()=>{
  assert.equal(localToUtc('2026-11-17T08:00','Asia/Kolkata'),'2026-11-17T02:30:00.000Z');
  assert.throws(()=>localToUtc('2026-03-08T02:30','America/New_York'),/clocks change/);
  assert.equal(localToUtc('2026-11-01T01:30','America/New_York'),'2026-11-01T05:30:00.000Z');
  assert.throws(()=>localToUtc('2026-02-31T08:00','Asia/Kolkata'),/valid/);
  assert.equal(nextRun({frequency:'daily',start_local:'2026-03-07T08:00',timezone:'America/New_York'},'2026-03-07T13:00:00.000Z'),'2026-03-08T12:00:00.000Z');
  assert.equal(nextRun({frequency:'weekdays',start_local:'2026-11-20T08:00',timezone:'Asia/Kolkata'},'2026-11-20T02:30:00.000Z'),'2026-11-23T02:30:00.000Z');
  assert.equal(nextRun({frequency:'weekly',start_local:'2026-11-17T08:00',timezone:'Asia/Kolkata'},'2026-11-17T02:30:00.000Z'),'2026-11-24T02:30:00.000Z');
});

test('durable scheduler sends once, retries only preflight failures, skips stale sends and preserves pauses',async t=>{
  let now=new Date('2026-11-16T06:00:00Z'),status='WORKING',fail=false,onStatus=null;
  const deliveries=[];
  const engine=createServer(async(req,res)=>{
    if(req.url==='/api/sessions/default'){await onStatus?.();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status}));return;}
    if(req.url==='/api/sendText'){let body='';for await(const c of req)body+=c;deliveries.push(JSON.parse(body));res.writeHead(fail?500:201,{'Content-Type':'application/json'}).end('{"id":"delivered"}');return;}
    res.writeHead(404).end();
  });engine.listen(0,'127.0.0.1');await once(engine,'listening');
  const dataDir=mkdtempSync(join(tmpdir(),'wa-schedules-'));
  const config={wahaUrl:`http://127.0.0.1:${engine.address().port}`,wahaKey:'w'.repeat(32),apiKey:'a'.repeat(32),webhookSecret:'s'.repeat(32),dataDir,now:()=>now,schedulerIntervalMs:0};
  let hub,base;
  async function start(){hub=createHub(config);hub.listen(0,'127.0.0.1');await once(hub,'listening');base=`http://127.0.0.1:${hub.address().port}`;}
  async function stop(){await new Promise(r=>hub.close(r));await new Promise(r=>setImmediate(r));}
  await start();t.after(async()=>{await stop();await new Promise(r=>engine.close(r));rmSync(dataDir,{recursive:true,force:true});});
  const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const body={name:'Test',chatId:'123@g.us',groupName:'Fixture group',text:'Scheduled hello',timezone:'Asia/Kolkata',startLocal:'2026-11-16T11:31',frequency:'once',enabled:true};
  let first;
  await t.test('validates future local time and persists schedules',async()=>{
    assert.equal((await call('/v1/schedules','POST',{...body,startLocal:'2026-11-16T11:00'})).status,400);
    const created=await call('/v1/schedules','POST',body);assert.equal(created.status,201);first=created.data;
    await stop();await start();assert.equal((await call('/v1/schedules')).data.length,1);
  });
  await t.test('due once send and concurrent ticks never duplicate',async()=>{
    now=new Date('2026-11-16T06:01:01Z');await Promise.all([hub.scheduler.tick(),hub.scheduler.tick()]);assert.equal(deliveries.length,1);
    await stop();await start();await hub.scheduler.tick();assert.equal(deliveries.length,1);
    const s=(await call('/v1/schedules')).data[0];assert.equal(s.enabled,false);assert.equal(s.next_run,null);
    assert.equal((await call('/v1/history')).data[0].state,'sent');
  });
  let daily;
  await t.test('disconnection retries before delivery; daily recurrence advances',async()=>{
    daily=(await call('/v1/schedules','POST',{...body,frequency:'daily',startLocal:'2026-11-16T11:32'})).data;
    status='STOPPED';now=new Date('2026-11-16T06:02:01Z');await hub.scheduler.tick();assert.equal(deliveries.length,1);
    assert.match((await call('/v1/schedules')).data.find(s=>s.id===daily.id).last_error,/not connected/);
    status='WORKING';await hub.scheduler.tick();assert.equal(deliveries.length,2);
    assert.equal((await call('/v1/schedules')).data.find(s=>s.id===daily.id).next_run,'2026-11-17T06:02:00.000Z');
  });
  await t.test('pause, edit, resume and delete do not trigger a send',async()=>{
    assert.equal((await call(`/v1/schedules/${daily.id}/enabled`,'PATCH',{enabled:false})).status,200);
    assert.equal((await call(`/v1/schedules/${daily.id}`,'PUT',{...body,frequency:'weekly',startLocal:'2026-11-17T12:00',enabled:false})).status,200);
    await hub.scheduler.tick();assert.equal(deliveries.length,2);
    assert.equal((await call(`/v1/schedules/${daily.id}/enabled`,'PATCH',{enabled:true})).status,200);
    await call(`/v1/schedules/${daily.id}`,'DELETE');assert.equal((await call('/v1/schedules')).data.length,1);
  });
  await t.test('missed sends are skipped after 15 minutes',async()=>{
    await call('/v1/schedules','POST',{...body,startLocal:'2026-11-16T11:33'});
    now=new Date('2026-11-16T06:49:00Z');await hub.scheduler.tick();assert.equal(deliveries.length,2);
    assert.ok((await call('/v1/history')).data.some(r=>r.state==='skipped'));
  });
  await t.test('uncertain upstream delivery is not retried after restart',async()=>{
    await call('/v1/schedules','POST',{...body,startLocal:'2026-11-16T12:20'});
    now=new Date('2026-11-16T06:50:01Z');fail=true;await hub.scheduler.tick();assert.equal(deliveries.length,3);
    await stop();await start();fail=false;await hub.scheduler.tick();assert.equal(deliveries.length,3);
    assert.ok((await call('/v1/history')).data.some(r=>r.state==='unknown'));
  });
  await t.test('pause while preflight is pending cancels that occurrence',async()=>{
    const s=(await call('/v1/schedules','POST',{...body,startLocal:'2026-11-16T12:21'})).data;
    now=new Date('2026-11-16T06:51:01Z');onStatus=async()=>{onStatus=null;await call(`/v1/schedules/${s.id}/enabled`,'PATCH',{enabled:false});};
    await hub.scheduler.tick();assert.equal(deliveries.length,3);
    assert.equal((await call('/v1/schedules')).data.find(x=>x.id===s.id).enabled,false);
  });
});
