# SuperSkope

Standalone, local WhatsApp integration service. WAHA handles the linked device; the hub provides an authenticated API and a persistent event/send log. Independent of any client application.

## Run on this Mac

```sh
cd /Users/ajaypawriya/Desktop/Projects/wa-hub
npm run up
npm run cli -- pair
npm run pairing
```

Management panel: http://localhost:3012. Pairing: http://localhost:3012/connect. WAHA dashboard: http://localhost:3010/dashboard (username `admin`, password `DASHBOARD_PASSWORD` in `.env`). Local API: http://localhost:3011. Permanent API: https://wa.ajaypawriya.com.

## SuperSkope dashboard

The local panel follows the inspected Periskope console's navigation, dark/light colors, Inter typography, and Settings layout. All 13 main tabs, 5 Logs tabs, and 25 Settings tabs are present. Unsupported features show Coming soon.

- **Settings → Scheduled Messages**: create, edit, pause/resume and delete text schedules; search, filter, sort, and switch between All / Upcoming / Completed.
- **Logs → API logs / Scheduled logs**: recorded send results, including skipped and unconfirmed deliveries.
- **Settings → Phones**: current connection, phone search/filter, and QR recovery.
- **Settings → Preferences**: persisted theme, navigation collapse, and AI shortcut visibility.
- **Settings → Integrations → API**: API address and authentication guidance.

Shared inbox, calls, tickets, analytics, bulk messaging, contacts, AI, rules and remaining settings are placeholders. Existing outbound API and incoming webhook functionality remain available independently of these screens.

Icons are self-hosted SVGs from `@phosphor-icons/core` 2.1.1 (MIT). `npm run icons` regenerates the small `public/icons.js` subset from the pinned development dependency. License: `public/licenses/phosphor.txt`. Inter's license is in `public/fonts/OFL.txt`. The existing `wa-hub` directory, service IDs, API hostname and private environment keys retain their technical names.

If the QR expires, click **Refresh connection**. This restarts failed/stopped sessions and waits for a new code. Connected sessions are left running. Reload an already-open pairing page after updating its code.

The dedicated Lima VM is `wa-hub`, with 2 CPUs, 2 GiB RAM, and a 20 GiB sparse disk. It starts automatically after macOS login. To start it manually:

```sh
~/.local/share/reel-bot-lima/bin/limactl start wa-hub
```

`scripts/runtime.sh` uses Docker if installed, otherwise the existing Lima binary on this Mac. Override `LIMA_BIN` on a different machine. New installs run `npm run setup` once before starting. Existing credentials are never overwritten. Docker images are version pinned. The services have no runtime npm dependencies. Playwright is installed as a development-only browser verification dependency.

## API

Use `Authorization: Bearer <HUB_API_KEY>` on every `/v1/*` request. Keep this key in the calling service's backend, never in frontend JavaScript.

| Endpoint | Result |
| --- | --- |
| `GET /healthz` | Hub process health, not WhatsApp connectivity |
| `GET /v1/status` | WhatsApp connection state |
| `GET /v1/groups` | Available WhatsApp groups |
| `POST /v1/groups` | Create a group with `subject` and `participants` |
| `GET /v1/groups/:id` | Current group metadata and member roles |
| `POST /v1/groups/:id/actions` | Change members, roles, name, description, photo or permissions |
| `GET /v1/group-actions` | Latest 100 group-action results |
| `GET /v1/commands` | Latest 100 mention-command results |
| `GET /v1/commands/config` | Command status and admin policy |
| `PUT /v1/commands/config` | Enable/disable commands with `{"enabled":true}` or `false` |
| `GET /v1/events` | Latest 50 signed events received from WAHA |
| `GET /v1/history` | Latest 100 sends and skipped occurrences |
| `GET /v1/schedules` | All schedules |
| `POST /v1/schedules` | Create a schedule |
| `PUT /v1/schedules/:id` | Edit a schedule |
| `PATCH /v1/schedules/:id/enabled` | Pause/resume with `{"enabled":false}` or `true` |
| `DELETE /v1/schedules/:id` | Delete a schedule, retaining its history |
| `POST /v1/messages` | Send text, a base64 PDF or a PNG/JPEG to a group |
| `POST /webhooks/waha` | Internal inbound events, SHA-512 HMAC required |

For a text message, send `{"type":"text","chatId":"123@g.us","text":"Hello"}`. For a PDF, use `{"type":"pdf","chatId":"123@g.us","filename":"test.pdf","data":"<base64 PDF>"}`. Images use `type:"image"` with PNG/JPEG base64 in `data`; attachments accept an optional `caption`. All sends require `Idempotency-Key` (8–128 letters, digits, `_`, or `-`). Reuse the same key when retrying the same operation. A key cannot be reused with different content.

Sends are limited to 10 per minute. If an upstream request fails after submission, its state is `unknown`: inspect WhatsApp before creating another send. Automatic retries could duplicate messages. `sent` means accepted by the engine; delivery/read receipts arrive via `message.ack` events.

## Group administration

Natural-language requests are enabled on this installation. Every sender must currently be an admin of the addressed group, and the linked SuperSkope account must also be an admin. Other admins select the linked number in WhatsApp's mention picker, then ask normally. From the linked number itself, address `SuperSkope` by name in the WhatsApp app. These are examples, not required syntax:

```text
SuperSkope, could you add +<country code><number> to this group?
SuperSkope, please make @member an admin.
SuperSkope, rename this group to Cooking team.
SuperSkope, put "Today's cooking updates" in the description.
SuperSkope, use this image as the group photo.
SuperSkope, let everyone send messages again.
SuperSkope, ab sirf admins ko message bhejne do.
```

Non-admin members who mention SuperSkope receive a preset reply: “Only group admins can use SuperSkope right now. Please ask a group admin to make you an admin, then try again.” Their request stays rejected, with no AI call or group action. Duplicate webhook events produce only one reply. Unrecognized senders receive no reply.

Every assistant response uses WhatsApp's typing indicator, including AI answers, action results, clarifications, preset admin-only replies and errors. Typing starts after identifying a current group member, refreshes during processing and stops when the response finishes or fails. Fast replies hold it for about 0.9 seconds. Presence requests have a short timeout and never prevent message delivery. Duplicate/ignored events do not start another typing cycle.

For a group photo, attach a PNG/JPEG to the request or reply to that photo. Current members can be resolved from known contact names, mentions or full phone numbers. Ambiguous people or requests get a short question; unfinished clarifications stay with the same group and admin for ten minutes. Address the bot again when answering. Requests can contain up to four related actions; execution stops on the first failed or uncertain change.

AI proposes structured actions; server-side validation and fresh group-admin checks control execution. It cannot select another destination, invent a phone number, change its own membership/admin role, or remove/demote the group creator. Forwarded, stale and API-originated messages are ignored. Duplicate webhook events execute once. Unknown outcomes are never automatically retried.

Understanding uses `openai/gpt-5.4-mini` through the existing Vercel AI Gateway account. SuperSkope has its own private `data/gateway.key`, copied without changing the original connection. This file is ignored by Git and must be preserved when moving hosts. New installs can use `AI_GATEWAY_API_KEY`; `AI_COMMAND_MODEL` overrides the model. No key is returned through the API. Only the addressed group's context and that admin's unfinished clarification are sent to the model; unrelated contacts and chat history are excluded. Provider failure makes no group changes. The service uses [AI Gateway structured outputs](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs), then validates the response independently.

The authenticated group-action API accepts `{"action":"add|remove|promote|demote","participants":["919999999999@c.us"]}`, `{"action":"subject","subject":"…"}`, `{"action":"description","description":"…"}`, `{"action":"messages-admin-only|info-admin-only","adminsOnly":true}`, `{"action":"picture","data":"<base64 PNG/JPEG>"}`, or `{"action":"remove-picture"}`. Choose one action from each `|`-separated list. Group creation and mutations require `Idempotency-Key`. The API key grants trusted backend access; WhatsApp sender-role checks apply to mention commands.

WAHA must deliver both `message` and `message.any` events to the signed webhook so commands from the linked phone can be processed. This installation already has both configured. The UI for these features is deferred.

## Dietboite client

The sibling Dietboite project now has server-side connection settings and explicit cooking-text / packing-PDF send controls. Its local configuration maps to the approved SuperSkope test groups. The key stays in private server storage; the browser submits a plan ID and revision, never arbitrary message content or a destination. Before sending, Dietboite refreshes source data and rejects a changed or failed plan. Confirmed deliveries are deduplicated, and unknown outcomes block automatic resending. This client integration has not been deployed to Dietboite production.

## Local state and exposure

- `.env`: generated keys and dashboard password, mode 0600, ignored by Git.
- `sessions/`, `media/`: persistent WAHA state, ignored by Git.
- `data/hub.sqlite`: signed incoming events and send history, ignored by Git.
- Ports 3010/3011 are published on loopback only. The pairing page also binds only to loopback.
- The permanent tunnel exposes **only port 3011** at https://wa.ajaypawriya.com. The dashboard and panel stay local. The old temporary tunnel has been stopped. Cloudflare tunnel ID: `b2c6f709-b29e-4fb7-af9f-16f982414a00`; its non-secret metadata is in `data/tunnel.json`.
- macOS LaunchAgents supervise the runtime, local panel, and permanent tunnel. They start after login and restart if their processes exit. `caffeinate -s` keeps the system awake on AC power; it does not override lid-close sleep or power loss. The Mac needs to stay powered, logged in, online, and open (or in a supported clamshell setup).
- Text schedules support once, daily, weekdays, and weekly in an IANA time zone. Shared inbox, per-client API keys, scheduled attachments, and downstream webhook subscriptions are not part of this increment.
- Unofficial linked-device access can break or be restricted by WhatsApp. Rate limits cannot guarantee protection from account restrictions.

## Verification

`npm test` passes 29 checks covering authentication, signatures, pairing recovery, duplicate prevention, schedule persistence, pause/edit/delete, safe retries, missed sends, DST/weekday recurrence, current-admin authorization, AI output validation, private clarification context, LID member resolution and partial/uncertain group-action failures. Automated tests use a local fake engine and send nothing to WhatsApp. Ten live-model checks covered natural requests, Hindi/Hinglish, multiple actions, negations, ambiguous pronouns, quoted descriptions and requests outside the current group; those interpretation checks sent no WhatsApp actions. Browser verification against the running panel created, edited, and deleted a paused schedule. Production HTTPS verification also confirmed a paused schedule survives a hub restart. All verification schedules were removed.

Live test target authorized by the user on Mon 16 Nov 2026: **purvi c-403**. Send one clearly labelled test text and one test PDF only after linking and matching that group. Ask the user to reply in that group to verify the incoming-message webhook.

Run `node scripts/smoke-send.mjs` after linking. It requires exactly one matching group and uses persistent idempotency keys, so restarting the test does not send confirmed messages again. To test through the tunnel, set `HUB_URL=https://wa.ajaypawriya.com` for that command. The test attachment is `output/pdf/wa-hub-test.pdf`.

Upstream: https://waha.devlike.pro/docs/how-to/install/ and https://waha.devlike.pro/docs/how-to/events/.

## Live test status, Mon 16 Nov 2026

- Phone linked successfully after fixing expired-session recovery in the pairing page.
- The text and PDF were accepted by WAHA for the exact matching group **Purvi C-403**, through the temporary HTTPS tunnel (now replaced by the permanent endpoint).
- The user confirmed both the text and PDF appeared in the group. The signed incoming-message webhook recorded the group's reply, `test received`, at 11:57:24 IST. Sending through HTTPS and receiving through the webhook are verified end to end.
- The pairing recovery regression checks failed/stopped sessions, concurrent refreshes, connected-session preservation, and rejection of cross-origin restart requests.
- The user also authorized new test groups. **SuperSkope Test · Cooking** and **SuperSkope Test · Packing** were created with only the linked account. A clearly labelled synthetic cooking text and packing PDF were accepted through the permanent API from the Dietboite adapter. Private IDs and delivery keys are stored in ignored local data.
- In the cooking test group, description, photo, info permissions and message permissions were changed successfully and checked through fresh metadata. Message permissions were restored to everyone. No unrelated group membership or settings were changed.
- The requested test number was added to both groups and membership was verified. It is a regular member; no admin role was granted. Member add is live-tested; remove/promote/demote and current-admin authorization are covered by automated tests.
- The user confirmed the earlier help reply from the linked WhatsApp app. After replacing the parser, a signed synthetic natural-language request ran through the live AI worker, changed the cooking test-group description, and sent its confirmation reply. Fresh metadata verified the change; the original description was restored and verified. A request from a second real group admin has not yet been checked.

## Scheduling behavior

Create a schedule from the local panel, or POST this JSON to the permanent API with your bearer key:

```json
{
  "name": "Morning update",
  "chatId": "YOUR_GROUP_ID@g.us",
  "groupName": "Your group",
  "text": "Good morning. Here is the update.",
  "timezone": "Asia/Kolkata",
  "startLocal": "2026-11-17T08:00",
  "frequency": "daily",
  "enabled": true
}
```

Use a future first-send time. `frequency` accepts `once`, `daily`, `weekdays`, or `weekly`; weekly repeats on the first-send weekday. `enabled:false` saves it paused. The worker checks due work every five seconds.

- Scheduled messages keep their local wall-clock time across daylight-saving changes. Nonexistent first-send times are rejected; future nonexistent occurrences are skipped. An ambiguous repeated hour uses its first occurrence.
- If WhatsApp is disconnected or the engine/rate limit is unavailable before submission, retry until 15 minutes after the due time. Older occurrences are logged as skipped. Recurring schedules advance to the next future occurrence; missed messages are never sent in a burst.
- After submission, an uncertain result is never automatically retried. Check WhatsApp before creating a replacement. `Sent` in history means accepted by the sending engine, not independently confirmed recipient delivery.
- Pausing prevents future submissions; an already-submitted message may still complete. Editing/deleting is blocked while a send is being processed. Resume advances an overdue recurring schedule to its next future time. An expired one-off needs editing to a new future time.
- The panel submits through a local server proxy. It never puts your bearer key in browser JavaScript, and rejects cross-origin writes.

## Startup and maintenance

`npm run install-startup` installs these user services without modifying existing environment credentials:

- `~/Library/LaunchAgents/com.wahub.runtime.plist`: keeps the dedicated Lima VM and Docker services running.
- `~/Library/LaunchAgents/com.wahub.panel.plist`: local panel and connection recovery.
- `~/Library/LaunchAgents/com.wahub.tunnel.plist`: permanent Cloudflare tunnel.

Logs are in `data/logs/`. They do not contain the API key. Cloudflare authentication uses the existing cf CLI profile. Container logs rotate at 10 MB, three files. A consistent pre-scheduler database backup is saved under `data/backups/`; this is not a recurring backup service.

To update backend source, run `sh scripts/runtime.sh restart hub`. Static panel assets reload on browser refresh. Pairing/proxy code changes require `launchctl kickstart -k gui/$(id -u)/com.wahub.panel`.

To intentionally stop the service, first unload its LaunchAgents with `launchctl bootout gui/$(id -u)/com.wahub.runtime`, and the corresponding `panel` and `tunnel` labels, then run `npm run down`. Otherwise supervision will restart it. Removing the three plist files disables startup for future logins.

Verification on Mon 16 Nov 2026: the panel recovered from process termination; WAHA restarted and reconnected without another QR scan; the API persisted a paused schedule across a restart; permanent HTTPS returned 200 for health and authenticated API requests, and 401 for anonymous private routes. No Mac reboot was performed.
