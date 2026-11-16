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
  const day=new Date(Date.UTC(nowParts.year,nowParts.month-1,nowParts.day));
  const wantedDay=new Date(initial.slice(0,10)+'T12:00:00Z').getUTCDay();
  for(let i=0;i<370;i++,day.setUTCDate(day.getUTCDate()+1)) {
    const weekday=day.getUTCDay();
    if(schedule.frequency==='weekdays'&&[0,6].includes(weekday))continue;
    if(schedule.frequency==='weekly'&&weekday!==wantedDay)continue;
    const local=`${day.getUTCFullYear()}-${pad(day.getUTCMonth()+1)}-${pad(day.getUTCDate())}T${initial.slice(11)}`;
    try{const utc=localToUtc(local,schedule.timezone);if(utc>after)return utc;}catch(error){if(!error.message.includes('clocks change'))throw error;}
  }
  throw new Error('Could not calculate the next occurrence.');
}
