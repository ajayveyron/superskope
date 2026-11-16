# Message actions and advanced schedules

Implemented locally on Mon 16 Nov 2026. Activation on the running hub and panel is pending production approval. The isolated review panel is http://localhost:3013; it uses a fake engine and a disabled scheduler. The existing live panel remains http://localhost:3012.

## Message actions

Open **Logs → API logs** or **Logs → Scheduled logs** and use the action control beside a sent message. Available operations: edit text/caption, delete for everyone, forward to a group, add/remove your reaction, pin for 1/7/30 days, and unpin. Editing or deleting does not rewrite the original send-history record. The action result is recorded separately.

The control appears only when a confirmed send has a usable WhatsApp message ID. Messages outside send history can be addressed through the authenticated API with their full native message ID; there is still no chat inbox. Destinations remain groups. This increment does not add actions to the natural-language admin bot.

| API | Behavior |
| --- | --- |
| `GET /v1/capabilities` | Reports `advancedSchedules` and `messageActions` support. |
| `POST /v1/message-actions` | Applies one native message action. Requires bearer auth and `Idempotency-Key`. |
| `GET /v1/message-actions` | Latest 100 action results, including failed and unknown outcomes. |

All action bodies contain `chatId`, `messageId` and `action`. The full message ID must belong to the source group.

| Action | Additional fields |
| --- | --- |
| `edit` | `text` (1–4,000 characters); only messages from the linked account. WhatsApp also enforces its editing window and caption limits. |
| `delete` | None. Requests deletion for everyone; native ownership/admin permissions apply. |
| `forward` | `targetChatId`, another group ID. |
| `react` | `reaction`, one emoji or `""` to remove the linked account's reaction. |
| `pin` | `days`: 1, 7 or 30, default 7. |
| `unpin` | None. |

Example body:

```json
{
  "chatId": "123@g.us",
  "messageId": "true_123@g.us_MESSAGE_ID",
  "action": "pin",
  "days": 7
}
```

An action transitions from `running` to `completed`, `failed` or `unknown`. Completed keys replay the saved result; reused keys with different content are rejected. Failed, running and unknown keys never submit the operation again. A restart marks interrupted actions unknown. No automatic action retries occur. A network failure after clicking an action locks that form and asks the operator to inspect WhatsApp.

Limits: 10 actions per minute. Forwarding also counts against the existing shared 10-send-per-minute quota. `completed` means the engine accepted the action, not independent recipient-device verification. Group permissions, WhatsApp message-age restrictions and engine support may reject an operation.

Native contracts: [WAHA chat operations](https://waha.devlike.pro/docs/how-to/chats/) and [forwarding/reactions](https://waha.devlike.pro/docs/how-to/send-messages/). Pin duration is passed in seconds; reactions use PUT.

## Advanced schedules

The existing schedule editor now accepts text, PDFs and PNG/JPEG images. Attachments are limited to 5 MiB and captions to 1,000 characters. Video, audio and other document types are not added. Attachment bytes stay in the private SQLite database and are omitted from list/save responses. Editing without selecting another attachment preserves the stored file; switching to text removes it from the schedule.

Existing `POST /v1/schedules` and `PUT /v1/schedules/:id` bodies remain valid. These optional fields extend them:

| Field | Meaning |
| --- | --- |
| `type` | `text` (default), `pdf`, or `image`. |
| `data` | Base64 attachment for a new/replacement file. Omit on an edit to keep the current attachment of the same type. |
| `filename` | Required for a PDF; images receive a format-appropriate filename. |
| `text` | Message text, or optional attachment caption. |
| `frequency` | `once`, `daily`, `weekdays`, `weekly`, or `monthly`. |
| `interval` | Integer 1–365, default 1; counts calendar days, weeks or months. Once requires 1. |
| `weekdays` | Optional unique weekday numbers (Sunday 0 through Saturday 6), for daily or weekly schedules. |
| `monthDays` | Optional unique dates 1–31 for monthly schedules. Defaults to the start date's day. |
| `endDate` | Optional `YYYY-MM-DD`, inclusive in the schedule's time zone. |

Intervals are anchored to `startLocal`. Weekly intervals use Monday-based calendar weeks containing that anchor. `daily` uses every N calendar days, then the selected weekday filter. `weekdays` uses every N calendar days restricted to Monday–Friday; it does not count N business days. Default weekly recurrence uses the start weekday. A monthly date absent from a month is skipped, never clamped to its last day. The first send must fall on a selected repeat day.

The end date cannot precede the start date. No occurrence is generated after the end date. Resuming an expired series requires editing its dates. Existing time-zone/DST, missed-send and unknown-outcome behavior remains intact. The first nonexistent DST time is rejected; later nonexistent occurrences are skipped; repeated hours use the first occurrence.

Example scheduled PDF, paused for review:

```json
{
  "name": "Packing instructions",
  "chatId": "123@g.us",
  "groupName": "Packing",
  "type": "pdf",
  "filename": "packing.pdf",
  "data": "<base64 PDF>",
  "text": "Packing instructions attached.",
  "timezone": "Asia/Kolkata",
  "startLocal": "2027-01-15T08:00",
  "frequency": "monthly",
  "interval": 2,
  "monthDays": [15, 31],
  "endDate": "2027-07-31",
  "enabled": false
}
```

`POST /v1/schedules/:id/skip` accepts `{"expectedNextRun":"<next_run from schedule>"}`. It skips exactly that occurrence and records the result. A stale/repeated request returns 409, so a double click cannot skip a second date. Skipping a one-off completes it without sending. A paused series remains paused. An in-flight occurrence cannot be skipped. Editing still defines a new start/recurrence anchor using the date shown in the editor.

API responses include `message_type`, `filename`, `has_attachment`, `repeat_interval`, `weekdays`, `month_days`, and `end_date`. Existing fields are retained. `/v1/history` additionally returns `message_id` when available.

## Verification and rollout

- All 51 backend tests passed, including legacy-schema migration, time zones/DST, missing month dates, interval anchoring, inclusive end dates, attachment persistence, private list responses, skip races, action scope and quota checks, and restart-safe duplicate prevention.
- Isolated browser checks passed for PDF create/edit/retention, monthly intervals and end date, skip-next, all six action choices, unknown-outcome locking, forwarding empty/error/reload states, and the old-backend capability guard. No browser console errors were observed in the main workflow.
- Default desktop viewport inspected; the user's browser was not resized. Screenshots are in ignored `output/feature-actions-schedules/`.
- Existing live WhatsApp services, credentials, session state and customer records were not changed. No real test messages or group mutations were sent for this increment.
- Restarting the running hub applies additive schema migrations. Restarting the panel enables the expanded proxy routes/body limit. New controls are gated by server capability detection until both are available. Activation requires the task's production approval. No cloud migration is involved.
