# SquadSlot

SquadSlot is a self-hosted gaming calendar for friend groups. It helps a squad share availability, search Steam for games, create session invites, respond to invites, and post updates into Discord.

## Features

- Account registration and login with signed HTTP-only cookies
- First registered account automatically becomes the admin
- Shared weekly calendar with previous/next week navigation
- Dashboard and Tonight mode
- One-off and recurring availability with multi-day drag selection, date exceptions, and quick presets
- Best-time finder with overlap highlighting
- Steam-backed game search and game detail lookup
- Session creation with friend invites and player capacity
- Multi-game voting with random tie resolution
- Event comments and calendar export
- Invite responses: accept, tentative, decline
- Events page for created, accepted, and tentative sessions
- Profiles with avatars, timezone, Discord username, preferences, themes, and accent colours
- Admin-only account role management
- Admin-managed Discord webhook settings
- Configurable Discord reminders and weekly summaries
- Admin JSON backup and restore
- Optional Discord channel updates
- Installable PWA for desktop and mobile home screens
- Single Docker container with SQLite persistence

## Quick Start With Docker

Clone or copy the project onto your server, then from the project folder run:

```bash
cp .env.example .env
nano .env
docker compose up --build -d
```

SquadSlot will be available at:

```text
http://localhost:8080
```

SQLite data is stored in the `squadslot-data` Docker volume at:

```text
/data/squadslot.db
```

If the container keeps restarting, check the startup error first:

```bash
docker compose ps
docker compose logs --tail=120 squadslot
```

Common causes are:

- `SESSION_SECRET` is missing or shorter than 32 characters in `.env`.
- A host bind mount is being used for `/data` and the container cannot write to it. Either use the included named volume or make the host folder writable by the container user.
- `APP_URL` does not match the public URL when running behind a reverse proxy.

## First Login

No demo users are created.

Open the site and create the first account. That first account becomes the admin automatically. Later users are normal users unless an admin promotes them.

## Required Production Settings

Before exposing the app publicly, set these values in `.env`:

```bash
SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters
APP_URL=https://calendar.yourdomain.com
TZ=Europe/London
```

Use a long random value for `SESSION_SECRET`. The container will refuse to start in production if the secret is missing or too short.

If SquadSlot is behind a reverse proxy such as Nginx, Caddy, Cloudflare Tunnel, or Traefik, set:

```bash
TRUST_PROXY=1
```

## Discord Updates

SquadSlot can post updates to a Discord channel through a webhook. This does not require a full Discord bot token or gateway process.

Events that can post to Discord:

- availability added
- availability removed
- game suggested
- session invite created
- invite response changed
- session reaches its minimum player count
- session removed
- event tomorrow
- event starting in one hour
- RSVP deadline
- weekly availability summary

Create a webhook in Discord:

1. Open the target Discord channel.
2. Choose `Edit Channel`.
3. Open `Integrations`.
4. Create a webhook.
5. Copy the webhook URL.

Then either set it in `.env`:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-url
DISCORD_BOT_NAME=SquadSlot
```

Or sign in as an admin and save it from the Admin page. The Admin page also has a `Send test` button and notification rules for choosing which Discord updates are posted. Each notification has editable title/message templates with variables such as `{actor}`, `{date}`, `{title}`, `{game}`, and `{status}`.

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend and API together:

```bash
npm run dev
```

Run the admin settings smoke test:

```bash
npm test
```

The Vite frontend runs on:

```text
http://localhost:5173
```

The Express API runs on:

```text
http://localhost:8080
```

## Production Build Without Docker

```bash
npm install
npm run build
npm start
```

Useful environment variables:

```bash
PORT=8080
DATABASE_PATH=/data/squadslot.db
SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters
APP_URL=https://calendar.yourdomain.com
DISCORD_WEBHOOK_URL=
DISCORD_BOT_NAME=SquadSlot
TRUST_PROXY=1
```

## Security Notes

- `SESSION_SECRET` is required in production and must be at least 32 characters.
- Mutating API requests require `application/json` and a same-origin `Origin` or `Referer` header in production.
- Discord webhook URLs are validated so the server only posts to Discord webhook endpoints.
- Auth endpoints include basic in-memory rate limiting.
- The app sends common security headers including CSP, frame blocking, referrer policy, and content-type sniffing protection.
- If you intentionally need to clear old seeded demo data from a development database, start once with `SQUADSLOT_CLEAN_DEMO_DATA=true`. It is off by default to avoid accidental data loss.

## Updating

Pull or copy the latest project files, then rebuild the container:

```bash
docker compose down
docker compose up --build -d
```

The Docker volume keeps the SQLite database between rebuilds.

## Backups

Admins can export and restore backup JSON files from the Admin page.

The backup includes:

- accounts
- bcrypt password hashes, not plaintext passwords
- availability/free-time entries
- recurring availability rules, exceptions, and presets
- events
- invite responses
- event game options, votes, comments, and capacity
- profiles and appearance preferences
- recent game suggestions
- app settings
- Discord webhook configuration
- Discord notification rules
- reminder delivery history

Because password hashes are included, restored users can keep signing in with their existing passwords. Store backup files privately, especially if they contain a Discord webhook URL.

## Notes

Steam search uses public Steam store endpoints from the server side. If Steam is temporarily unavailable, the app still loads and the game list simply appears empty until a later search succeeds.
