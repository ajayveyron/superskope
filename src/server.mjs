import { createServer } from 'node:http';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import {createScheduler} from './schedules.mjs';
import {createGroupActions,imageFile} from './group-actions.mjs';
import {createCommands} from './commands.mjs';
import {createInterpreter} from './ai-commands.mjs';

export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createHub({ wahaUrl, wahaKey, apiKey, webhookSecret, dataDir, now=()=>new Date(), schedulerIntervalMs=5000, commandIntervalMs=1000 }) {
  if (![wahaKey, apiKey, webhookSecret].every(v => typeof v === 'string' && v.length >= 32)) throw new Error('Missing or short credentials; run npm run setup.');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, 'hub.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sends (id TEXT PRIMARY KEY, hash TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT);
  `);
  // A request interrupted by a restart may already have reached WhatsApp. Never retry it automatically.
  db.exec("UPDATE sends SET state='unknown' WHERE state='sending'");
  for(const [name,type] of [['chat_id','TEXT'],['message_text','TEXT'],['message_type','TEXT']]){
    if(!db.prepare('PRAGMA table_info(sends)').all().some(c=>c.name===name))db.exec(`ALTER TABLE sends ADD COLUMN ${name} ${type}`);
  }
  for(const row of db.prepare('SELECT id,result FROM sends WHERE chat_id IS NULL AND result IS NOT NULL').all()){
    try{const r=JSON.parse(row.result),document=r.message?.documentMessage;
      db.prepare('UPDATE sends SET chat_id=?,message_text=?,message_type=? WHERE id=?').run(r.key?.remoteJid||r.to||null,document?.fileName||r.message?.extendedTextMessage?.text||r.body||null,document?'pdf':'text',row.id);
    }catch{}
  }
  let stopping=false;
  const failure=(message,status=400,extra={})=>Object.assign(new Error(message),{status,...extra});
  async function waha(path, body, method=body===undefined?'GET':'POST',timeoutMs=30_000) {
    const response = await fetch(`${wahaUrl}${path}`, {
      method,
      headers: { 'X-Api-Key': wahaKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw Object.assign(new Error(`WhatsApp engine returned ${response.status}`), { status: 502 });
    const text=await response.text();return text?JSON.parse(text):null;
  }
  async function media(source) {
    const path=new URL(source).pathname;
    if(!/^\/api\/files\/[A-Za-z0-9_@./%-]+$/.test(path)||decodeURIComponent(path).includes('..'))throw failure('Invalid WhatsApp attachment.');
    const r=await fetch(wahaUrl+path,{headers:{'X-Api-Key':wahaKey},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw failure('Photo unavailable. Attach it again.');
    const chunks=[];let size=0;
    for await(const chunk of r.body){size+=chunk.length;if(size>5*1024*1024)throw failure('Photo must be under 5 MB.');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  function reply(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  }
  async function readBody(req) {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 8 * 1024 * 1024) throw Object.assign(new Error('Body exceeds 8 MB'), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function parse(raw) {
    try { return JSON.parse(raw.toString()); } catch { throw Object.assign(new Error('Invalid JSON'), {status: 400}); }
  }
  async function sendMessage(body,id,canSend=()=>true){
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(id))throw failure('Idempotency-Key required (8–128 letters, digits, _ or -)');
    if(!body||typeof body.chatId!=='string'||!/^\d[\d-]*@g\.us$/.test(body.chatId))throw failure('A group chatId ending in @g.us is required');
    if(!['text','pdf','image'].includes(body.type))throw failure('type must be text, pdf or image');
    if(body.type==='text'&&(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000))throw failure('text must contain 1–4000 characters');
    if(body.type==='pdf'&&(typeof body.data!=='string'||body.data.length>7_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)||!Buffer.from(body.data,'base64').subarray(0,5).equals(Buffer.from('%PDF-'))))throw failure('A base64 PDF under 5 MB is required');
    if(body.type==='pdf'&&(typeof body.filename!=='string'||! /^[\w .-]{1,120}\.pdf$/i.test(body.filename)))throw failure('A valid PDF filename is required');
    if(body.caption!==undefined&&(typeof body.caption!=='string'||body.caption.length>1000))throw failure('Caption must be at most 1,000 characters.');
    const payload=body.type==='text'?{session:'default',chatId:body.chatId,text:body.text}:{session:'default',chatId:body.chatId,file:body.type==='image'?imageFile(body):{mimetype:'application/pdf',filename:body.filename,data:body.data},...(body.caption?{caption:body.caption}:{})};
    const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const previous=db.prepare('SELECT * FROM sends WHERE id=?').get(id);
    if(previous){
      if(previous.hash!==hash)throw failure('Idempotency key belongs to a different message',409);
      if(previous.state!=='sent')throw failure('Delivery is unconfirmed. This key will not send again.',409);
      return {id,state:previous.state,result:previous.result?JSON.parse(previous.result):null,replayed:true};
    }
    let session;try{session=await waha('/api/sessions/default');}catch{throw failure('WhatsApp engine unavailable. Will retry before the 15-minute cutoff.',503,{retryable:true});}
    if(session.status!=='WORKING')throw failure('WhatsApp is not connected. Reconnect to continue.',409,{retryable:true});
    if(stopping||!canSend())throw failure('Schedule paused before sending.',409,{cancelled:true});
    if(db.prepare('SELECT id FROM sends WHERE id=?').get(id))throw failure('This request is already being processed',409);
    const recent=db.prepare('SELECT count(*) AS n FROM sends WHERE created_at > ?').get(new Date(now().getTime()-60_000).toISOString());
    if(recent.n>=10)throw failure('Limit reached: 10 sends per minute',429,{retryable:true});
    db.prepare('INSERT INTO sends (id,hash,state,created_at,result,chat_id,message_text,message_type) VALUES (?,?,?,?,NULL,?,?,?)').run(id,hash,'sending',now().toISOString(),body.chatId,body.text||body.caption||body.filename||'Image',body.type);
    try{
      const result=await waha(body.type==='text'?'/api/sendText':body.type==='image'?'/api/sendImage':'/api/sendFile',payload);
      db.prepare('UPDATE sends SET state=?, result=? WHERE id=?').run('sent',JSON.stringify(result),id);
      return {id,state:'sent',result};
    }catch{
      db.prepare('UPDATE sends SET state=? WHERE id=?').run('unknown',id);
      return {id,state:'unknown',error:'Delivery is unconfirmed. Check WhatsApp before trying again; this key will not resend.'};
    }
  }
  const scheduler=createScheduler({db,send:sendMessage,now,intervalMs:schedulerIntervalMs});
  const groups=createGroupActions({db,waha,now});
  const commands=createCommands({db,groups,waha,send:sendMessage,media,now,intervalMs:commandIntervalMs,interpret:createInterpreter({dataDir})});
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return reply(res, 200, {ok: true});
      if (req.method === 'POST' && url.pathname === '/webhooks/waha') {
        const raw = await readBody(req);
        const signature = createHmac('sha512', webhookSecret).update(raw).digest('hex');
        if (!sameSecret(req.headers['x-webhook-hmac'], signature)) return reply(res, 401, {error: 'Invalid webhook signature'});
        const event = parse(raw);
        if (!event || typeof event.event !== 'string') return reply(res, 400, {error: 'Missing event type'});
        const id = event.id || createHash('sha256').update(raw).digest('hex');
        db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?)').run(id, new Date().toISOString(), event.event, raw.toString());
        commands.enqueue(event);
        return reply(res, 200, {ok: true});
      }
      if (!sameSecret(req.headers.authorization, `Bearer ${apiKey}`)) return reply(res, 401, {error: 'Bearer token required'});
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        const session = await waha('/api/sessions/default');
        return reply(res, 200, {name: session.name, status: session.status, me: session.me});
      }
      if (req.method === 'GET' && url.pathname === '/v1/groups') return reply(res, 200, await waha('/api/default/groups?exclude=participants'));
      if (req.method === 'POST' && url.pathname === '/v1/groups') {
        const result=await groups.create(parse(await readBody(req)),req.headers['idempotency-key']);
        return reply(res,result.state==='completed'?201:502,result);
      }
      if(req.method==='GET'&&url.pathname==='/v1/group-actions')return reply(res,200,groups.history());
      if(req.method==='GET'&&url.pathname==='/v1/commands')return reply(res,200,commands.history());
      if(url.pathname==='/v1/commands/config'){
        if(req.method==='GET')return reply(res,200,commands.config());
        if(req.method==='PUT')return reply(res,200,commands.configure(parse(await readBody(req))));
      }
      const groupPath=url.pathname.match(/^\/v1\/groups\/([^/]+)(\/actions)?$/);
      if(groupPath){
        const id=decodeURIComponent(groupPath[1]);
        if(req.method==='GET'&&!groupPath[2])return reply(res,200,await groups.inspect(id));
        if(req.method==='POST'&&groupPath[2]){
          const result=await groups.execute(id,parse(await readBody(req)),req.headers['idempotency-key']);
          return reply(res,result.state==='completed'?200:502,result);
        }
      }
      if (req.method === 'GET' && url.pathname === '/v1/events') {
        const events = db.prepare('SELECT * FROM events ORDER BY received_at DESC, rowid DESC LIMIT 50').all();
        return reply(res, 200, events.map(row => ({...row, payload: JSON.parse(row.payload)})));
      }
      if (req.method === 'GET' && url.pathname === '/v1/history') {
        const records=db.prepare(`SELECT s.id,s.state,s.created_at AS created_at,s.chat_id,s.message_text,s.message_type,r.schedule_id,r.due_at,r.error,c.name AS schedule_name,c.group_name FROM sends s LEFT JOIN runs r ON r.id=s.id LEFT JOIN schedules c ON c.id=r.schedule_id
          UNION ALL SELECT r.id,r.state,r.started_at,c.chat_id,c.text,'text',r.schedule_id,r.due_at,r.error,c.name,c.group_name FROM runs r LEFT JOIN schedules c ON c.id=r.schedule_id WHERE r.state!='processing' AND NOT EXISTS (SELECT 1 FROM sends s WHERE s.id=r.id) ORDER BY 3 DESC LIMIT 100`).all();
        return reply(res,200,records);
      }
      if (req.method === 'GET' && url.pathname === '/v1/schedules')return reply(res,200,scheduler.list());
      if (req.method === 'POST' && url.pathname === '/v1/schedules'){
        const body=parse(await readBody(req));
        return reply(res,201,scheduler.save(body));
      }
      const schedulePath=url.pathname.match(/^\/v1\/schedules\/([a-f0-9-]+)(?:\/(enabled))?$/);
      if(schedulePath){
        const [,id,action]=schedulePath;
        if(req.method==='PATCH'&&action==='enabled')return reply(res,200,scheduler.toggle(id,parse(await readBody(req))?.enabled));
        if(req.method==='PUT'&&!action)return reply(res,200,scheduler.save(parse(await readBody(req)),id));
        if(req.method==='DELETE'&&!action){scheduler.remove(id);return reply(res,200,{ok:true});}
      }
      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        const result=await sendMessage(parse(await readBody(req)),req.headers['idempotency-key']);
        return reply(res,result.state==='sent'?(result.replayed?200:201):502,result);
      }
      return reply(res, 404, {error: 'Not found'});
    } catch (error) {
      if(!error.status)console.error('Request failed:',error.message);
      reply(res, error.status || 503, {error: error.status ? error.message : 'Service unavailable; retry after checking the local engine.',...(error.retryable?{retryable:true}:{})});
    }
  });
  server.requestTimeout = 45_000;
  server.scheduler=scheduler;
  server.commands=commands;
  server.on('close',async()=>{stopping=true;await Promise.all([scheduler.close(),commands.close()]);db.close();});
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const server = createHub({ wahaUrl: process.env.WAHA_URL || 'http://127.0.0.1:3010', wahaKey: process.env.WAHA_API_KEY, apiKey: process.env.HUB_API_KEY, webhookSecret: process.env.WEBHOOK_SECRET, dataDir: process.env.DATA_DIR || './data' });
  server.listen(3011, process.env.HOST || '127.0.0.1', () => console.log('wa-hub API listening on :3011'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
