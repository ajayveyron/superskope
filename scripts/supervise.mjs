import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
const run=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
const lima=process.env.LIMA_BIN||`${homedir()}/.local/share/reel-bot-lima/bin/limactl`;
let ready=false;
const log=message=>console.log(`${new Date().toISOString()} ${message}`);
async function check(){
  try{
    const {stdout}=await run(lima,['list','wa-hub','--format','{{.Status}}'],{timeout:15000});
    if(stdout.trim()!=='Running'){ready=false;log('Starting the wa-hub virtual machine.');await run(lima,['start','--yes','wa-hub'],{timeout:180000});}
    if(!ready){await run(lima,['shell','wa-hub','--','docker','compose','--project-directory',root,'up','-d'],{timeout:120000});ready=true;log('Containers started.');}
    const response=await fetch('http://127.0.0.1:3011/healthz',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Hub health check failed.');
  }catch(e){ready=false;log(`Will retry startup: ${e.message.slice(0,350)}`);}
}
for(;;){await check();await new Promise(r=>setTimeout(r,30000));}
