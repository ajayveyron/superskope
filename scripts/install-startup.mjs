import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url)),home=homedir();
const directory=`${home}/Library/LaunchAgents`,logDir=`${root}/data/logs`;
mkdirSync(directory,{recursive:true});mkdirSync(logDir,{recursive:true,mode:0o700});
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const jobs=[
  ['runtime',['/usr/bin/caffeinate','-s',process.execPath,`${root}/scripts/supervise.mjs`]],
  ['panel',[process.execPath,`${root}/scripts/pairing.mjs`]],
];
if(existsSync(`${root}/data/tunnel.json`)){
  const {id}=JSON.parse(readFileSync(`${root}/data/tunnel.json`,'utf8'));
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid tunnel ID');
  jobs.push(['tunnel',[`${home}/.local/bin/cf`,'tunnels','run',id,'--log-level','warn']]);
}
for(const [name,args] of jobs){
  const label=`com.wahub.${name}`,path=`${directory}/${label}.plist`;
  const content=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a=>`<string>${escape(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(home)}/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escape(logDir)}/${name}.log</string><key>StandardErrorPath</key><string>${escape(logDir)}/${name}.error.log</string></dict></plist>`;
  if(existsSync(path)&&readFileSync(path,'utf8')===content){
    try{execFileSync('launchctl',['print',`gui/${process.getuid()}/${label}`],{stdio:'ignore'});console.log(`${label}: already loaded`);continue;}catch{}
  }else if(existsSync(path)){
    throw Error(`Existing startup file differs: ${path}. Review it before replacing.`);
  }
  writeFileSync(path,content,{mode:0o600});execFileSync('plutil',['-lint',path],{stdio:'inherit'});
  execFileSync('launchctl',['bootstrap',`gui/${process.getuid()}`,path],{stdio:'inherit'});
  console.log(`${label}: loaded`);
}
