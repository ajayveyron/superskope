import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
for (const dir of ['data', 'sessions', 'media']) mkdirSync(dir, { recursive: true, mode: 0o700 });
if (existsSync('.env')) {
  console.log('Existing .env preserved.');
} else {
  const key = randomBytes(32).toString('hex');
  writeFileSync('.env', [
    `WAHA_API_KEY=${key}`,
    `WAHA_API_KEY_HASH=sha512:${createHash('sha512').update(key).digest('hex')}`,
    `HUB_API_KEY=${randomBytes(32).toString('hex')}`,
    `WEBHOOK_SECRET=${randomBytes(32).toString('hex')}`,
    `DASHBOARD_PASSWORD=${randomBytes(24).toString('hex')}`,
    '',
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  console.log('Created local credentials in .env (owner access only).');
}
