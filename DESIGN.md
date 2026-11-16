# SuperSkope interface reference

The user requested a 1:1 visual recreation of Periskope, including its colors and all tabs. The current logged-in console in Dia is the primary reference; older public documentation is secondary.

## Fidelity contract

- Evidence: `https://console.periskope.app/dashboard` observed in Dia on Mon 16 Nov 2026, dark theme, expanded sidebar. Public scheduled-log and editor screenshots are saved privately under `data/references/`. Both public CSS theme token sets and Inter font declarations were inspected. The public documentation screenshots use an older collapsed rail.
- Shell: expanded sidebar about 240 px; workspace switcher 64 px; navigation items 40 px, 24 px icons; thin gray section separators. Header about 56 px, compact breadcrumb, wide search, bordered icon actions and connection indicator. Sidebar footer contains local profile, theme and collapse controls.
- Main tabs, in reference order: Dashboard; Chats; Calls; Tickets; Analytics; Chat List; Bulk Messages; Contacts; Media; AI; Automation Rules; Logs; Settings.
- Colors: match the observed Periskope tokens. Light: white, foreground #141414, muted #f5f5f5, borders #e5e7eb, secondary text #4b5563, green #15803d. Dark: background #141414, foreground #f3f4f6, muted #262626, borders #363636, secondary text #949494, active green #0eac52. Dashboard background is the translucent muted surface over the base.
- Typography: self-hosted Inter, 14 px normal UI text, 16 px sidebar items, medium/semibold hierarchy. Preserve compact control radii and table density.
- Behavior: navigation, light/dark mode, sidebar collapse, schedule search/filter, create/edit/pause/resume/delete, send history and pairing are real. Unimplemented product modules retain their tabs and open an explicit Coming soon state. Never copy another workspace's customer records, counts or branding into this app.
- Editor: focused native dialog with gray outline, separate heading/body/footer, green submit, neutral cancel. Fields reflect the supported schedule API; unsupported recurrence options must not appear functional.
- Motion: not measured; no inferred animation sequence. Immediate state transitions, native focus and reduced-motion support.
- Acceptance: verify every navigation target, persistence of theme/collapse, responsive overflow, keyboard dialog handling, paused schedule create/edit/delete, filter reset, history and connected-phone state. Keep the panel and permanent API running.

## Current console observations

Inspected Dashboard, Chats, Logs, Preferences, Scheduled Messages and Phones in the logged-in Dia session on Mon 16 Nov 2026. Settings uses a grouped secondary sidebar (Plans and Usage, User, Organization, Integrations). Message creation and management belong under Settings → Scheduled Messages; Logs → Scheduled logs is delivery history. The schedule view has All / Upcoming / Completed scopes. Chats has an Inbox pane and a separate conversation canvas.

These observed structures are preserved. Actual data comes from the local hub; unsupported modules retain an explicit Coming soon state. The schedule editor reflects supported text recurrence rather than implying unsupported features. Logo and product name are SuperSkope. All interface icons use Phosphor regular SVGs at the user's request, an intentional difference from Periskope's icon family. Existing theme/sidebar preference keys are preserved so the rebrand does not reset saved choices.

## REA assessment

Reviewed the official `morluto/rea` README, browser-observation guide and reverse-engineer-anything skill. REA can capture DOM/accessibility information, record interactions and compare screenshots or recorded states. Its AgentEnv export serves behavior observed in a recording; it does not produce a complete production application or prove full feature parity.

Recommendation: use selectively for future inbox/rules interaction studies. The current visual pass already has reference captures, CSS tokens and browser checks. Installing the skill alone does not provide REA tools. Version 6.9.0 requires a supported Node runtime (the current 24.21.0 is below its 24.22.1 minimum) and browser capture needs a CDP connection; attachment to the current Dia session is unverified. REA was assessed, not installed.

Sources: https://github.com/morluto/rea and https://github.com/morluto/rea/blob/main/docs/guides/web/browser-observation.md
