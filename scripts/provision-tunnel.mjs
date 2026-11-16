// Run only after approving the production DNS/tunnel change for wa.ajaypawriya.com.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const hostname='wa.ajaypawriya.com',zone='ajaypawriya.com',name='wa-hub';
const cf=(...args)=>JSON.parse(execFileSync('cf',args,{encoding:'utf8',maxBuffer:4*1024*1024}));
const records=cf('dns','records','list','--zone',zone,'--name',hostname);
let saved=existsSync('data/tunnel.json')?JSON.parse(readFileSync('data/tunnel.json','utf8')):null;
if(records.length&&!saved)throw Error('Hostname already has DNS records. Refusing to overwrite.');
if(!saved){
  const existing=cf('tunnels','list').filter(t=>t.name===name&&!t.deleted_at);
  if(existing.length)throw Error('A tunnel with this name already exists. Review it before reusing.');
  const tunnel=cf('tunnels','create','--name',name,'--config-src','cloudflare');
  saved={id:tunnel.id,hostname};writeFileSync('data/tunnel.json',JSON.stringify(saved,null,2)+'\n',{mode:0o600,flag:'wx'});
}
cf('tunnels','config','update',saved.id,'--body',JSON.stringify({config:{ingress:[{hostname,service:'http://127.0.0.1:3011'},{service:'http_status:404'}]}}));
if(!records.length)cf('dns','records','create','--zone',zone,'--body',JSON.stringify({type:'CNAME',name:hostname,content:`${saved.id}.cfargotunnel.com`,proxied:true,ttl:1}));
else if(records.length!==1||records[0].content!==`${saved.id}.cfargotunnel.com`)throw Error('DNS target differs. Refusing to overwrite.');
console.log(`Configured https://${hostname}. Tunnel ID: ${saved.id}`);
