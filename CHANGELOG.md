# Changelog

Significant SquadSlot changes are recorded here by release date.

## 2026-06-28 - Account Recovery And Responsive Layouts

### New Features

- Added administrator-managed temporary password resets for user accounts.
- Added a mandatory password replacement screen after an administrator reset.
- Added account status indicators when a user is waiting to replace a temporary password.

### Improvements

- Accepted invitations now disappear from Invites and are managed from Events.
- Events disappear from the active Events, Calendar, Dashboard, and invite views after their end time.
- Historical events remain in backups instead of being deleted from SQLite.

### Responsive Fixes

- Rebuilt tablet navigation so labels keep their width inside a contained horizontal scroller.
- Removed tablet grid minimums that caused panels to collide in portrait orientation.
- Added stable phone header rows, text containment, and compact action layouts.
- Fixed excess header height and layout shifts when rotating an iPad between orientations.

### Security

- Password resets invalidate all existing sessions for the affected account.
- Temporary-password sessions can only change the password or sign out.
- Users must choose a different password before accessing SquadSlot again.

## 2026-06-09 - Live Calendars And Availability Improvements

### New Features

- Added private live calendar subscriptions for Apple Calendar, Google Calendar, and Outlook.
- Added per-account subscription generation, copy, subscribe, regeneration, and revocation controls.
- Added stable calendar event identifiers, modification timestamps, confirmed/tentative status, and refresh metadata.
- Added free-time entries to downloaded and subscribed calendars.
- Added privacy-filtered overlap entries that name other players only when they are free during the subscriber's own availability.
- Added multi-day drag selection for recurring weekly availability.
- Added an explicit Once/Weekly availability composer with weekday selection.
- Added Tomorrow evening, Weeknights, Saturday night, and Weekend evening quick presets.
- Added a visible advanced recurring schedule manager.
- Added pending invitations directly to the Events tab with accept, tentative, decline, and remove controls.
- Added a Leave event action for accepted and tentative participants.

### Improvements

- Multiple free players are grouped into one calendar slot with names and hover details.
- Recurring rules can be created for several weekdays in one operation.
- Accepted and tentative sessions update live calendar feeds after rescheduling or RSVP changes.
- Accepted and tentative event times are removed from calendar-feed availability for committed players.
- Recurring availability is expanded into dated entries in live calendar feeds.
- Live calendar subscription hashes are included in admin backups and restores.
- Steam images now load correctly while the PWA service worker is active.
- Improved availability controls across desktop and mobile layouts.
- Leaving an event now removes the participant's invitation and game vote without deleting the host's event.
- Updated project documentation with current screenshots and deployment guidance.

### Security

- Calendar subscription URLs use 256-bit random bearer tokens.
- Only SHA-256 token hashes are stored in SQLite and backups.
- Regenerating a subscription immediately invalidates its previous URL.
- Revoked feeds return `404` and cannot be refreshed by calendar clients.
- Event creators cannot bypass event ownership by leaving their own event; they must use the protected delete action.

### Fixes

- Fixed the PWA service worker replacing failed external Steam images with the application HTML.
- Fixed recurring scheduling being difficult to discover from the main calendar.
- Fixed calendar drag selection being limited to a single day.

## 2026-06-08 - Advanced Scheduling And Event Collaboration

### New Features

- Added the dashboard and compact Tonight view.
- Added best-time ranking and overlap heatmaps.
- Added recurring availability, date exceptions, and saved presets.
- Added event capacity, ready-state detection, and Discord announcements.
- Added multi-game voting with random tie resolution.
- Added event comments and one-off `.ics` export.
- Added Discord reminders for tomorrow, one hour, RSVP deadlines, and weekly summaries.
- Added user profiles, themes, accent colours, avatars, preferred hours, and Discord usernames.
- Added event drag-to-reschedule and calendar drag-to-create.
- Added PWA installation support.

### Administration

- Added configurable Discord notification types and editable templates.
- Added Discord webhook testing.
- Added complete JSON backup and restore.
- Added account role management.

### Reliability And Security

- Added production startup diagnostics and Docker health checks.
- Added origin checks, security headers, rate limiting, webhook validation, and stronger session requirements.
- Added automated admin and feature smoke tests.

## Earlier Foundation

- Account registration and login
- First-user administrator assignment
- Shared calendar and free-time management
- Steam-backed game search
- Event creation, deletion, invitations, and RSVP management
- Friends and games pages
- Docker packaging with persistent SQLite storage
