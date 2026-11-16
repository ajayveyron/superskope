import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTyping} from '../src/typing.mjs';
const chat='12345@g.us';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('typing refreshes during work and stops without a late refresh restarting it',async()=>{
 const calls=[];let release;
 const start=createTyping({refreshMs:5,minimumMs:0,waha:async(path,body,method,timeout)=>{
  calls.push(path);assert.equal(body.chatId,chat);assert.equal(body.session,'default');assert.equal(method,'POST');assert.equal(timeout,3000);
  if(path==='/api/startTyping'&&calls.length===2)await new Promise(resolve=>{release=resolve;});
 }});
 const typing=await start(chat);
 try{
  await sleep(25);assert.equal(calls.length,2);assert.ok(release);
  const stopping=typing.stop();assert.deepEqual(calls,['/api/startTyping','/api/startTyping']);
  release();await stopping;assert.equal(calls.at(-1),'/api/stopTyping');
  const count=calls.length;await sleep(20);await typing.stop();assert.equal(calls.length,count);
 }finally{release?.();await typing.stop();}
});

test('fast replies wait briefly for visible typing; presence failures do not block replies',async()=>{
 const waits=[],calls=[];
 const typing=await createTyping({waha:async path=>{calls.push(path);},wait:async ms=>{waits.push(ms);}})(chat);
 try{await typing.beforeSend();assert.equal(waits.length,1);assert.ok(waits[0]>0&&waits[0]<=900);}finally{await typing.stop();}
 assert.deepEqual(calls,['/api/startTyping','/api/stopTyping']);
 const unavailable=await createTyping({waha:async()=>{throw Error('Offline');},wait:async()=>{throw Error('Should not delay without typing');}})(chat);
 await unavailable.beforeSend();await unavailable.stop();
});
