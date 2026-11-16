import { createHash } from 'node:crypto';

export const fail = (message, status=400) => Object.assign(new Error(message), {status});
export const groupId = id => typeof id==='string' && /^\d[\d-]*@g\.us$/.test(id);
export function personId(value) {
  if(typeof value!=='string') return null;
  const id=value.trim().replace(/@s\.whatsapp\.net$/, '@c.us');
  if(/^\d{5,20}@(c\.us|lid)$/.test(id)) return id;
  const phone=id.replace(/[+ ()-]/g,'');
  return /^\d{8,15}$/.test(phone) ? phone+'@c.us' : null;
}
export function identities(person) {
  return [person?.id,person?.phoneNumber,person?.lid].map(personId).filter(Boolean);
}
const isAdmin = p => ['admin','superadmin'].includes(p?.admin||p?.role);
export function imageFile(body) {
  if(typeof body?.data!=='string'||body.data.length>7_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) throw fail('Attach a PNG or JPEG under 5 MB.');
  const b=Buffer.from(body.data,'base64');
  const mime=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':null;
  if(!mime) throw fail('Attach a PNG or JPEG image.');
  return {data:body.data,mimetype:mime,filename:mime==='image/png'?'image.png':'image.jpg'};
}
export function validateAction(body) {
  if(!body||typeof body!=='object') throw fail('An action is required.');
  const {action}=body;
  if(['add','remove','promote','demote'].includes(action)) {
    if(!Array.isArray(body.participants)||!body.participants.length||body.participants.length>20) throw fail('Choose 1–20 members.');
    const participants=body.participants.map(personId);
    if(participants.some(p=>!p)) throw fail('Use a full phone number with country code or a WhatsApp member ID.');
    return {action,participants:[...new Set(participants)]};
  }
  if(['subject','description'].includes(action)) {
    const text=body[action];
    if(typeof text!=='string'||(action==='subject'&&!text.trim())||text.length>(action==='subject'?100:2048)) throw fail(action==='subject'?'Group name must contain 1–100 characters.':'Description must be at most 2,048 characters.');
    return {action,[action]:text};
  }
  if(['messages-admin-only','info-admin-only'].includes(action)) {
    if(typeof body.adminsOnly!=='boolean') throw fail('adminsOnly must be true or false.');
    return {action,adminsOnly:body.adminsOnly};
  }
  if(action==='picture')return {action,...imageFile(body)};
  if(action==='remove-picture')return {action};
  throw fail('Supported actions: add, remove, promote, demote, subject, description, picture, remove-picture, messages-admin-only, info-admin-only.');
}

export function createGroupActions({db,waha,now=()=>new Date()}) {
  db.exec(`CREATE TABLE IF NOT EXISTS group_actions (id TEXT PRIMARY KEY, hash TEXT NOT NULL, group_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT);
    UPDATE group_actions SET state='unknown' WHERE state='running';`);
  async function inspect(id) {
    if(!groupId(id))throw fail('A WhatsApp group ID is required.');
    return waha('/api/default/groups/'+encodeURIComponent(id));
  }
  async function create(body,key) {
    const {subject}=validateAction({action:'subject',subject:body?.subject});
    const participants=(body?.participants||[]).map(personId);
    if(participants.length>20||participants.some(p=>!p))throw fail('Use up to 20 full phone numbers.');
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw fail('An Idempotency-Key is required.');
    const hash=createHash('sha256').update(JSON.stringify({subject,participants})).digest('hex');
    const old=db.prepare('SELECT * FROM group_actions WHERE id=?').get(key);
    if(old){if(old.hash!==hash)throw fail('This key belongs to another group action.',409);return {id:key,state:old.state,...JSON.parse(old.result||'{}'),replayed:true};}
    db.prepare('INSERT INTO group_actions VALUES (?,?,?,?,?,?,?,NULL)').run(key,hash,'','create',null,'running',now().toISOString());
    try{
      const result=await waha('/api/default/groups',{name:subject,participants:participants.map(id=>({id}))});
      db.prepare('UPDATE group_actions SET state=?,group_id=?,result=? WHERE id=?').run('completed',result?.id||'',JSON.stringify({result}),key);
      return {id:key,state:'completed',result};
    }catch{
      const result={error:'Group creation is unconfirmed. Check WhatsApp before creating another group.'};
      db.prepare('UPDATE group_actions SET state=?,result=? WHERE id=?').run('unknown',JSON.stringify(result),key);
      return {id:key,state:'unknown',...result};
    }
  }
  async function execute(id,body,key,actor=null) {
    if(!groupId(id))throw fail('A WhatsApp group ID is required.');
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw fail('An Idempotency-Key is required.');
    const action=validateAction(body);
    const hash=createHash('sha256').update(JSON.stringify({id,action,actor})).digest('hex');
    const replay=()=>{
      const old=db.prepare('SELECT * FROM group_actions WHERE id=?').get(key);
      if(!old)return null;
      if(old.hash!==hash)throw fail('This key belongs to another group action.',409);
      return {id:key,state:old.state,...(old.result?JSON.parse(old.result):{error:'The previous result is unconfirmed. Inspect the group before issuing a new command.'}),replayed:true};
    };
    const previous=replay();if(previous)return previous;
    const session=await waha('/api/sessions/default');
    if(session.status!=='WORKING')throw fail('WhatsApp is not connected.',409);
    const group=await inspect(id),members=group.participants||[],self=identities(session.me);
    const memberFor=ids=>members.find(p=>identities(p).some(i=>ids.includes(i)));
    if(!isAdmin(memberFor(self)))throw fail('Make SuperSkope an admin in this group first.',403);
    if(actor&&!isAdmin(memberFor([personId(actor)])))throw fail('Only an approved operator who is a group admin can issue this command.',403);
    const targets=action.participants?.map(p=>({requested:p,member:memberFor([p])}));
    if(targets?.some(t=>identities(t.member).some(i=>self.includes(i))||self.includes(t.requested)))throw fail('SuperSkope cannot change its own membership or admin role.');
    if(action.action!=='add'&&targets?.some(t=>!t.member))throw fail('A selected person is not in this group. Use their full number or @mention.');
    if(['remove','demote'].includes(action.action)&&targets?.some(t=>(t.member.admin||t.member.role)==='superadmin'))throw fail('The group creator cannot be removed or demoted.');
    const raced=replay();if(raced)return raced;
    if(db.prepare('SELECT count(*) AS n FROM group_actions WHERE created_at>?').get(new Date(now().getTime()-60000).toISOString()).n>=10)throw fail('Group action limit reached. Try again in one minute.',429);
    db.prepare('INSERT INTO group_actions VALUES (?,?,?,?,?,?,?,NULL)').run(key,hash,id,action.action,actor,'running',now().toISOString());
    const root='/api/default/groups/'+encodeURIComponent(id);
    let path,method='PUT',payload;
    if(targets) {path=root+(['promote','demote'].includes(action.action)?'/admin/':'/participants/')+action.action;method='POST';payload={participants:targets.map(t=>({id:t.member?.id||t.requested}))};}
    else if(['subject','description'].includes(action.action)){path=root+'/'+action.action;payload={[action.action]:action[action.action]};}
    else if(action.action==='picture'){path=root+'/picture';payload={file:{data:action.data,mimetype:action.mimetype,filename:action.filename}};}
    else if(action.action==='remove-picture'){path=root+'/picture';method='DELETE';}
    else{path=root+'/settings/security/'+action.action;payload={adminsOnly:action.adminsOnly};}
    try {
      const result=await waha(path,payload,method);
      // Participant APIs can return HTTP 200 with per-person failures.
      const results=Array.isArray(result)?result:[];
      const failures=results.filter(r=>r?.status && !['200','201','204'].includes(String(r.status)));
      const state=result===false||failures.length?'failed':'completed';
      const data=state==='failed'?{result,error:'WhatsApp did not apply every change. Check group permissions and the member’s privacy settings.'}:{result};
      db.prepare('UPDATE group_actions SET state=?,result=? WHERE id=?').run(state,JSON.stringify(data),key);
      return {id:key,state,...data};
    }catch(e){
      const data={error:'The group action could not be confirmed. Inspect the group before issuing a new command.'};
      db.prepare('UPDATE group_actions SET state=?,result=? WHERE id=?').run('unknown',JSON.stringify(data),key);
      return {id:key,state:'unknown',...data};
    }
  }
  return {inspect,create,execute,history:()=>db.prepare('SELECT id,group_id,action,actor,state,created_at,result FROM group_actions ORDER BY created_at DESC,rowid DESC LIMIT 100').all().map(r=>({...r,result:r.result?JSON.parse(r.result):null}))};
}
