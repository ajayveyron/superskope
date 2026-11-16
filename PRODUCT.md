# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Existing Node.js HTTP servers, SQLite, plain HTML/CSS/JavaScript, WAHA in Docker on a dedicated Lima VM.

## Users
Ajay operates WhatsApp groups and wants local and hosted applications to use one independent messaging service.

## Product Purpose
Build an internal Periskope alternative feature by feature, beginning with reliable WhatsApp connectivity and scheduled group messages.

## Operating Context
Runs on Ajay's always-on Mac. The management panel is local; authenticated HTTPS endpoints serve other applications. This project is separate from dietboite.

## Capabilities and Constraints
Text and PDF sending and signed incoming events are live-tested. This increment adds login startup, a permanent API hostname, text schedules, recurrence, and send history. Never silently duplicate an uncertain delivery. Existing credentials and WhatsApp session data must be preserved.

Group admins address SuperSkope naturally. AI interprets the request; server-side validation, current-admin authorization and idempotency control execution. No command grammar is required. Unclear requests get a short clarification. The current implementation uses GPT-5.4 mini through Vercel AI Gateway with private server credentials.

## Brand Commitments
SuperSkope. Match the inspected Periskope console: colors, typography, layout, tabs and settings structure. Use Phosphor icons throughout, semantic color tokens and minimal copy. Unsupported features have explicit Coming soon states.

## Product Principles
- Keep operators in control of what is scheduled and where it goes.
- Persist work across restarts.
- Show skipped or uncertain sends honestly.
- Keep account credentials on the server.
