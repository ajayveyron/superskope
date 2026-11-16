import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {createPairingServer} from '../scripts/pairing.mjs';

test('pairing refresh recovers expired sessions without restarting a linked phone',async t=>{
  let status='FAILED';const actions=[];
  const engine=createServer(async(req,res)=>{
    if(req.method==='POST'){
      actions.push(req.url);
      await new Promise(r=>setTimeout(r,20));
      status='STARTING';
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status}));
  });
  engine.listen(0,'127.0.0.1');await once(engine,'listening');
  const server=createPairingServer({wahaUrl:`http://127.0.0.1:${engine.address().port}`,wahaKey:'test-key'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>engine.close(r));});
  const url=`http://127.0.0.1:${server.address().port}/refresh`;
  const headers={Host:'localhost:3012',Origin:'http://localhost:3012','Content-Type':'application/json'};
  function post(requestHeaders){return new Promise((resolve,reject)=>{
    const req=request(url,{method:'POST',headers:requestHeaders},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(body)}));
    });req.on('error',reject);req.end();
  });}
  const refresh=()=>post(headers);
  const results=await Promise.all([refresh(),refresh()]);
  for(const r of results){assert.equal(r.status,200);assert.equal((await r.json()).status,'STARTING');}
  assert.deepEqual(actions,['/api/sessions/default/restart']);
  status='WORKING';await refresh();assert.equal(actions.length,1);
  status='SCAN_QR_CODE';await refresh();assert.equal(actions.length,1);
  status='STOPPED';await refresh();assert.equal(actions[1],'/api/sessions/default/start');
  assert.equal((await post({...headers,Origin:'https://other.example'})).status,403);
  assert.equal((await post({Host:'localhost:3012'})).status,403);
  assert.equal(actions.length,2);
});

test('panel proxies scheduled attachments and action keys without weakening origin checks',async t=>{
 const received=[];
 const hub=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;received.push({path:req.url,key:req.headers['idempotency-key'],auth:req.headers.authorization,body:JSON.parse(body)});res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});
 hub.listen(0,'127.0.0.1');await once(hub,'listening');
 const panel=createPairingServer({hubUrl:`http://127.0.0.1:${hub.address().port}`,hubKey:'fixture-only'});panel.listen(0,'127.0.0.1');await once(panel,'listening');
 t.after(async()=>{await new Promise(r=>panel.close(r));await new Promise(r=>hub.close(r));});
 const post=(path,body,extra={})=>new Promise((resolve,reject)=>{const req=request(`http://127.0.0.1:${panel.address().port}${path}`,{method:'POST',headers:{Host:'localhost:3012',Origin:'http://localhost:3012','Content-Type':'application/json',...extra}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(body));});
 assert.equal(await post('/v1/schedules',{data:'x'.repeat(50000)}),200);assert.equal(received[0].body.data.length,50000);
 assert.equal(await post('/v1/message-actions',{action:'pin'},{'Idempotency-Key':'fixture-action'}),200);assert.equal(received[1].key,'fixture-action');assert.equal(received[1].auth,'Bearer fixture-only');
 assert.equal(await post('/v1/schedules/abcd-1234/skip',{expectedNextRun:'fixture'}),200);
 assert.equal(await post('/v1/message-actions',{action:'delete'},{Origin:'https://other.example'}),403);assert.equal(received.length,3);
});
