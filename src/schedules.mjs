import {randomUUID} from 'node:crypto';
import {localToUtc,nextRun,matchesRecurrence} from './time.mjs';
import {messagePayload} from './messages.mjs';
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
  for(const [name,type] of [['message_type',"TEXT NOT NULL DEFAULT 'text'"],['filename','TEXT'],['attachment_data','TEXT'],['repeat_interval','INTEGER NOT NULL DEFAULT 1'],['weekdays',"TEXT NOT NULL DEFAULT '[]'"],['month_days',"TEXT NOT NULL DEFAULT '[]'"],['end_date','TEXT']]){
    if(!db.prepare('PRAGMA table_info(schedules)').all().some(c=>c.name===name))db.exec(`ALTER TABLE schedules ADD COLUMN ${name} ${type}`);
  }
  // Reconcile a crash after the engine accepted a send but before the schedule advanced.
  for(const run of db.prepare("SELECT * FROM runs WHERE state='processing'").all()){
    const message=db.prepare('SELECT state FROM sends WHERE id=?').get(run.id);
    db.prepare('UPDATE runs SET state=?,finished_at=?,error=? WHERE id=?').run(message?.state==='sent'?'sent':'unknown',now().toISOString(),message?.state==='sent'?null:'Interrupted during delivery. Check WhatsApp before rescheduling.',run.id);
  }
  let running=false,closing=false;
  const publicSchedule=({attachment_data,...s})=>({...s,enabled:!!s.enabled,has_attachment:!!attachment_data,weekdays:JSON.parse(s.weekdays),month_days:JSON.parse(s.month_days)});
  const list=()=>db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all().map(publicSchedule);
  function validate(body,existing){
    if(!body||typeof body!=='object')throw bad('Schedule is required.');
    const {name,chatId,groupName,timezone,startLocal,frequency,enabled=true,interval=1,weekdays=[],monthDays=[],endDate=null,type='text'}=body;
    const text=body.text??'';
    if(typeof name!=='string'||!name.trim()||name.length>100)throw bad('Name must contain 1–100 characters.');
    if(typeof groupName!=='string'||!groupName.trim()||groupName.length>300)throw bad('A group name is required.');
    const data=body.data===undefined&&existing?.message_type===type?existing.attachment_data:body.data;
    const filename=body.filename??(existing?.message_type===type?existing.filename:undefined);
    const payload=messagePayload({type,chatId,text,caption:type==='text'?undefined:text,data,filename});
    if(!['once','daily','weekdays','weekly','monthly'].includes(frequency))throw bad('Choose a supported repeat option.');
    if(!Number.isInteger(interval)||interval<1||interval>365)throw bad('Repeat interval must be 1–365.');
    for(const [values,max,label] of [[weekdays,6,'weekdays'],[monthDays,31,'month dates']]){
      if(!Array.isArray(values)||values.length>max+1||values.some(v=>!Number.isInteger(v)||v<(max===6?0:1)||v>max)||new Set(values).size!==values.length)throw bad('Choose valid '+label+'.');
    }
    if((weekdays.length&&!['daily','weekly'].includes(frequency))||(monthDays.length&&frequency!=='monthly')||(frequency==='once'&&interval!==1))throw bad('Repeat options do not match the selected frequency.');
    if(typeof enabled!=='boolean')throw bad('enabled must be a boolean.');
    if(typeof timezone!=='string'||timezone.length>100)throw bad('Choose a valid time zone.');
    let due;try{due=localToUtc(startLocal,timezone);}catch(e){throw bad(e.message);}
    if(due<=now().toISOString())throw bad('Choose a time in the future.');
    if(endDate!==null){
      if(typeof endDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(endDate))throw bad('Choose a valid end date.');
      try{localToUtc(endDate+'T12:00','UTC');}catch{throw bad('Choose a valid end date.');}
      if(endDate<startLocal.slice(0,10))throw bad('End date must be on or after the first send.');
    }
    const s={name:name.trim(),chat_id:chatId,group_name:groupName.trim(),text,timezone,start_local:startLocal,frequency,next_run:due,enabled:enabled?1:0,
      message_type:type,filename:payload.file?.filename||null,attachment_data:payload.file?.data||null,repeat_interval:interval,weekdays:JSON.stringify(weekdays),month_days:JSON.stringify(monthDays),end_date:endDate};
    if(frequency!=='once'&&!matchesRecurrence(s,new Date(startLocal.slice(0,10)+'T00:00:00Z')))throw bad('The first send must fall on a selected repeat day.');
    return s;
  }
  function save(body,id){
    const existing=id?db.prepare('SELECT * FROM schedules WHERE id=?').get(id):null;
    if(id&&!existing)throw Object.assign(new Error('Schedule not found.'),{status:404});
    if(id&&db.prepare("SELECT id FROM runs WHERE schedule_id=? AND state='processing'").get(id))throw Object.assign(new Error('A message is sending. Wait for it to finish before editing.'),{status:409});
    const s=validate(body,existing),timestamp=now().toISOString();
    if(id){
      db.prepare(`UPDATE schedules SET ${Object.keys(s).map(k=>k+'=?').join(',')},updated_at=?,last_error=NULL WHERE id=?`).run(...Object.values(s),timestamp,id);
    }else{
      id=randomUUID();
      db.prepare(`INSERT INTO schedules (id,${Object.keys(s).join(',')},created_at,updated_at) VALUES (${Array(Object.keys(s).length+3).fill('?').join(',')})`).run(id,...Object.values(s),timestamp,timestamp);
    }
    return publicSchedule(db.prepare('SELECT * FROM schedules WHERE id=?').get(id));
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
    if(enabled&&!due)throw bad('This schedule has ended. Edit its dates before resuming.');
    db.prepare('UPDATE schedules SET enabled=?,next_run=?,updated_at=?,last_error=NULL WHERE id=?').run(enabled?1:0,due,now().toISOString(),id);
    return list().find(s=>s.id===id);
  }
  function remove(id){
    if(db.prepare("SELECT id FROM runs WHERE schedule_id=? AND state='processing'").get(id))throw Object.assign(new Error('A message is sending. Pause it and wait before deleting.'),{status:409});
    db.prepare('DELETE FROM schedules WHERE id=?').run(id);
  }
  function skip(id,expectedNextRun){
    const s=db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
    if(!s)throw Object.assign(new Error('Schedule not found.'),{status:404});
    if(!s.next_run||expectedNextRun!==s.next_run)throw Object.assign(new Error('The next occurrence changed. Refresh before skipping.'),{status:409});
    if(db.prepare("SELECT id FROM runs WHERE schedule_id=? AND state='processing'").get(id))throw Object.assign(new Error('A message is sending. Wait for it to finish.'),{status:409});
    const timestamp=now().toISOString(),runId=`schedule-${id}-${Date.parse(s.next_run)}`,next=nextRun(s,s.next_run);
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("INSERT INTO runs VALUES (?,?,?,?,?,'skipped',?)").run(runId,id,s.next_run,timestamp,timestamp,'Skipped by operator.');
      db.prepare('UPDATE schedules SET next_run=?,enabled=CASE WHEN ? IS NULL THEN 0 ELSE enabled END,updated_at=?,last_error=NULL WHERE id=?').run(next,next,timestamp,id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return publicSchedule(db.prepare('SELECT * FROM schedules WHERE id=?').get(id));
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
          const result=await send({type:s.message_type,chatId:s.chat_id,text:s.text,caption:s.message_type==='text'?undefined:s.text,filename:s.filename,data:s.attachment_data},run.id,()=>!closing&&db.prepare('SELECT enabled FROM schedules WHERE id=?').get(s.id)?.enabled===1);
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
  return {list,save,toggle,remove,skip,tick,close:async()=>{closing=true;clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,25));}};
}
