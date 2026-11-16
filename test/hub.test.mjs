import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createHub } from '../src/server.mjs';

test('authenticated API, signed webhooks, durable deduplication and uncertain sends', async t => {
  let sends = 0, fail = false;
  const engine = createServer(async (req, res) => {
    assert.equal(req.headers['x-api-key'], 'w'.repeat(32));
    if (req.url === '/api/sessions/default') {res.setHeader('Content-Type', 'application/json');res.end('{"status":"WORKING"}');return;}
    if (req.url === '/api/sendText') {
      sends++;
      for await (const chunk of req) {};
      await new Promise(r => setTimeout(r, 20));
      res.writeHead(fail ? 500 : 201, {'Content-Type': 'application/json'}).end(JSON.stringify({id: 'test-message'}));return;
    }
    res.writeHead(404).end();
  });
  engine.listen(0, '127.0.0.1'); await once(engine, 'listening');
  const dataDir = mkdtempSync(join(tmpdir(), 'wa-hub-test-'));
  const options = {wahaUrl: `http://127.0.0.1:${engine.address().port}`, wahaKey: 'w'.repeat(32), apiKey: 'a'.repeat(32), webhookSecret: 's'.repeat(32), dataDir};
  let hub, base;
  async function start() {hub = createHub(options);hub.listen(0, '127.0.0.1');await once(hub, 'listening');base = `http://127.0.0.1:${hub.address().port}`;}
  async function stop() {await new Promise(r => hub.close(r));}
  t.after(async () => {await stop();await new Promise(r => engine.close(r));rmSync(dataDir, {recursive: true, force: true});});
  await start();
  const auth = {Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json'};
  await t.test('private routes reject missing credentials', async () => {
    assert.equal((await fetch(`${base}/v1/events`)).status, 401);
    assert.equal((await fetch(`${base}/v1/status`, {headers: auth})).status, 200);
  });
  await t.test('unsigned/tampered webhooks rejected; signed replay stored once', async () => {
    const body = JSON.stringify({id: 'event1', event: 'message', payload: {body: 'hello'}});
    assert.equal((await fetch(`${base}/webhooks/waha`, {method: 'POST', body})).status, 401);
    const headers = {'x-webhook-hmac': createHmac('sha512', options.webhookSecret).update(body).digest('hex')};
    assert.equal((await fetch(`${base}/webhooks/waha`, {method: 'POST', body: body+' ', headers})).status, 401);
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/webhooks/waha`, {method: 'POST', body, headers})).status, 200);
    assert.equal((await (await fetch(`${base}/v1/events`, {headers: auth})).json()).length, 1);
  });
  const message = {type: 'text', chatId: '12345@g.us', text: 'test'};
  const send = (id, body=message) => fetch(`${base}/v1/messages`, {method: 'POST', headers: {...auth, 'Idempotency-Key': id}, body: JSON.stringify(body)});
  await t.test('concurrent duplicates result in one upstream send', async () => {
    const results = await Promise.all([send('send-0001'), send('send-0001')]);
    assert.ok(results.some(r => r.status === 201));
    assert.equal(sends, 1);
    assert.equal((await send('send-0001')).status, 200);
    assert.equal((await send('send-0001', {...message, text: 'different'})).status, 409);
    assert.equal(sends, 1);
  });
  await t.test('deduplication and webhook history survive restart', async () => {
    await stop();await start();
    assert.equal((await send('send-0001')).status, 200);
    assert.equal(sends, 1);
    assert.equal((await (await fetch(`${base}/v1/events`, {headers: auth})).json()).length, 1);
  });
  await t.test('unconfirmed deliveries are never automatically sent again', async () => {
    fail = true;
    assert.equal((await send('send-0002')).status, 502);
    assert.equal((await send('send-0002')).status, 409);
    assert.equal(sends, 2);
    await stop();await start();
    assert.equal((await send('send-0002')).status, 409);
    assert.equal(sends, 2);
  });
  await t.test('invalid targets, malformed JSON and missing idempotency rejected', async () => {
    assert.equal((await send('send-0003', {...message, chatId: '123@c.us'})).status, 400);
    assert.equal((await fetch(`${base}/v1/messages`, {method: 'POST', headers: auth, body: '{'})).status, 400);
    assert.equal((await fetch(`${base}/v1/messages`, {method: 'POST', headers: auth, body: JSON.stringify(message)})).status, 400);
    assert.equal(sends, 2);
  });
});
