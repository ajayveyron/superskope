// Explicitly authorized test target. This script never creates or renames groups.
import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
loadEnvFile('.env');
const base = process.env.HUB_URL || 'http://127.0.0.1:3011';
async function call(path, body, id) {
  const response = await fetch(base + path, {method: body ? 'POST' : 'GET', headers: {Authorization: `Bearer ${process.env.HUB_API_KEY}`, 'Content-Type': 'application/json', ...(id ? {'Idempotency-Key': id} : {})}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(40000)});
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify({status: response.status, ...data}));
  return data;
}
const status = await call('/v1/status');
if (status.status !== 'WORKING') throw new Error('Link WhatsApp on http://localhost:3012 first. Nothing sent.');
const result = await call('/v1/groups');
const groups = Array.isArray(result) ? result : Object.values(result);
const matches = groups.filter(g => (g.subject || g.name || '').trim().toLowerCase() === 'purvi c-403');
if (matches.length !== 1) throw new Error(`Expected exactly one group named purvi c-403; found ${matches.length}. Nothing sent.`);
const group = matches[0];
const chatId = typeof group.id === 'string' ? group.id : group.id?._serialized;
if (!chatId?.endsWith('@g.us')) throw new Error('Could not resolve a valid group ID. Nothing sent.');
const suffix = createHash('sha256').update(chatId).digest('hex').slice(0, 16);
const messages = [
  {key: `smoke-20261116-text-${suffix}`, body: {type: 'text', chatId, text: "Ajay's WA Hub test: checking that my local WhatsApp hub can send to this group. One test PDF will follow. Please reply 'test received' to help verify incoming messages too."}},
  {key: `smoke-20261116-pdf-${suffix}`, body: {type: 'pdf', chatId, filename: 'wa-hub-test.pdf', data: readFileSync('output/pdf/wa-hub-test.pdf').toString('base64')}},
];
for (const {key, body} of messages) {
  const response = await call('/v1/messages', body, key);
  console.log(JSON.stringify({type: body.type, group: group.subject || group.name, state: response.state, messageId: response.result?.id || response.result?.key?.id}));
}
