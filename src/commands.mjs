import { createHash } from 'node:crypto';
import { fail, groupId, identities, personId, imageFile } from './group-actions.mjs';
import { createInterpreter, completedMessage } from './ai-commands.mjs';
import { createTyping } from './typing.mjs';

export const adminOnlyReply = 'Only group admins can use SuperSkope right now. Please ask a group admin to make you an admin, then try again.';

export function messageContext(payload) {
  let message=payload?._data?.message||{};
  for(let i=0;i<4;i++) {
    const wrapper=message.ephemeralMessage||message.viewOnceMessage||message.viewOnceMessageV2||message.documentWithCaptionMessage;
    if(!wrapper?.message)break;message=wrapper.message;
  }
  const content=message.extendedTextMessage||message.imageMessage||message.documentMessage||message.videoMessage||{};
  const context=content.contextInfo||{};
  const mentions=[...(Array.isArray(payload?.mentionedIds)?payload.mentionedIds:[]),...(Array.isArray(context.mentionedJid)?context.mentionedJid:[])].map(personId).filter(Boolean);
  return {mentions:[...new Set(mentions)],forwarded:context.isForwarded===true,text:payload?.body||content.caption||message.conversation||'',context};
}
export function createCommands({db,groups,waha,send,media,now=()=>new Date(),intervalMs=1000,interpret=createInterpreter(),startTyping=createTyping({waha})}) {
  db.exec(`CREATE TABLE IF NOT EXISTS command_config (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL);
    INSERT OR IGNORE INTO command_config VALUES (1,0);
    CREATE TABLE IF NOT EXISTS command_context (group_id TEXT NOT NULL, actor TEXT NOT NULL, expires_at TEXT NOT NULL, turns TEXT NOT NULL, PRIMARY KEY(group_id,actor));
    CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, result TEXT);
    UPDATE commands SET state='unknown',result='{"error":"Interrupted. Inspect the group before sending another command."}' WHERE state='processing';`);
  let running=false,closed=false;
  const config=()=>({enabled:!!db.prepare('SELECT enabled FROM command_config WHERE id=1').get().enabled,policy:'group-admins',selfPrefix:'SuperSkope',...interpret.info?.()});
  function configure(body){if(typeof body?.enabled!=='boolean')throw fail('enabled must be true or false.');db.prepare('UPDATE command_config SET enabled=? WHERE id=1').run(Number(body.enabled));return config();}
  function enqueue(event) {
    if(!config().enabled||!['message','message.any'].includes(event.event)||event.session!=='default')return;
    const p=event.payload;if(!p||typeof p.id!=='string'||p.source==='api')return;
    const chatId=p.fromMe?p.to:p.from;if(!groupId(chatId))return;
    const age=now().getTime()-Number(p.timestamp)*1000;
    if(!Number.isFinite(age)||age>300000||age< -60000)return;
    const ctx=messageContext(p),self=identities(event.me);
    if(ctx.forwarded||!self.length)return;
    const mentioned=ctx.mentions.some(id=>self.includes(id));
    const ownPrefix=p.fromMe===true&&p.source==='app'&&/^@?superskope\b/i.test(ctx.text.trim());
    if(!mentioned&&!ownPrefix)return;
    const id=createHash('sha256').update('default:'+p.id).digest('hex');
    db.prepare('INSERT OR IGNORE INTO commands VALUES (?,?,?,?,?,NULL)').run(id,chatId,'queued',now().toISOString(),JSON.stringify(event));
  }
  async function photo(p,chatId) {
    let attachment=p;
    if(!attachment.media?.url&&p.replyTo?.id)attachment=await waha(`/api/default/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(p.replyTo.id)}?downloadMedia=true`);
    const url=attachment.media?.url||attachment.mediaUrl;
    if(typeof url!=='string')throw fail('Attach a PNG/JPEG with this command, or reply to the photo.');
    return imageFile({data:(await media(url)).toString('base64')});
  }
  async function tick() {
    if(running||closed||!config().enabled)return;
    const row=db.prepare("SELECT * FROM commands WHERE state='queued' ORDER BY created_at,rowid LIMIT 1").get();if(!row)return;
    running=true;let authorized=false,typing;
    async function respond(text){await typing?.beforeSend();return send({type:'text',chatId:row.group_id,text:'SuperSkope: '+text},'reply-'+row.id);}
    try {
      db.prepare("UPDATE commands SET state='processing' WHERE id=?").run(row.id);
      if(now().getTime()-Date.parse(row.created_at)>300000)throw fail('Command expired. Send it again if it is still needed.');
      const event=JSON.parse(row.payload),p=event.payload;
      const session=await waha('/api/sessions/default'),self=identities(session.me);
      // A queued event from a previously linked number cannot operate the new account.
      if(!identities(event.me).some(id=>self.includes(id)))throw fail('Linked number changed. Send the command again.');
      const group=await groups.inspect(row.group_id);
      const actor=p.fromMe?personId(session.me.id):personId(p.participant||p.author||p._data?.key?.participant);
      const member=(group.participants||[]).find(m=>identities(m).includes(actor));
      if(member)typing=await startTyping(row.group_id);
      if(!actor||!['admin','superadmin'].includes(member?.admin||member?.role)) {
        db.prepare("UPDATE commands SET state='rejected',result=? WHERE id=?").run(JSON.stringify({error:'Sender is not a group admin.',...(member?{message:adminOnlyReply}:{})}),row.id);
        if(member)await respond(adminOnlyReply);
        return;
      }
      authorized=true;
      const contextActor=personId(member.id),ctx=messageContext(p);
      const pending=db.prepare('SELECT turns FROM command_context WHERE group_id=? AND actor=? AND expires_at>?').get(row.group_id,contextActor,now().toISOString());
      const previous=pending?JSON.parse(pending.turns):[];
      if(db.prepare("SELECT count(*) AS n FROM commands WHERE state!='rejected' AND created_at>?").get(new Date(now().getTime()-60000).toISOString()).n>10)throw fail('I have several requests to process. Please try again in a minute.',429);
      // Resolve only members of this group against WhatsApp's local contact store.
      // No unrelated chats or contact list is sent to the language model.
      const contacts=await waha('/api/contacts/all?session=default&limit=5000').catch(()=>[]);
      const plan=await interpret({text:ctx.text,mentions:ctx.mentions,selfIds:self,group,contacts:Array.isArray(contacts)?contacts:[],hasPhoto:!!(p.media?.url||p.hasMedia||p.replyTo?.id),previous});
      if(plan.intent==='clarify'){
        const turns=[...previous,{role:'user',text:ctx.text},{role:'assistant',text:plan.message}].slice(-6);
        db.prepare('INSERT INTO command_context VALUES (?,?,?,?) ON CONFLICT(group_id,actor) DO UPDATE SET expires_at=excluded.expires_at,turns=excluded.turns').run(row.group_id,contextActor,new Date(now().getTime()+600000).toISOString(),JSON.stringify(turns));
      }else db.prepare('DELETE FROM command_context WHERE group_id=? AND actor=?').run(row.group_id,contextActor);
      const actions=[];
      for(const action of plan.actions)actions.push(action.action==='picture'?{...action,...await photo(p,row.group_id)}:action);
      const audit={model:plan.model,usage:plan.usage,plan:actions.map(({data,...action})=>action),results:[]};
      db.prepare('UPDATE commands SET result=? WHERE id=?').run(JSON.stringify(audit),row.id);
      let state=plan.intent==='clarify'?'clarification':'completed',reply=plan.message;
      for(let i=0;i<actions.length;i++){
        let result;
        try{result=await groups.execute(row.group_id,actions[i],'cmd-'+row.id+'-'+i,actor);}catch(e){result={state:'failed',error:e.status?e.message:'That change could not be confirmed. Check the group before asking again.'};}
        audit.results.push(result);
        db.prepare('UPDATE commands SET result=? WHERE id=?').run(JSON.stringify(audit),row.id);
        if(result.state!=='completed'){
          state=result.state;
          reply=actions.slice(0,i).map(completedMessage).concat(result.error||'That change could not be confirmed. Check the group before asking again.',i+1<actions.length?'I stopped before the remaining changes.':'').filter(Boolean).join('\n');
          break;
        }
        reply=actions.slice(0,i+1).map(completedMessage).join('\n');
      }
      db.prepare('UPDATE commands SET state=?,result=? WHERE id=?').run(state,JSON.stringify({...audit,message:reply}),row.id);
      await respond(reply);
    } catch(e) {
      db.prepare("UPDATE commands SET state='failed',result=? WHERE id=? AND state='processing'").run(JSON.stringify({error:e.message}),row.id);
      // Only an authorized sender reaches AI interpretation; never echo arbitrary provider errors.
      if(authorized&&e.status)await respond(e.message).catch(()=>{});
    } finally {try{await typing?.stop();}finally{running=false;}}
  }
  const timer=intervalMs?setInterval(()=>void tick().catch(e=>console.error('Command worker:',e.message)),intervalMs):null;timer?.unref();
  return {enqueue,tick,config,configure,history:()=>db.prepare('SELECT id,group_id,state,created_at,result FROM commands ORDER BY created_at DESC,rowid DESC LIMIT 100').all().map(r=>({...r,result:r.result?JSON.parse(r.result):null})),close:async()=>{closed=true;clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,10));}};
}
