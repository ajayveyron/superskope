import {randomUUID} from 'node:crypto';
import {localToUtc,nextRun} from './time.mjs';
const bad=message=>Object.assign(new Error(message),{status:400});
export function createScheduler({db,send,now=()=>new Date(),intervalMs=5000}){
  db.exec(`CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, chat_id TEXT NOT NULL, group_name TEXT NOT NULL, text TEXT NOT NULL,
    timezone TEXT NOT NULL,start_local TEXT NOT NULL,frequency TEXT NOT NULL,next_run TEXT,
    enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT);
    CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL,due_at TEXT NOT NULL,started_at TEXT NOT NULL,
    finished_at TEXT,state TEXT NOT NULL,error TEXT,UNIQUE(schedule_id,due_at));
    CREATE INDEX IF NOT EXISTS schedules_due ON schedules(enabled,next_run);
    CREATE INDEX IF NOT EXISTS runs_schedule ON runs(schedule_id,due_at);`);
  // Reconcile a crash after the engine accepted a send but before the schedule advanced.
  for(const run of db.prepare("SELECT * FROM runs WHERE state='processing'").all()){
    const message=db.prepare('SELECT state FROM sends WHERE id=?').get(run.id);
    db.prepare('UPDATE runs SET state=?,finished_at=?,error=? WHERE id=?').run(message?.state==='sent'?'sent':'unknown',now().toISOString(),message?.state==='sent'?null:'Interrupted during delivery. Check WhatsApp before rescheduling.',run.id);
  }
  let running=false,closing=false;
  const list=()=>db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all().map(s=>({...s,enabled:!!s.enabled}));
  function validate(body){
    if(!body||typeof body!=='object')throw bad('Schedule is required.');
    const {name,chatId,groupName,text,timezone,startLocal,frequency,enabled=true}=body;
    if(typeof name!=='string'||!name.trim()||name.length>100)throw bad('Name must contain 1–100 characters.');
    if(typeof chatId!=='string'||!/^\d[\d-]*@g\.us$/.test(chatId))throw bad('Choose a WhatsApp group.');
    if(typeof groupName!=='string'||!groupName.trim()||groupName.length>300)throw bad('A group name is required.');
    if(typeof text!=='string'||!text.trim()||text.length>4000)throw bad('Message must contain 1–4000 characters.');
    if(!['once','daily','weekdays','weekly'].includes(frequency))throw bad('Choose a supported repeat option.');
    if(typeof enabled!=='boolean')throw bad('enabled must be a boolean.');
    if(typeof timezone!=='string'||timezone.length>100)throw bad('Choose a valid time zone.');
    let due;try{due=localToUtc(startLocal,timezone);}catch(e){throw bad(e.message);}
    if(due<=now().toISOString())throw bad('Choose a time in the future.');
    if(frequency==='weekdays'&&[0,6].includes(new Date(startLocal.slice(0,10)+'T12:00:00Z').getUTCDay()))throw bad('Choose a weekday for the first message.');
    return {name:name.trim(),chat_id:chatId,group_name:groupName.trim(),text,timezone,start_local:startLocal,frequency,next_run:due,enabled:enabled?1:0};
  }
  function save(body,id){
    const s=validate(body),timestamp=now().toISOString();
    if(id){
      if(!db.prepare('SELECT id FROM schedules WHERE id=?').get(id))throw Object.assign(new Error('Schedule not found.'),{status:404});
      if(db.prepare("SELECT id FROM runs WHERE schedule_id=? AND state='processing'").get(id))throw Object.assign(new Error('A message is sending. Wait for it to finish before editing.'),{status:409});
      db.prepare('UPDATE schedules SET name=?,chat_id=?,group_name=?,text=?,timezone=?,start_local=?,frequency=?,next_run=?,enabled=?,updated_at=?,last_error=NULL WHERE id=?').run(...Object.values(s),timestamp,id);
    }else{
      id=randomUUID();db.prepare('INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)').run(id,...Object.values(s),timestamp,timestamp);
    }
    return list().find(s=>s.id===id);
  }
  function toggle(id,enabled){
    if(typeof enabled!=='boolean')throw bad('enabled must be a boolean.');
    const s=db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
    if(!s)throw Object.assign(new Error('Schedule not found.'),{status:404});
    let due=s.next_run;
    if(enabled&&(!due||due<=now().toISOString())){
      if(s.frequency==='once')throw bad('Edit this one-off schedule and choose a future time.');
      due=nextRun(s,now().toISOString());
    }
    db.prepare('UPDATE schedules SET enabled=?,next_run=?,updated_at=?,last_error=NULL WHERE id=?').run(enabled?1:0,due,now().toISOString(),id);
    return list().find(s=>s.id===id);
  }
  function remove(id){
    if(db.prepare("SELECT id FROM runs WHERE schedule_id=? AND state='processing'").get(id))throw Object.assign(new Error('A message is sending. Pause it and wait before deleting.'),{status:409});
    db.prepare('DELETE FROM schedules WHERE id=?').run(id);
  }
  function finish(schedule,run,state,error){
    const timestamp=now().toISOString();
    const next=nextRun(schedule,timestamp>run.due_at?timestamp:run.due_at);
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('UPDATE runs SET state=?,error=?,finished_at=? WHERE id=?').run(state,error||null,timestamp,run.id);
      // A pause requested during an upstream request must remain paused.
      db.prepare('UPDATE schedules SET next_run=?,enabled=CASE WHEN ? IS NULL THEN 0 ELSE enabled END,last_error=? WHERE id=? AND next_run=?').run(next,next,error||null,schedule.id,run.due_at);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  async function tick(){
    if(running||closing)return;running=true;
    try{
      for(const s of db.prepare('SELECT * FROM schedules WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 25').all(now().toISOString())){
        if(closing)break;
        const run={id:`schedule-${s.id}-${Date.parse(s.next_run)}`,due_at:s.next_run};
        const previous=db.prepare('SELECT * FROM runs WHERE id=?').get(run.id);
        if(previous){finish(s,run,previous.state,previous.error);continue;}
        db.prepare('INSERT INTO runs VALUES (?,?,?,?,NULL,?,NULL)').run(run.id,s.id,run.due_at,now().toISOString(),'processing');
        if(now().getTime()-Date.parse(run.due_at)>15*60_000){finish(s,run,'skipped','More than 15 minutes late. Skipped to avoid sending an outdated message.');continue;}
        try{
          const result=await send({type:'text',chatId:s.chat_id,text:s.text},run.id,()=>!closing&&db.prepare('SELECT enabled FROM schedules WHERE id=?').get(s.id)?.enabled===1);
          finish(s,run,result.state,result.state==='sent'?null:'Delivery unconfirmed. Check WhatsApp before rescheduling.');
        }catch(e){
          // Only errors before handing a message to WhatsApp are safe to retry.
          if(e.retryable){db.prepare('DELETE FROM runs WHERE id=?').run(run.id);db.prepare('UPDATE schedules SET last_error=? WHERE id=?').run(e.message,s.id);}
          else finish(s,run,e.cancelled?'skipped':'failed',e.message);
        }
      }
    }finally{running=false;}
  }
  const timer=intervalMs?setInterval(()=>tick().catch(e=>console.error('Scheduler:',e.message)),intervalMs):null;timer?.unref();
  return {list,save,toggle,remove,tick,close:async()=>{closing=true;clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,25));}};
}
