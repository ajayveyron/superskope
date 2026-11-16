# SuperSkope development

Updated Mon 16 Nov 2026. Canonical project folder: `/Users/ajaypawriya/Desktop/Projects/wa-hub`.

## Running and verified

- WAHA NOWEB on a dedicated Lima VM; persistent linked session, files and SQLite data.
- Authenticated text/PDF API, signed inbound webhooks, idempotent delivery, persistent scheduling and history.
- Permanent API: `https://wa.ajaypawriya.com`. Local API: 3011. Local management panel: 3012. WAHA engine: 3010.
- macOS startup agents keep the VM, panel and Cloudflare tunnel running after login. The Mac must stay awake and online.
- SuperSkope dashboard uses the inspected Periskope layout/colors, Phosphor icons and Inter. Most inbox/CRM modules are Coming soon. Building a chat inbox is explicitly deferred.

## Group administration and Dietboite integration

The user prioritized group administration through WhatsApp mentions and Dietboite's explicit cooking-message / packing-PDF send buttons.

- Group-action APIs and the AI request worker are running. All 29 backend tests pass. Description, photo, info permissions, message permissions and member additions were changed and verified in approved test groups. Real remove/promote/demote changes remain untested; their authorization is covered by automated tests.
- Commands require current group-admin membership. The user explicitly chose all admins of the addressed group, rather than a fixed operator allowlist. Non-admin members now receive a preset message explaining that they must ask a group admin for admin access. Their request remains rejected before AI interpretation or group changes; duplicate events do not duplicate the reply. Unknown/non-member senders still receive no reply.
- The current linked phone stays in use. Other admins mention it; the owner uses a `SuperSkope …` prefix from the WhatsApp app. Outgoing API messages must not trigger command loops.
- All assistant response paths now share a typing lifecycle: AI answers/actions/clarifications, preset refusals and error replies. Presence starts for recognized group members, refreshes every seven seconds while processing and stops in cleanup even after failures. Fast replies show it for about 0.9 seconds. Presence calls are best-effort with three-second timeouts, so indicator failures do not prevent replies. Unknown/ignored/duplicate events do not produce extra presence activity.
- Both approved test groups exist: `SuperSkope Test · Cooking` and `SuperSkope Test · Packing`. The user-requested number ending 0502 was added to both and membership was verified. It remains a regular member; do not promote it without an explicit request. Private group IDs are in ignored `data/test-groups.json`; its creation snapshots are historical, so inspect the live API for current membership. Packing initially rejected the addition with `rate-overlimit`; logs confirmed the rejection and a fresh membership read confirmed absence before a later successful attempt. Original uncertain records are retained and must not be replayed.
- The user rejected a rigid command grammar. The worker now uses GPT-5.4 mini through the existing Vercel AI Gateway account to interpret ordinary language, Hindi/Hinglish and related multiple actions. Structured output is validated before execution; only current-group actions and known member references or supplied phone numbers can be used. Ambiguity creates a private ten-minute clarification context for the same group/admin. The fixed parser and command-list help were removed.
- AI credentials are in the ignored, owner-readable `data/gateway.key`, copied from the existing connection without modifying the original key or environment files. This file must move with private service data during a cloud migration. Compose supports optional `AI_GATEWAY_API_KEY` and `AI_COMMAND_MODEL` overrides. The API reports AI readiness/model, never the key.
- Ten live-model interpretation checks passed. The lightweight model was rejected after failing negation/scope checks; the selected model passed the final cases. A signed synthetic test request traversed the running worker, live AI and real WhatsApp action/reply: the cooking test-group description changed exactly as requested, then was restored and verified. The user also confirmed receipt of the earlier fixed-parser help reply from their linked WhatsApp app. A real second-admin natural-language request remains to be checked after that participant is explicitly given admin access.
- Dietboite's server-side adapter, connection settings, group mapping and explicit cooking/PDF buttons are implemented locally. Source freshness and reviewed revisions are checked before sending. Delivery records prevent duplicate clicks and block unknown outcomes; confirmed parts are skipped on safe partial retries. Private credentials and generated attachments remain server-side.
- Targeted Dietboite tests (15), typecheck and production build passed. Browser checks passed for group mapping, absent API-key values, persisted Sent states and explicit send request bodies, with no browser errors. A synthetic cooking text and packing PDF were accepted by the permanent SuperSkope API into the separate approved test groups. UI checks use an isolated fixture database under the sibling project's ignored `artifacts/superskope-check/`; they do not alter actual customers or source sheets. This does not mean Dietboite production is deployed or configured.
- Local Dietboite connection settings currently point to the test groups. Actual cooking/packing groups still need to be selected in Connections when ready. Interrupted delivery states require inspection; there is no automatic reconciliation UI yet.
- Do not change existing Dietboite manual edits or deploy that application without the applicable production approval.

## Cloud research request

The user requested a separate T3 thread to explain how to deploy SuperSkope to the cloud, fully remove the always-on Mac dependency, and compare costs with the least expensive options first. Research and recommendations only; do not provision, purchase or migrate yet. Inspect the actual compose/services/storage requirements and verify current provider prices. Include genuinely usable free options and their limits, the cheapest credible paid option, recurring storage/backups/network/IP costs, and a safe migration that never runs two active senders against the same WhatsApp session.

The existing standalone folder is registered as the **SuperSkope** T3 project. The separate research thread has completed and saved `docs/cloud-hosting-options.html`. Infrastructure still runs on this Mac; no cloud migration has been performed.
