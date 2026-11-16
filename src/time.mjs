const formatters = new Map();
export function localParts(date, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-GB', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}));
  return Object.fromEntries(formatters.get(zone).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
const stamp=p=>Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0);
export function localToUtc(local, zone) {
  if(typeof local!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw new Error('Choose a date and time.');
  const [year,month,day,hour,minute]=local.split(/[-T:]/).map(Number);
  const p={year,month,day,hour,minute},wall=stamp(p),check=new Date(wall);
  if(year<2020||year>2100||check.getUTCMonth()+1!==month||check.getUTCDate()!==day||hour>23||minute>59)throw new Error('Choose a valid date and time.');
  const offsets=new Set();
  for(let h=-36;h<=36;h+=6){const t=wall+h*3600000;offsets.add(stamp(localParts(new Date(t),zone))-t);}
  const candidates=[...offsets].map(o=>wall-o).filter(t=>stamp(localParts(new Date(t),zone))===wall).sort((a,b)=>a-b);
  if(!candidates.length)throw new Error('That local time does not exist because the clocks change. Choose another time.');
  return new Date(candidates[0]).toISOString();
}
const pad=n=>String(n).padStart(2,'0');
export function nextRun(schedule,after) {
  if(schedule.frequency==='once')return null;
  const initial=schedule.start_local;
  const nowParts=localParts(new Date(after),schedule.timezone);
  const anchor=new Date(initial.slice(0,10)+'T00:00:00Z');
  const day=new Date(Math.max(anchor.getTime(),Date.UTC(nowParts.year,nowParts.month-1,nowParts.day)));
  for(;day.getUTCFullYear()<=2100;day.setUTCDate(day.getUTCDate()+1)) {
    const local=`${day.getUTCFullYear()}-${pad(day.getUTCMonth()+1)}-${pad(day.getUTCDate())}T${initial.slice(11)}`;
    if(schedule.end_date&&local.slice(0,10)>schedule.end_date)return null;
    if(!matchesRecurrence(schedule,day))continue;
    try{const utc=localToUtc(local,schedule.timezone);if(utc>after)return utc;}catch(error){if(!error.message.includes('clocks change'))throw error;}
  }
  return null;
}

export function matchesRecurrence(schedule,day) {
  const anchor=new Date(schedule.start_local.slice(0,10)+'T00:00:00Z');
  const gap=Math.round((day-anchor)/86400000),interval=schedule.repeat_interval||1;
  const weekdays=typeof schedule.weekdays==='string'?JSON.parse(schedule.weekdays):schedule.weekdays||[];
  const monthDays=typeof schedule.month_days==='string'?JSON.parse(schedule.month_days):schedule.month_days||[];
  if(gap<0)return false;
  if(schedule.frequency==='monthly'){
    const months=(day.getUTCFullYear()-anchor.getUTCFullYear())*12+day.getUTCMonth()-anchor.getUTCMonth();
    return months%interval===0&&(monthDays.length?monthDays:[anchor.getUTCDate()]).includes(day.getUTCDate());
  }
  const allowed=schedule.frequency==='weekdays'?[1,2,3,4,5]:weekdays.length?weekdays:schedule.frequency==='weekly'?[anchor.getUTCDay()]:[0,1,2,3,4,5,6];
  const period=schedule.frequency==='weekly'?Math.floor((gap+(anchor.getUTCDay()+6)%7)/7):gap;
  return period%interval===0&&allowed.includes(day.getUTCDay());
}
