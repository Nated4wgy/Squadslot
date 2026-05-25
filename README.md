# SquadSlot

SquadSlot is a self-hosted gaming calendar for friend groups. It helps a squad share availability, search Steam for games, create session invites, respond to invites, and post updates into Discord.

## Features

- Account registration and login with signed HTTP-only cookies
- First registered account automatically becomes the admin
- Shared weekly calendar with previous/next week navigation
- Availability logging
- Steam-backed game search and game detail lookup
- Session creation with friend invites
- Invite responses: accept, tentative, decline
- Events page for created, accepted, and tentative sessions
- Admin-only account role management
- Admin-managed Discord webhook settings
- Optional Discord channel updates
- Single Docker container with SQLite persistence

## Quick Start With Docker

Clone or copy the project onto your server, then from the project folder run:

```bash
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

## First Login

No demo users are created.

Open the site and create the first account. That first account becomes the admin automatically. Later users are normal users unless an admin promotes them.

## Required Production Settings

Before exposing the app publicly, edit `docker-compose.yml` and change:

```yaml
SESSION_SECRET: change-this-long-random-secret
APP_URL: https://calendar.yourdomain.com
```

Use a long random value for `SESSION_SECRET`.

## Discord Updates

SquadSlot can post updates to a Discord channel through a webhook. This does not require a full Discord bot token or gateway process.

Events that can post to Discord:

- availability added
- game suggested
- session invite created
- session removed

Create a webhook in Discord:

1. Open the target Discord channel.
2. Choose `Edit Channel`.
3. Open `Integrations`.
4. Create a webhook.
5. Copy the webhook URL.

Then either set it in `docker-compose.yml`:

```yaml
DISCORD_WEBHOOK_URL: https://discord.com/api/webhooks/your-webhook-url
DISCORD_BOT_NAME: SquadSlot
```

Or sign in as an admin and save it from the Admin page.

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend and API together:

```bash
npm run dev
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
SESSION_SECRET=change-this-long-random-secret
APP_URL=https://calendar.yourdomain.com
DISCORD_WEBHOOK_URL=
DISCORD_BOT_NAME=SquadSlot
```

## Updating

Pull or copy the latest project files, then rebuild the container:

```bash
docker compose down
docker compose up --build -d
```

The Docker volume keeps the SQLite database between rebuilds.

## Notes

Steam search uses public Steam store endpoints from the server side. If Steam is temporarily unavailable, the app still loads and the game list simply appears empty until a later search succeeds.
