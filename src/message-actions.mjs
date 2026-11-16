import {createHash} from 'node:crypto';
import {fail,groupId} from './group-actions.mjs';

export function validMessageId(id,chatId) {
  return typeof id==='string'&&id.length<=512&&/^(true|false)_[\w.@-]+_[\w.@:-]+$/.test(id)&&id.split('_')[1]===chatId;
}
export function sentMessageId(result,chatId) {
  const id=typeof result?.id==='string'?result.id:result?.id?._serialized;
  if(validMessageId(id,chatId))return id;
  if(result?.key?.id&&result.key.remoteJid===chatId){
    const candidate=`${result.key.fromMe!==false}_${chatId}_${result.key.id}`;
    if(validMessageId(candidate,chatId))return candidate;
  }
  return null;
}
export function createMessageActions({db,waha,now=()=>new Date()}) {
  db.exec(`CREATE TABLE IF NOT EXISTS message_actions (
    id TEXT PRIMARY KEY, hash TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL,
    action TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT);
    UPDATE message_actions SET state='unknown' WHERE state='running';`);
  const history=()=>db.prepare('SELECT * FROM message_actions ORDER BY created_at DESC,rowid DESC LIMIT 100').all().map(({hash,...r})=>({...r,result:r.result?JSON.parse(r.result):null}));
  async function execute(body,id){
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(id))throw fail('Idempotency-Key required (8–128 letters, digits, _ or -)');
    if(!groupId(body?.chatId)||!validMessageId(body?.messageId,body.chatId))throw fail('Choose a message belonging to this WhatsApp group.');
    const {chatId,messageId,action}=body,root=`/api/default/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;
    let path=root,method='POST',payload={};
    if(action==='edit'){
      if(!messageId.startsWith('true_'))throw fail('Only messages sent by the linked account can be edited.');
      if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)throw fail('Text must contain 1–4,000 characters.');
      method='PUT';payload={text:body.text};
    }else if(action==='delete'){method='DELETE';payload=undefined;}
    else if(action==='forward'){
      if(!groupId(body.targetChatId))throw fail('Choose a destination group.');
      path='/api/forwardMessage';payload={session:'default',chatId:body.targetChatId,messageId};
    }else if(action==='react'){
      if(typeof body.reaction!=='string'||body.reaction.length>32||(body.reaction!==''&&([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(body.reaction)].length!==1||!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(body.reaction))))throw fail('Choose one emoji, or an empty string to remove your reaction.');
      path='/api/reaction';method='PUT';payload={session:'default',messageId,reaction:body.reaction};
    }else if(action==='pin'){
      if(![1,7,30].includes(body.days??7))throw fail('Pin duration must be 1, 7 or 30 days.');
      path=root+'/pin';payload={duration:(body.days??7)*86400};
    }else if(action==='unpin'){path=root+'/unpin';}
    else throw fail('Choose edit, delete, forward, react, pin or unpin.');
    const hash=createHash('sha256').update(JSON.stringify({chatId,messageId,action,path,method,payload})).digest('hex');
    const previous=db.prepare('SELECT * FROM message_actions WHERE id=?').get(id);
    if(previous){
      if(previous.hash!==hash)throw fail('Idempotency key belongs to another action.',409);
      if(previous.state!=='completed')throw fail('This action was already attempted. Inspect WhatsApp; this key will not run again.',409);
      return {id,state:'completed',result:JSON.parse(previous.result),replayed:true};
    }
    const session=await waha('/api/sessions/default');
    if(session.status!=='WORKING')throw fail('WhatsApp is not connected. Reconnect before trying this action.',409);
    if(db.prepare('SELECT id FROM message_actions WHERE id=?').get(id))throw fail('This action is already processing.',409);
    if(db.prepare('SELECT count(*) AS n FROM message_actions WHERE created_at>?').get(new Date(now().getTime()-60000).toISOString()).n>=10)throw fail('Limit reached: 10 message actions per minute.',429);
    const cutoff=new Date(now().getTime()-60000).toISOString();
    if(action==='forward'&&db.prepare("SELECT (SELECT count(*) FROM sends WHERE created_at>?) + (SELECT count(*) FROM message_actions WHERE action='forward' AND created_at>?) AS n").get(cutoff,cutoff).n>=10)throw fail('Limit reached: 10 sends per minute, including forwarded messages.',429);
    db.prepare('INSERT INTO message_actions VALUES (?,?,?,?,?,?,?,NULL)').run(id,hash,chatId,messageId,action,'running',now().toISOString());
    try{
      const result=await waha(path,payload,method),state=result===false||result?.success===false?'failed':'completed';
      db.prepare('UPDATE message_actions SET state=?,result=? WHERE id=?').run(state,JSON.stringify(result),id);
      return {id,state,result,...(state==='failed'?{error:'WhatsApp did not apply the action. Check message age and group permissions.'}:{})};
    }catch{
      db.prepare("UPDATE message_actions SET state='unknown' WHERE id=?").run(id);
      return {id,state:'unknown',error:'Action unconfirmed. Inspect WhatsApp before another attempt; this action will not be retried.'};
    }
  }
  return {execute,history};
}
