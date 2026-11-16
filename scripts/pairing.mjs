// Local pairing view. Never expose port 3012 through a tunnel.
import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {readFile} from 'node:fs/promises';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
loadEnvFile('.env');
export function createPairingServer({wahaUrl='http://127.0.0.1:3010',wahaKey=process.env.WAHA_API_KEY}={}) {
let recovery;
async function engine(path,method='GET'){
  const response=await fetch(wahaUrl+path,{method,headers:{'X-Api-Key':wahaKey,Accept:'application/json','Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Engine unavailable');
  return response.json();
}
return createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const hosts = ['127.0.0.1:3012', 'localhost:3012'];
  const localOrigin=hosts.some(h=>req.headers.origin===`http://${h}`);
  if (!hosts.includes(req.headers.host) || (req.headers.origin && !localOrigin) || req.headers['sec-fetch-site'] === 'cross-site' || !['GET','POST','PUT','PATCH','DELETE'].includes(req.method)) {res.writeHead(403).end();return;}
  if(req.method!=='GET'&&(!localOrigin||req.headers['content-type']!=='application/json')){res.writeHead(403).end();return;}
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    const apiRoutes=['/v1/status','/v1/groups','/v1/schedules','/v1/history'];
    if(apiRoutes.includes(path)||/^\/v1\/schedules\/[a-f0-9-]+(?:\/enabled)?$/.test(path)){
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>32000){res.writeHead(413).end(JSON.stringify({error:'Request is too large.'}));return;}chunks.push(chunk);}
      const response=await fetch('http://127.0.0.1:3011'+path,{method:req.method,headers:{Authorization:`Bearer ${process.env.HUB_API_KEY}`,'Content-Type':'application/json'},...(req.method!=='GET'?{body:Buffer.concat(chunks)}:{}),signal:AbortSignal.timeout(35000)});
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
    }
    if(req.method==='POST'){
      if(req.url!=='/refresh'){res.writeHead(404).end();return;}
      if(!recovery)recovery=(async()=>{
        const session=await engine('/api/sessions/default');
        if(session.status==='FAILED')await engine('/api/sessions/default/restart','POST');
        else if(session.status==='STOPPED')await engine('/api/sessions/default/start','POST');
        return engine('/api/sessions/default');
      })().finally(()=>{recovery=undefined;});
      const session=await recovery;
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:session.status}));return;
    }
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    const assets={'/':['index.html','text/html; charset=utf-8'],'/connect':['index.html','text/html; charset=utf-8'],'/fonts/inter-variable.woff2':['fonts/inter-variable.woff2','font/woff2'],'/icons.js':['icons.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/app.css':['app.css','text/css']};
    if(assets[req.url]){const [file,type]=assets[req.url];res.setHeader('Content-Type',type);res.end(await readFile(new URL('../public/'+file,import.meta.url)));return;}
    if (!['/status', '/qr'].includes(req.url)) {res.writeHead(404).end();return;}
    const body = await engine(req.url === '/status' ? '/api/sessions/default' : '/api/default/auth/qr?format=image');
    if (req.url === '/status') {res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify({status: body.status}));}
    else {res.setHeader('Content-Type', 'image/png');res.end(Buffer.from(body.data, 'base64'));}
  } catch {res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Local service unavailable. Wait a moment and retry.'}));}
});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))createPairingServer().listen(3012, '127.0.0.1', () => console.log('SuperSkope: http://localhost:3012'));
