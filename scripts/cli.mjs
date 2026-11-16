import { loadEnvFile } from 'node:process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
loadEnvFile('.env');
const [command, ...args] = process.argv.slice(2);
async function request(path, body) {
  const response = await fetch(`http://127.0.0.1:3010${path}`, {method: body === undefined ? 'GET' : 'POST', headers: {'X-Api-Key': process.env.WAHA_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`WAHA ${response.status}: ${await response.text()}`);
  return response.json();
}
if (command === 'pair') {
  const sessions = await request('/api/sessions?all=true');
  const existing = sessions.find(s => s.name === 'default');
  if (!existing) {
    const session = await request('/api/sessions', {name: 'default', start: true, config: {noweb: {store: {enabled: true, fullSync: false}}, webhooks: [{url: 'http://hub:3011/webhooks/waha', events: ['message', 'message.ack', 'session.status'], hmac: {key: process.env.WEBHOOK_SECRET}, retries: {policy: 'linear', delaySeconds: 2, attempts: 5}}]}});
    console.log({name: session.name, status: session.status});
  } else if (['STOPPED', 'FAILED'].includes(existing.status)) {
    await request('/api/sessions/default/start', {});
    console.log('Session started.');
  } else console.log({name: existing.name, status: existing.status});
} else if (command === 'qr') {
  const qr = await request('/api/default/auth/qr?format=image');
  writeFileSync('data/qr.png', Buffer.from(qr.data, 'base64'), {mode: 0o600});
  console.log(fileURLToPath(new URL('../data/qr.png', import.meta.url)));
} else if (command === 'status') {
  const session = await request('/api/sessions/default');
  console.log(JSON.stringify({name: session.name, status: session.status, me: session.me}, null, 2));
} else if (command === 'groups') {
  const groups = await request('/api/default/groups?exclude=participants');
  console.log(JSON.stringify(groups, null, 2));
} else if (command === 'events') {
  const response = await fetch('http://127.0.0.1:3011/v1/events', {headers: {Authorization: `Bearer ${process.env.HUB_API_KEY}`}});
  console.log(JSON.stringify(await response.json(), null, 2));
} else {
  console.log('Usage: npm run cli -- pair | qr | status | groups | events');
  process.exitCode = 1;
}
