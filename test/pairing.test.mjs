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
