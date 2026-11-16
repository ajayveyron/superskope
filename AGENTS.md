# SuperSkope

Standalone WhatsApp operations service. This repository is separate from Dietboite; Dietboite is a client application in the sibling `dietboite` folder.

Read `README.md`, `PRODUCT.md`, `DESIGN.md`, and `docs/DEVELOPMENT.md` before changing behavior. Preserve uncommitted work. The repository currently has no initial commit; do not commit or push unless requested.

- Product name: **SuperSkope**. Existing infrastructure names (`wa-hub`, ports, credentials) are intentionally retained.
- Plain Node.js modules, SQLite, static HTML/CSS/JS. No frontend build step. Phosphor icons and Inter are self-hosted.
- Run `npm test` for backend changes. Verify changed UI using the running panel at http://localhost:3012. Do not resize the user's browser.
- Never print or overwrite credentials, linked-device sessions, or customer data. `.env`, `data`, `sessions`, and `media` are private and ignored.
- Real WhatsApp messages and group changes need task authorization. Use explicitly approved test groups for verification; never change unrelated groups.
- A delivery or group action with an uncertain result must not be retried automatically.
- Group commands are limited to current group admins and only affect the group where the command was issued.
- Production changes require one approval per task. Read-only research and local reversible implementation can proceed. Never buy hosting or deploy as a side effect of a research request.
- Use `gh` for GitHub and `cf` for Cloudflare. Keep this Mac's current services running unless changing them is part of the authorized task.
- Report the preview URL, material limits, and committed/pushed/deployed state when handing back code changes.

Current host processes and containers are described in README. A separate cloud-cost research thread may read this repository while feature work continues; coordinate through `docs/DEVELOPMENT.md` and avoid overwriting in-progress changes.
