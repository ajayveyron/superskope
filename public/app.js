const $=id=>document.getElementById(id);
const state={schedules:[],history:[],groups:[],editing:null,route:'dashboard',deleteId:null,busy:false,schedulePage:1,historyPage:1,connected:false,scheduleScope:'upcoming',scheduleSort:'earliest',phone:null,advanced:false,messageActions:false};
const frequencyNames={once:'Once',daily:'Every day',weekdays:'Weekdays',weekly:'Every week',monthly:'Every month'};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 256 256');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.dataset.phosphor=name;svg.innerHTML=phosphorIcons[name]||phosphorIcons.clock;return svg;}
for(const el of document.querySelectorAll('[data-icon]'))el.replaceChildren(icon(el.dataset.icon));
document.querySelector('.schedule-heading').append($('new-schedule'));document.querySelector('#schedules-section .records-toolbar').append(document.querySelector('.schedule-scope'));
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const navGroups=[
 [['dashboard','Dashboard','home']],
 [['chats','Chats','chat'],['calls','Calls','phone'],['tickets','Tickets','ticket'],['analytics','Analytics','chart']],
 [['list','Chat List','list'],['broadcast','Bulk Messages','megaphone']],
 [['contacts','Contacts','contacts'],['media','Media','media']],
 [['ai','AI','sparkles'],['rules','Automation Rules','rules']],
 [['logs','Logs','logs'],['settings','Settings','settings']]
];
const mainRoutes=navGroups.flat();
const logRoutes=[['logs/groups','Group logs','chat'],['logs/apis','API logs','link'],['logs/webhooks','Webhooks logs','link'],['logs/rules','Rules logs','rules'],['logs/scheduled','Scheduled logs','clock']];
const settingsGroups=[
 ['Plans and Usage',[['settings/billing','Manage Plans','list']]],
 ['User',[['settings/preferences','Preferences','users'],['settings/scheduled','Scheduled Messages','clock'],['settings/notifications','Alerts & Notifications','bell']]],
 ['Organization',[['settings/general','General','home'],['settings/config','Config','settings'],['settings/permissions','Permissions','users'],['settings/phones','Phones','phone'],['settings/team','Team','users'],['settings/labels','Labels','ticket'],['settings/tickets','Tickets','ticket'],['settings/replies','Quick Replies','chat'],['settings/properties','Custom Properties','list'],['settings/library','Media Library','media'],['settings/groups','Group Settings','users']]],
 ['Integrations',[['settings/integrations/api','API','link'],['settings/integrations/webhooks','Webhooks','link'],['settings/integrations/mcp','MCP','link'],['settings/integrations/zapier','Zapier','link'],['settings/integrations/gsheets','Google Sheets','list'],['settings/integrations/gcalendar','Google Calendar','clock'],['settings/integrations/hubspot','HubSpot','link'],['settings/integrations/freshdesk','Freshdesk','link'],['settings/integrations/zohodesk','ZohoDesk','link'],['settings/integrations/zohocrm','Zoho CRM','link']]]
];
const settingsRoutes=settingsGroups.flatMap(g=>g[1]);
const allRoutes=[...mainRoutes,...logRoutes,...settingsRoutes];
function routeLink([route,label,glyph]){const a=node('a',undefined,'nav-item');a.href='#'+route;a.dataset.route=route;a.title=label;a.append(icon(glyph),node('span',label,'nav-label'));return a;}
for(const group of navGroups){const container=node('div',undefined,'nav-group');group.forEach(item=>container.append(routeLink(item)));$('main-navigation').append(container);}
const descriptions={chats:'A shared inbox for WhatsApp conversations.',calls:'Make and receive WhatsApp calls from your workspace.',tickets:'Track requests and follow up with your team.',analytics:'Measure response times and conversation activity.',list:'Organize and manage your WhatsApp chats.',broadcast:'Send bulk messages across selected chats.',contacts:'Manage your WhatsApp contacts in one place.',media:'Find files and media shared across conversations.',ai:'Ask questions and get help across your workspace.',rules:'Automate your WhatsApp workflows.'};
function error(id,message){$(id).textContent=message||'';$(id).hidden=!message;}
function notice(message){$('notice').textContent=message;$('notice').hidden=false;}
function info(title,copy='Coming soon. This feature is not available in SuperSkope yet.'){$('info-title').textContent=title;$('info-copy').textContent=copy;if(!$('info-dialog').open)$('info-dialog').showModal();}
async function api(path,{method='GET',body,headers={}}={}){const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Request failed. Please retry.'),{status:response.status,outcome:data.state});return data;}
function currentRoute(){return location.pathname==='/connect'?'settings/phones':location.hash.slice(1)||'dashboard';}
function navigate(route){history.pushState({},'',route==='settings/phones'?'/connect':'/#'+route);showView(route);}
function showView(route){
  if(route==='logs')route='logs/groups';if(route==='settings')route='settings/preferences';if(route==='logs/history')route='logs/apis';
  state.route=route;$('notice').hidden=true;error('page-error');$('filter-panel').hidden=true;$('filter-toggle').setAttribute('aria-expanded','false');
  const group=route.split('/')[0],entry=allRoutes.find(r=>r[0]===route)||mainRoutes.find(r=>r[0]===group)||['dashboard','Dashboard','home'];
  document.querySelectorAll('#main-navigation [data-route]').forEach(a=>{if(a.dataset.route===group)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const subRoutes=group==='logs'?logRoutes:group==='settings'?settingsRoutes:[];$('subnav').hidden=!subRoutes.length;$('subnav').classList.toggle('settings-subnav',group==='settings');$('subnav').replaceChildren();
  const addSub=item=>{const a=routeLink(item);if(item[0]===route)a.setAttribute('aria-current','page');$('subnav').append(a);};
  if(group==='settings')for(const [title,items] of settingsGroups){$('subnav').append(node('h2',title));items.forEach(addSub);}else subRoutes.forEach(addSub);
  $('main-content').classList.toggle('settings-view',group==='settings');
  $('page-title').textContent=group==='list'?'chat list':group==='broadcast'?'bulk messages':group==='rules'?'automation rules':group;
  $('breadcrumb-icon').replaceChildren(icon(mainRoutes.find(r=>r[0]===group)?.[2]||'home'));
  $('breadcrumb-detail').textContent=route.includes('/')?(route==='settings/phones'?'phones':route.split('/').slice(1).join(' › ')):'';
  document.title=entry[1]+' · SuperSkope';
  for(const id of ['dashboard-section','coming-section','schedules-section','history-section','connection-section','chats-section','preferences-section','api-section'])$(id).hidden=true;
  if(route==='dashboard')$('dashboard-section').hidden=false;
  else if(route==='settings/scheduled'){$('schedules-section').hidden=false;loadSchedules();}
  else if(route==='logs/apis'||route==='logs/scheduled'){$('history-section').hidden=false;$('history-label').textContent=route==='logs/scheduled'?'Scheduled send history':'Send history';loadHistory();}
  else if(route==='settings/phones'){$('connection-section').hidden=false;refreshConnection();}
  else if(route==='chats'){$('chats-section').hidden=false;}
  else if(route==='settings/preferences'){$('preferences-section').hidden=false;syncPreferences();}
  else if(route==='settings/integrations/api'){$('api-section').hidden=false;}
  else {$('coming-section').hidden=false;$('coming-title').textContent=entry[1];$('coming-icon').replaceChildren(icon(entry[2]));$('coming-detail').textContent=descriptions[group]||'This part of the workspace is being built.';}
}
document.addEventListener('click',event=>{const link=event.target.closest('a');if(link&&(link.getAttribute('href')?.startsWith('#')||link.getAttribute('href')==='/connect')&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate(link.getAttribute('href')==='/connect'?'settings/phones':link.hash.slice(1));if($('search-dialog').open)$('search-dialog').close();}const pending=event.target.closest('[data-pending]');if(pending)info(pending.dataset.pending);});
window.addEventListener('popstate',()=>showView(currentRoute()));window.addEventListener('hashchange',()=>showView(currentRoute()));
function stored(key,fallback){try{return localStorage.getItem(key)||fallback;}catch{return fallback;}}
function remember(key,value){try{localStorage.setItem(key,value);}catch{}}
function setTheme(theme){document.documentElement.dataset.theme=theme;$('theme-label').textContent=theme==='dark'?'Dark':'Light';$('theme-toggle').title='Switch to '+(theme==='dark'?'light':'dark')+' theme';$('theme-toggle').firstElementChild.replaceChildren(icon(theme==='dark'?'sun':'moon'));remember('wa-hub-theme',theme);syncPreferences();}
setTheme(stored('wa-hub-theme','dark'));
$('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
function collapse(value){$('app-shell').classList.toggle('sidebar-collapsed',value);$('collapse-sidebar').setAttribute('aria-expanded',String(!value));$('collapse-sidebar').title=value?'Expand sidebar':'Collapse sidebar';remember('wa-hub-collapsed',String(value));syncPreferences();}
collapse(stored('wa-hub-collapsed','false')==='true');$('collapse-sidebar').addEventListener('click',()=>collapse(!$('app-shell').classList.contains('sidebar-collapsed')));
$('profile-button').addEventListener('click',()=>navigate('settings/preferences'));
$('workspace-switcher').addEventListener('click',()=>info('SuperSkope','Local workspace on this Mac. Multiple workspaces are coming soon.'));
$('help-button').addEventListener('click',()=>info('SuperSkope help','Schedule messages under Settings → Scheduled Messages. Send history is under Logs → API logs. Link or refresh WhatsApp under Settings → Phones. Other modules are coming soon.'));
$('close-info').addEventListener('click',()=>$('info-dialog').close());
const quickLinks=[['Bulk messages','Send or schedule customized bulk messages','megaphone','broadcast'],['Manage team','Add team members and manage access to chats','users','settings/team'],['Add phones','Manage your WhatsApp connection','phone','settings/phones'],['Manage tickets','Track requests from your WhatsApp messages','ticket','tickets'],['Integrate your tools','Connect your workspace to other services','link','settings/integrations/api'],['APIs & Webhooks','Build custom automations with the hub API','link','settings/integrations/api']];
for(const [title,description,glyph,route] of quickLinks){const block=node('div',undefined,'quick-link');const h=node('h3');h.append(icon(glyph),node('span',title));const a=node('a',route==='settings/phones'?'Manage phone':'Open','button');a.href='#'+route;a.append(icon('arrow-right'));block.append(h,node('p',description),a);$('quick-links').append(block);}
function showSearch(){$('command-search').value='';renderCommands();$('search-dialog').showModal();$('command-search').focus();}
function renderCommands(){const q=$('command-search').value.toLocaleLowerCase();const entries=allRoutes.filter(r=>r[1].toLocaleLowerCase().includes(q));$('command-results').replaceChildren(...entries.map(([route,label,glyph])=>{const a=node('a');a.href='#'+route;a.append(icon(glyph),node('span',label));if(!['dashboard','settings/scheduled','logs/apis','logs/scheduled','settings','settings/phones','settings/preferences','settings/integrations/api'].includes(route))a.append(node('span','Coming soon'));return a;}));if(!entries.length)$('command-results').append(node('p','No matching pages. Try “scheduled” or “phones”.','muted'));}
$('global-search').addEventListener('click',showSearch);$('close-search').addEventListener('click',()=>$('search-dialog').close());$('command-search').addEventListener('input',renderCommands);
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){event.preventDefault();showSearch();}});
function formatTime(date,zone,includeZone=false){return new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',...(includeZone?{timeZoneName:'short'}:{})}).format(new Date(date));}
function action(label,glyph,fn){const b=node('button',undefined,'icon-button quiet');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.append(icon(glyph));b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){error('page-error',e.message);}finally{b.disabled=false;}});return b;}
function groupCell(id,name){const td=node('td');const wrap=node('div',undefined,'group-cell');const avatar=node('span',undefined,'group-avatar');avatar.append(icon('users'));const label=name||state.groups.find(g=>g.id===id)?.name||id||'–';const text=node('span',label,'group-name');text.title=label;wrap.append(avatar,text);td.append(wrap);return td;}
function pageItems(items,kind){const pageKey=kind+'Page';const pages=Math.max(1,Math.ceil(items.length/25));state[pageKey]=Math.min(Math.max(1,state[pageKey]),pages);const start=(state[pageKey]-1)*25;$(kind+'-page').textContent=`${state[pageKey]} of ${pages}`;$(kind+'-count').textContent=items.length?`${start+1} to ${Math.min(start+25,items.length)} of ${items.length} rows`:'0 rows';$(kind+'-previous').disabled=state[pageKey]===1;$(kind+'-next').disabled=state[pageKey]===pages;return items.slice(start,start+25);}
function scheduleStatus(s){return s.enabled&&s.next_run?'active':s.next_run?'paused':'finished';}
function renderSchedules(){
 const query=$('schedule-search').value.toLocaleLowerCase(),status=$('status-filter').value,repeat=$('repeat-filter').value;
 const filtered=state.schedules.filter(s=>(s.name+' '+s.text+' '+s.group_name).toLocaleLowerCase().includes(query)&&(status==='all'||scheduleStatus(s)===status)&&(state.scheduleScope==='all'||(state.scheduleScope==='completed'?!s.next_run:!!s.next_run))&&(repeat==='all'||(repeat==='once'?s.frequency==='once':s.frequency!=='once'))).sort((a,b)=>state.scheduleSort==='name'?a.name.localeCompare(b.name):(state.scheduleSort==='latest'?-1:1)*((Date.parse(a.next_run)||Infinity)-(Date.parse(b.next_run)||Infinity)));
 for(const b of document.querySelectorAll('[data-scope]'))b.setAttribute('aria-pressed',String(b.dataset.scope===state.scheduleScope));
 $('filter-count').hidden=status==='all'&&repeat==='all';$('filter-count').textContent=String(Number(status!=='all')+Number(repeat!=='all'));
 const rows=$('schedule-rows');rows.replaceChildren();$('empty').hidden=state.schedules.length>0;$('no-results').hidden=!state.schedules.length||filtered.length>0;$('schedule-table').hidden=false;
 for(const s of pageItems(filtered,'schedule')){
  const tr=node('tr'),message=node('td');const title=node('div',s.name,'row-title');title.title=s.name;const preview=node('p',[s.filename,s.text].filter(Boolean).join(' · '),'row-preview');preview.title=preview.textContent;message.append(title,preview);if(s.last_error)message.append(node('p',s.last_error,'error'));
  const when=node('td');when.append(node('div',s.next_run?formatTime(s.next_run,s.timezone):'–','date'),node('p',s.timezone,'row-subtitle'));
  const status=scheduleStatus(s),statusCell=node('td',status[0].toUpperCase()+status.slice(1),'state-'+status);const controls=node('td'),actions=node('div',undefined,'row-actions');
  actions.append(action('Edit '+s.name,'edit',()=>openEditor(s)));
  if(s.next_run||s.frequency!=='once')actions.append(action((s.enabled?'Pause ':'Resume ')+s.name,s.enabled?'pause':'play',async()=>{await api(`/v1/schedules/${s.id}/enabled`,{method:'PATCH',body:{enabled:!s.enabled}});notice(s.enabled?'Schedule paused. A message already sending may still finish.':'Schedule resumed.');await loadSchedules();}));
  if(state.advanced&&s.next_run)actions.append(action('Skip next '+s.name,'arrow-right',async()=>{await api(`/v1/schedules/${s.id}/skip`,{method:'POST',body:{expectedNextRun:s.next_run}});notice('Next occurrence skipped.');await loadSchedules();}));
  actions.append(action('Delete '+s.name,'trash',()=>{state.deleteId=s.id;error('delete-error');$('delete-dialog').showModal();}));controls.append(actions);const chat=groupCell(s.chat_id,s.group_name);chat.append(message.firstChild,preview);if(s.last_error)chat.append(node('p',s.last_error,'error'));const recurrence=node('td',undefined,'repeat-cell'),parts=repeatLabel(s).split(' · ');recurrence.append(node('div',parts[0],'repeat-cadence'));if(parts[1])recurrence.append(node('p',parts[1],'row-subtitle'));tr.append(chat,recurrence,when,statusCell,controls);rows.append(tr);
 }
}
async function loadSchedules(){try{state.schedules=await api('/v1/schedules');error('page-error');renderSchedules();}catch(e){error('page-error',e.message+' Click Refresh to try again.');}finally{$('loading').hidden=true;}}
function renderHistory(){const query=$('history-search').value.toLocaleLowerCase();const source=state.route==='logs/scheduled'?state.history.filter(e=>e.schedule_id):state.history;const filtered=source.filter(e=>[e.schedule_name,e.message_text,e.group_name,e.chat_id,e.state].join(' ').toLocaleLowerCase().includes(query));const rows=$('history-rows');rows.replaceChildren();$('history-table').hidden=!filtered.length;$('history-empty').hidden=!!source.length;$('history-no-results').hidden=!source.length||!!filtered.length;
 for(const entry of pageItems(filtered,'history')){const tr=node('tr'),message=node('td');message.append(node('div',entry.schedule_name||(entry.message_type==='pdf'?'PDF':'Message'),'row-title'),node('p',entry.message_text||'–','row-preview'));const status=node('td');const names={sent:'Sent',unknown:'Unconfirmed',skipped:'Skipped',failed:'Failed',sending:'Sending'};status.append(node('div',names[entry.state]||entry.state,entry.state==='sent'?'state-sent':'result-error'));const detail=entry.error||(entry.state==='unknown'?'Check WhatsApp before rescheduling.':'');if(detail)status.append(node('p',detail,'result-note'));tr.append(message,groupCell(entry.chat_id,entry.group_name),node('td',formatTime(entry.created_at,Intl.DateTimeFormat().resolvedOptions().timeZone,true),'date'),status);const controls=node('td');if(state.messageActions&&entry.state==='sent'&&entry.message_id)controls.append(action('Actions for '+(entry.message_text||'message'),'settings',()=>openMessageAction(entry)));else controls.append(node('span','–','muted'));tr.append(controls);rows.append(tr);}
}
async function loadHistory(){$('reload-history').disabled=true;try{state.history=await api('/v1/history');renderHistory();error('page-error');}catch(e){error('page-error',e.message+' Click Refresh to try again.');}finally{$('reload-history').disabled=false;}}
for(const kind of ['schedule','history'])for(const [suffix,delta] of [['previous',-1],['next',1]])$(kind+'-'+suffix).addEventListener('click',()=>{state[kind+'Page']+=delta;kind==='schedule'?renderSchedules():renderHistory();});
$('filter-toggle').addEventListener('click',()=>{$('filter-panel').hidden=!$('filter-panel').hidden;$('filter-toggle').setAttribute('aria-expanded',String(!$('filter-panel').hidden));});
document.addEventListener('click',event=>{if(!event.target.closest('.filter-container')){$('filter-panel').hidden=true;$('filter-toggle').setAttribute('aria-expanded','false');}});
function clearFilters(){$('schedule-search').value='';$('status-filter').value='all';$('repeat-filter').value='all';state.schedulePage=1;state.scheduleScope='all';renderSchedules();}
for(const id of ['reset-filters','clear-search'])$(id).addEventListener('click',clearFilters);
for(const id of ['schedule-search','status-filter','repeat-filter'])$(id).addEventListener('input',()=>{state.schedulePage=1;renderSchedules();});
$('history-search').addEventListener('input',()=>{state.historyPage=1;renderHistory();});$('clear-history-search').addEventListener('click',()=>{$('history-search').value='';state.historyPage=1;renderHistory();});
function fillGroups(selected=$('group').value){const query=$('group-filter').value.toLocaleLowerCase();$('group').replaceChildren(new Option('Choose a group',''));for(const g of state.groups.filter(g=>g.name.toLocaleLowerCase().includes(query)||g.id===selected))$('group').add(new Option(g.name,g.id));$('group').value=selected;}
async function loadGroups(){$('group').disabled=true;error('group-error');$('retry-groups').hidden=true;try{const data=await api('/v1/groups');state.groups=(Array.isArray(data)?data:Object.values(data)).map(g=>({id:typeof g.id==='string'?g.id:g.id?._serialized,name:g.subject||g.name||'Unnamed group'})).filter(g=>g.id?.endsWith('@g.us')).sort((a,b)=>a.name.localeCompare(b.name));fillGroups(state.editing?.chat_id);if(['logs/apis','logs/scheduled'].includes(state.route))renderHistory();if(!state.groups.length){error('group-error','No groups found. Join a group in WhatsApp, then reload.');$('retry-groups').hidden=false;}}catch(e){error('group-error',e.message+' Connect WhatsApp, then reload groups.');$('retry-groups').hidden=false;}finally{$('group').disabled=false;}}
function localDate(date,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(date)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
function openEditor(schedule=null){
 if(state.busy)return;state.editing=schedule;state.editorTrigger=document.activeElement;error('form-error');$('schedule-form').reset();state.attachment=null;state.fileReading=false;
 $('group-filter').value='';const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const zone=schedule?.timezone||(localZone==='Asia/Calcutta'?'Asia/Kolkata':localZone)||'Asia/Kolkata';
 $('timezone').value=zone;$('name').value=schedule?.name||'';$('message').value=schedule?.text||'';$('frequency').value=schedule?.frequency||'once';
 $('message-type').value=schedule?.message_type||'text';$('repeat-interval').value=schedule?.repeat_interval||1;$('end-date').value=schedule?.end_date||'';$('month-days').value=(schedule?.month_days||[]).join(', ');
 for(const checkbox of document.querySelectorAll('[name="repeat-day"]'))checkbox.checked=(schedule?.weekdays||[]).includes(Number(checkbox.value));
 $('repeat-options').open=!!(schedule&&(schedule.repeat_interval>1||schedule.end_date||schedule.weekdays?.length||schedule.month_days?.length));
 $('start').value=schedule?.next_run&&Date.parse(schedule.next_run)>Date.now()?localDate(schedule.next_run,zone):localDate(Date.now()+10*60000,zone);
 $('enabled').checked=schedule?!!schedule.enabled:true;$('editor-title').textContent=schedule?'Edit Scheduled Message':'Schedule Message';$('save').textContent=schedule?'Save changes':'Schedule message';
 updateContentFields();updateRepeatFields();updateSummary();loadGroups();$('editor').showModal();$('name').focus();
}
function repeatLabel(s){
 const n=s.repeat_interval||1;if(s.frequency==='once')return 'Once';
 const unit={daily:'day',weekdays:'day',weekly:'week',monthly:'month'}[s.frequency];
 let label=n===1?frequencyNames[s.frequency]:`Every ${n} ${unit}s`;
 if(s.weekdays?.length)label+=' · '+s.weekdays.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');
 if(s.month_days?.length)label+=' · '+s.month_days.join(', ');
 return label;
}
function updateContentFields(){
 const type=$('message-type').value,media=type!=='text';$('attachment-fields').hidden=!media;$('message-label').textContent=media?'Caption (optional)':'Message';
 $('message').required=!media;$('message').maxLength=media?1000:4000;$('attachment').accept=type==='pdf'?'application/pdf':'image/png,image/jpeg';
 const retained=state.editing?.message_type===type&&state.editing?.has_attachment;
 $('attachment-note').textContent=state.attachment?state.attachment.filename:retained?`Current file: ${state.editing.filename}. Choose a file to replace it.`:'Choose a file up to 5 MB.';
}
function updateRepeatFields(){
 const f=$('frequency').value;$('repeat-options').hidden=f==='once'||!state.advanced;
 for(const input of $('repeat-options').querySelectorAll('input'))input.disabled=f==='once'||!state.advanced;$('weekday-options').hidden=!['daily','weekly'].includes(f);$('monthday-options').hidden=f!=='monthly';
 $('interval-unit').textContent=f==='monthly'?'months':f==='weekly'?'weeks':'days';
}
$('message-type').disabled=true;$('frequency').querySelector('[value=monthly]').disabled=true;
async function loadCapabilities(){try{const c=await api('/v1/capabilities');state.advanced=c.advancedSchedules===true;state.messageActions=c.messageActions===true;}catch{state.advanced=false;state.messageActions=false;}
 $('message-type').disabled=!state.advanced;$('frequency').querySelector('[value=monthly]').disabled=!state.advanced;updateRepeatFields();if(state.route==='settings/scheduled')renderSchedules();if(['logs/apis','logs/scheduled'].includes(state.route))renderHistory();}
$('message-type').addEventListener('change',()=>{state.attachment=null;$('attachment').value='';updateContentFields();updateSummary();});
$('attachment').addEventListener('change',async()=>{
 const file=$('attachment').files[0];state.attachment=null;error('form-error');if(!file){updateContentFields();return;}
 if(file.size>5*1024*1024){error('form-error','Choose a file under 5 MB.');$('attachment').value='';updateContentFields();return;}
 state.fileReading=true;$('save').disabled=true;
 try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read the file. Choose it again.'));reader.readAsDataURL(file);});if($('attachment').files[0]===file)state.attachment={filename:file.name,data};}
 catch(e){error('form-error',e.message);}finally{state.fileReading=false;$('save').disabled=state.busy;updateContentFields();}
});
$('frequency').addEventListener('change',()=>{updateRepeatFields();updateSummary();});
for(const id of ['repeat-interval','end-date','month-days'])$(id).addEventListener('input',updateSummary);
for(const input of document.querySelectorAll('[name="repeat-day"]'))input.addEventListener('change',updateSummary);
function closeEditor(){if(state.busy)return;$('editor').close();state.editing=null;if(state.editorTrigger?.isConnected)state.editorTrigger.focus();}
$('editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
function selectedWeekdays(){return [...document.querySelectorAll('[name="repeat-day"]:checked')].map(e=>Number(e.value));}
function selectedMonthDays(){return $('month-days').value.trim()?$('month-days').value.split(',').map(v=>Number(v.trim())):[];}
function updateSummary(){
 $('char-count').textContent=`${$('message').value.length.toLocaleString()} / ${$('message-type').value==='text'?'4,000':'1,000'}`;
 if(!$('start').value){$('schedule-summary').textContent='Choose when to send.';return;}
 const date=new Date($('start').value+':00Z');if(Number.isNaN(date.getTime()))return;
 const label=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date),frequency=$('frequency').value;
 const repeat=repeatLabel({frequency,repeat_interval:Number($('repeat-interval').value)||1,weekdays:['daily','weekly'].includes(frequency)?selectedWeekdays():[],month_days:frequency==='monthly'?selectedMonthDays():[]});
 $('schedule-summary').textContent=`${label} · ${$('timezone').value} · ${repeat}`+(frequency!=='once'&&$('end-date').value?' · Ends '+$('end-date').value:'');
}
$('schedule-form').addEventListener('submit',async event=>{
 event.preventDefault();if(state.busy||state.fileReading)return;state.busy=true;$('save').disabled=true;error('form-error');
 try{
  const group=state.groups.find(g=>g.id===$('group').value);if(!group)throw Error('Choose a group before scheduling.');
  const type=$('message-type').value,frequency=$('frequency').value;
  if(type!=='text'&&!state.attachment&&!(state.editing?.message_type===type&&state.editing?.has_attachment))throw Error('Choose an attachment.');
  const body={name:$('name').value,chatId:group.id,groupName:group.name,type,text:$('message').value,timezone:$('timezone').value,startLocal:$('start').value,frequency,enabled:$('enabled').checked,
   interval:frequency==='once'?1:Number($('repeat-interval').value),weekdays:['daily','weekly'].includes(frequency)?selectedWeekdays():[],monthDays:frequency==='monthly'?selectedMonthDays():[],endDate:frequency==='once'?null:$('end-date').value||null,
   ...(type!=='text'&&state.attachment?state.attachment:{})};
  await api(state.editing?`/v1/schedules/${state.editing.id}`:'/v1/schedules',{method:state.editing?'PUT':'POST',body});
  state.busy=false;closeEditor();clearFilters();notice(body.enabled?'Message scheduled.':'Schedule saved and paused.');await loadSchedules();
 }catch(e){error('form-error',e.message);}finally{state.busy=false;$('save').disabled=false;}
});
$('confirm-delete').addEventListener('click',async()=>{const b=$('confirm-delete');b.disabled=true;try{await api(`/v1/schedules/${state.deleteId}`,{method:'DELETE'});$('delete-dialog').close();notice('Schedule deleted. Its history is kept.');await loadSchedules();}catch(e){error('delete-error',e.message);}finally{b.disabled=false;}});
for(const id of ['new-schedule','empty-create','history-create'])$(id).addEventListener('click',()=>{if(state.route!=='settings/scheduled')navigate('settings/scheduled');openEditor();});
for(const id of ['close-editor','cancel'])$(id).addEventListener('click',closeEditor);
$('reload-history').addEventListener('click',loadHistory);$('retry-groups').addEventListener('click',loadGroups);$('group-filter').addEventListener('input',()=>fillGroups());for(const id of ['message','start','timezone','frequency'])$(id).addEventListener('input',updateSummary);
const zones=[...new Set(['Asia/Kolkata',Intl.DateTimeFormat().resolvedOptions().timeZone,...Intl.supportedValuesOf('timeZone')])];for(const zone of zones)$('timezone').add(new Option(zone,zone));
function connectionState(status,me){if(me)state.phone=me;state.connected=status==='WORKING';$('connection-count').textContent=state.connected?'1 / 1':'0 / 1';$('connection').title=state.connected?'WhatsApp connected':'Reconnect WhatsApp';$('connection').setAttribute('aria-label',$('connection').title);for(const id of ['connection-dot','dashboard-phone-dot'])$(id).classList.toggle('connected',state.connected);$('dashboard-phone-status').textContent=state.connected?'Connected':'Connection needs attention';renderPhone();}
async function loadConnection(){try{const s=await api('/v1/status');connectionState(s.status,s.me);}catch{connectionState('UNAVAILABLE');}}
let imageUrl,connectionBusy=false,connectionTimer;
async function refreshConnection(recover=false){if(connectionBusy)return;connectionBusy=true;clearTimeout(connectionTimer);$('refresh-connection').disabled=true;let delay=10000;
 try{const r=await fetch(recover?'/refresh':'/status',{method:recover?'POST':'GET',headers:recover?{'Content-Type':'application/json'}:{},signal:AbortSignal.timeout(35000)});if(!r.ok)throw Error('Connection unavailable. Try Refresh connection again.');const s=await r.json();connectionState(s.status,s.me);error('connect-error');$('connect-title').textContent=state.connected?'WhatsApp is connected':'Link your WhatsApp';$('connect-intro').textContent=state.connected?'Your local hub is ready to send and receive messages.':'Scan the code with the phone you want to connect.';$('connect-steps').hidden=state.connected;$('connected-symbol').hidden=!state.connected;
 if(state.connected){$('qr').hidden=true;$('connect-status').textContent='Connected';}
 else if(s.status==='SCAN_QR_CODE'){const r=await fetch('/qr',{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('The code is refreshing. Try Refresh connection again.');const nextUrl=URL.createObjectURL(await r.blob()),previous=imageUrl;$('qr').src=nextUrl;await $('qr').decode();imageUrl=nextUrl;if(previous)URL.revokeObjectURL(previous);$('qr').hidden=false;$('connect-status').textContent='Waiting for your phone';}
 else{$('qr').hidden=true;$('connect-status').textContent=s.status==='STARTING'?'Starting WhatsApp…':'Code expired';if(s.status==='STARTING')delay=1500;else throw Error('The linking session expired. Click Refresh connection for a new code.');}
 }catch(e){error('connect-error',e.name==='TimeoutError'?'Connection timed out. Try Refresh connection again.':e.message);$('qr').hidden=true;$('connected-symbol').hidden=true;$('connect-status').textContent='Refresh to get a new code';}
 finally{connectionBusy=false;$('refresh-connection').disabled=false;connectionTimer=setTimeout(()=>{if(state.route==='settings/phones'&&!document.hidden)refreshConnection();},delay);}
}
$('refresh-connection').addEventListener('click',()=>refreshConnection(true));
$('refresh-page').addEventListener('click',async()=>{const b=$('refresh-page');b.disabled=true;try{await loadConnection();if(state.route==='settings/scheduled')await loadSchedules();else if(['logs/apis','logs/scheduled'].includes(state.route))await loadHistory();else if(state.route==='settings/phones')await refreshConnection();else notice('Workspace refreshed.');}finally{b.disabled=false;}});

function syncPreferences(){if(!$('pref-sidebar'))return;$('pref-sidebar').checked=!$('app-shell').classList.contains('sidebar-collapsed');$('pref-theme').value=document.documentElement.dataset.theme;}
$('pref-sidebar').addEventListener('change',()=>collapse(!$('pref-sidebar').checked));$('pref-theme').addEventListener('change',()=>setTheme($('pref-theme').value));
$('pref-assistant').checked=stored('wa-hub-assistant','true')==='true';
function setAssistant(){document.querySelector('.assistant-launcher').hidden=!$('pref-assistant').checked;remember('wa-hub-assistant',String($('pref-assistant').checked));}
$('pref-assistant').addEventListener('change',setAssistant);setAssistant();
for(const b of document.querySelectorAll('[data-scope]'))b.addEventListener('click',()=>{state.scheduleScope=b.dataset.scope;state.schedulePage=1;renderSchedules();});
$('schedule-sort').addEventListener('change',()=>{state.scheduleSort=$('schedule-sort').value;renderSchedules();});
function renderPhone(){const number=state.phone?.id?.split('@')[0];$('phone-number').textContent=number?'+'+number:'WhatsApp';$('phone-name').textContent=state.phone?.pushName||'Linked phone';$('phone-status').textContent=state.connected?'Connected':'Reconnect';$('phone-status').className=state.connected?'state-active':'';$('phone-count').textContent=(state.connected?'1':'0')+' / 1 phones connected';$('phone-connected-dot').classList.toggle('connected',state.connected);$('connection-card').hidden=state.connected;const query=$('phone-search').value.toLowerCase();const matches=($('phone-number').textContent+' '+$('phone-name').textContent).toLowerCase().includes(query);const filter=$('phone-filter').value;const visible=matches&&(filter==='all'||(filter==='connected'?state.connected:!state.connected));$('phone-list-card').hidden=!visible;$('phone-empty').hidden=visible;}
$('phone-search').addEventListener('input',renderPhone);$('phone-filter').addEventListener('change',renderPhone);
$('phone-clear').addEventListener('click',()=>{$('phone-search').value='';$('phone-filter').value='all';renderPhone();});
$('phone-status').addEventListener('click',()=>state.connected?info('WhatsApp connected','Your linked number is ready to send and receive messages.'):refreshConnection(true));
$('api-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText('https://wa.ajaypawriya.com');notice('API address copied.');}catch{info('API address','https://wa.ajaypawriya.com');}});
const messageActionNames={edit:'Save edit',delete:'Delete for everyone',forward:'Forward message',react:'Apply reaction',pin:'Pin message',unpin:'Unpin message'};
function updateMessageAction(){
 const kind=$('message-action').value;
 for(const [key,id] of [['edit','action-text-fields'],['forward','action-forward-fields'],['react','action-reaction-fields'],['pin','action-pin-fields']])$(id).hidden=key!==kind;
 $('submit-message-action').disabled=state.actionBusy||state.actionLocked||(kind==='forward'&&!state.forwardReady);$('action-text').required=kind==='edit';$('action-destination').required=kind==='forward';$('submit-message-action').textContent=messageActionNames[kind];$('submit-message-action').className=kind==='delete'?'danger':'primary';
 $('message-action-note').textContent=kind==='delete'?'Deletes this message from WhatsApp for everyone. This cannot be undone.':kind==='edit'?'WhatsApp limits how long messages can be edited. Send history keeps the original content.':'Applies to the selected WhatsApp message. Group permissions and WhatsApp limits still apply.';
}
function openMessageAction(entry){
 state.actionEntry=entry;state.actionKey=null;state.actionBody=null;state.actionBusy=false;state.actionLocked=false;state.forwardReady=false;state.actionGeneration=(state.actionGeneration||0)+1;state.actionTrigger=document.activeElement;
 $('message-action-form').reset();for(const input of $('message-action-form').elements)input.disabled=false;
 $('action-message-preview').textContent=entry.message_text||'Selected message';$('action-text').value=entry.message_text||'';$('action-text').maxLength=entry.message_type==='text'?4000:1000;
 $('action-destination').replaceChildren(new Option('Choose a group',''),...state.groups.map(g=>new Option(g.name,g.id)));
 error('message-action-error');updateMessageAction();$('message-action-dialog').showModal();$('message-action').focus();
}
function closeMessageAction(){if(state.actionBusy)return;$('message-action-dialog').close();state.actionTrigger?.focus();}
$('close-message-action').addEventListener('click',closeMessageAction);$('cancel-message-action').addEventListener('click',closeMessageAction);
$('message-action-dialog').addEventListener('cancel',e=>{e.preventDefault();closeMessageAction();});$('message-action').addEventListener('change',()=>{updateMessageAction();if($('message-action').value==='forward')loadForwardGroups();});
$('reload-action-groups').addEventListener('click',loadForwardGroups);
async function loadForwardGroups(){
 const generation=state.actionGeneration;state.forwardReady=false;$('action-destination').disabled=true;$('reload-action-groups').disabled=true;$('action-groups-state').textContent='Loading groups…';updateMessageAction();
 try{const data=await api('/v1/groups');if(generation!==state.actionGeneration)return;
  const groups=(Array.isArray(data)?data:Object.values(data)).map(g=>({id:typeof g.id==='string'?g.id:g.id?._serialized,name:g.subject||g.name||'Unnamed group'})).filter(g=>g.id?.endsWith('@g.us')).sort((a,b)=>a.name.localeCompare(b.name));
  const selected=$('action-destination').value;$('action-destination').replaceChildren(new Option('Choose a group',''),...groups.map(g=>new Option(g.name,g.id)));$('action-destination').value=selected;
  state.forwardReady=groups.length>0;$('action-groups-state').textContent=groups.length?'':'No groups found. Join a group in WhatsApp, then reload groups.';
 }catch(e){if(generation===state.actionGeneration)$('action-groups-state').textContent='Could not load groups. Reconnect WhatsApp or reload groups.';}
 finally{if(generation===state.actionGeneration){$('action-destination').disabled=!state.forwardReady||state.actionLocked;$('reload-action-groups').disabled=state.actionLocked;updateMessageAction();}}
}
$('message-action-form').addEventListener('submit',async e=>{
 e.preventDefault();if(state.actionBusy)return;state.actionBusy=true;$('submit-message-action').disabled=true;error('message-action-error');let uncertain=false;
 const entry=state.actionEntry,kind=$('message-action').value,body={chatId:entry.chat_id,messageId:entry.message_id,action:kind,...(kind==='edit'?{text:$('action-text').value}:kind==='forward'?{targetChatId:$('action-destination').value}:kind==='react'?{reaction:$('action-reaction').value}:kind==='pin'?{days:Number($('action-days').value)}:{})};
 const serialized=JSON.stringify(body);if(state.actionBody!==serialized){state.actionKey=crypto.randomUUID();state.actionBody=serialized;}
 try{await api('/v1/message-actions',{method:'POST',body,headers:{'Idempotency-Key':state.actionKey}});state.actionBusy=false;closeMessageAction();notice('Message action accepted by WhatsApp.');}
 catch(errorResult){uncertain=!errorResult.status||errorResult.outcome==='unknown'||errorResult.status===409;error('message-action-error',uncertain?'Action unconfirmed or already attempted. Check WhatsApp before starting another action.':errorResult.message);}
 finally{state.actionBusy=false;state.actionLocked=uncertain;if(uncertain){for(const input of $('message-action-form').elements)input.disabled=input.id!=='cancel-message-action';}else updateMessageAction();}
});
showView(currentRoute());loadConnection();loadGroups();loadCapabilities();
setInterval(()=>{if(!document.hidden){loadConnection();if(!$('editor').open&&state.route==='settings/scheduled')loadSchedules();if(state.route==='settings/phones'&&!connectionBusy)refreshConnection();}},15000);
