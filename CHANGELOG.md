# Changelog

Significant SquadSlot changes are recorded here by release date.

## Unreleased - Public Server Protection

### Security

- Added exact-IP Cloudflare Tunnel trust while preserving direct LAN access. Untrusted callers cannot override their visitor IP with forwarded headers.
- Bounded authentication limiter memory and added API, account-write and administrator-backup request limits with retry guidance.
- Added installation and personal record quotas, capped pending registrations at 100, and bounded event/availability notes and proposal invite counts. Oversized restores roll back without replacing existing data.
- Added deployment guidance for a separate cloudflared host, origin firewall restrictions and the remaining need for disk monitoring and edge traffic protection.
- Added regression checks for forged headers, direct access, limiter exhaustion, storage limits and rollback.

## Unreleased - Timezones And Scheduling

### Improvements

- Scheduling screens now consistently use the active squad's labelled timezone, including event summaries, dates, Tonight and availability presets. Profile/device timezones no longer shift just one part of the shared calendar.
- Availability in downloaded and subscribed calendars now uses UTC timestamps for correct phone-calendar conversion.
- One-off events, RSVP deadlines and availability reject missing or ambiguous clock-change times. Weekly availability keeps the same squad-local time across DST; occurrences with invalid or repeated endpoints are skipped.
- Discord reminders now use UTC event boundaries; weekly summaries run separately in each squad's timezone.
- Conflict checks now span squads and cover hosts creating events, proposal finalisation and rescheduling for attending players, without disclosing their other event details.
- Waitlists use persistent join timestamps rather than invitation order. Retries preserve position, leaving/rejoining goes to the back, and promotions recheck conflicts. Event cards show your queue position.

Existing waitlists retain their previous order on upgrade because historical join
times were never recorded. New entries use actual queue-entry order.

## Unreleased - Backup Hardening

### Security And Recovery

- All new backup downloads are encrypted; missing encryption configuration no longer falls back to plaintext.
- Added per-backup random salts, strict encrypted-format checks and full-length authentication tags. Older encrypted and JSON backups remain importable.
- Restoring now requires explicit confirmation. Calendar subscription links are revoked by default, with an option to preserve trusted links.
- Added authenticated uploads up to 32 MB, collision-resistant backup filenames, owner-only permissions for new backup files/directories and export audit records.
- Added regression coverage for tampering, incorrect keys, restore rollback, permissions, session invalidation, calendar revocation and mobile restore controls.

Set `BACKUP_ENCRYPTION_KEY` before creating backups and keep a separate recovery
copy of the key. Losing it makes encrypted backups unrecoverable.

## Unreleased - Personal Availability

### New Features

- Added a My free time mode to the shared calendar, with separately selectable entries, including daytime and event-conflicting availability.
- Click or tap availability to inspect entries and edit your own; the editor becomes a bottom sheet on phones.
- Edit a single recurring date without changing future weeks, or update its entire weekday rule. Delete one-off entries, skip a date or delete a series with confirmation.
- Added a weekly, dated agenda and explicit administrator controls for managing other players. Both personal views default to your own entries.

### Improvements

- Calendar headings now include day and month; week ranges include the year. Agenda headings and the editor show full dates.
- Repeating rules show their date range and next occurrence, respecting skipped dates.
- Availability is loaded for the week being viewed, including weeks beyond the previous default fetch window.
- Added permission, squad-isolation, exception, recurring-edit, mobile-layout and browser-interaction tests.

Single-date changes become independent entries. Later changes to the weekly rule
leave those exceptions intact. Each weekday in a multi-day schedule remains its
own repeating rule.

## Unreleased - Midnight Board And October 2026 Audit

### New Features

- Rebuilt the calendar as Midnight Board with the Glacier palette: icy cyan actions, teal availability, and soft lilac sessions.
- Added a shared header and navigation layout, full-width week grid, and a persistent details area for selected availability and events.
- Best overlaps stand out from quieter availability; simultaneous events and free players now occupy separate lanes.
- New registrations now require administrator approval; pending users have no session or squad access.
- Added Admin registration controls, approval/rejection actions, and a fully closed registration mode.
- Existing accounts remain approved on upgrade; pending requests and registration policy are included in backups.

### Maintenance

- Extracted authentication, Admin, calendar, availability and session creation from the main React entry file into feature modules.
- Moved the redesigned shell, calendar and session form to scoped styles and removed their superseded global overrides.
- Added shared form fields, actions and accessible status messages, with scoped layout styles for the new screens.
- Added registration regression tests and browser checks for the request, approval and closed-registration flows.

### Security

- Updated compatible dependencies to resolve the advisories reported by npm audit; moved Docker from Node 20 to Node 22 LTS.
- Capped availability queries at 366 days and reject impossible dates.
- Restricted proposal voting to invited players, including disabled voting controls for other squad members.
- Prevented untrusted forwarded headers from bypassing origin checks or changing subscription URLs.
- Added constant-time session-signature checks and stricter session payload validation.
- Restoring backups now invalidates existing login sessions, even when the same backup is restored repeatedly.
- Enforced bcrypt's 72-byte limit for newly created/reset passwords and rate-limited password-change attempts.
- Excluded private calendar feeds from offline caching and marked API responses as non-cacheable.
- Added Discord signature timestamp checks, duplicate-account link rejection, and a temporary-password guard for Discord actions.

### Fixes

- Keep exact session durations when dragging events; prevent drops that would truncate a session at midnight.
- Fixed WebKit drag-selection timing and event rescheduling when custom drag data is unavailable.
- Recurring-availability forms now fit their available width, including tablets with the desktop sidebar visible.
- Prevented malformed asynchronous API requests from terminating the server; invalid JSON now returns a useful client error.
- Repeated Discord accept clicks no longer move an accepted player to the waitlist.
- Automatic waitlist promotion skips players with scheduling conflicts.
- Best-time suggestions now use exact availability boundaries, including partial hours and daytime availability.
- Prevented concurrent Discord reminder sweeps from sending duplicates.
- Fixed event expiry across timezones/midnight, dashboard invite totals beyond four invites, and stale Steam search results.
- Clear account data on sign-out/session expiry and ignore older in-flight responses.
- Calendar exports escape carriage returns and fold long UTF-8 lines correctly.
- Saved public App URL now consistently overrides the environment fallback for calendar subscription links.
- Steam request timeouts now cover response-body parsing as well as headers.

### Verification

- Added a dedicated security regression suite to `npm test`.
- Added calendar logic and browser interaction checks for details, overlapping entries, multi-day selection and event rescheduling.

## Unreleased - Visual Refinement

### New Features

- Added Steam artwork to the next event, invites, event summaries, voting options, and calendar popovers, with image fallbacks for older events.
- Added opt-in device push notifications for pending invites and upcoming accepted/tentative sessions, independently of Discord.
- Added per-device notification preferences, a delivery test, persistent signing keys, and notification links to the Events page.
- Added duplicate-delivery prevention, expired-device cleanup, and subscription invalidation after password resets.

### Improvements

- Unified the calendar, dashboard, forms, and account screens with shared dark and light themes.
- Matched the dark colour scheme to the Home Assistant Midnight palette: navy surfaces, warm white text, sky-blue accents, muted teal availability, and amber events.
- Standardized headings, spacing, buttons, focus states, borders, and accent colours.
- Simplified the dashboard with quieter sections and a clearer next-session highlight.
- Grouped navigation links and improved calendar toolbar and session form layouts on laptops and tablets.
- Fixed stretched invite avatars and narrow-phone overflow in weekly availability and session forms.
- Improved availability contrast and kept short slots compact, with player details available in their popover.
- Added an isolated browser layout review covering both themes, eleven screens, and six viewport sizes.

## 2026-07-04 - Squads, Proposals, And Safer Scheduling

### New Features

- Added multiple squads with isolated calendars, friends, availability, events, and game suggestions.
- Added proposal voting for several possible times and games, with random tie-breaking when finalized.
- Added event history for completed sessions.
- Added conflict warnings with an explicit override and capacity waitlists with automatic promotion.
- Added optional Discord bot RSVP buttons linked through each profile's Discord user ID.
- Added encrypted scheduled backups, retention controls, downloadable backup history, and file restore APIs.
- Added an administrator audit log for account, event, proposal, group, settings, RSVP, and backup actions.

### Improvements

- Rebuilt the calendar as the Pulse Board with true time-spanning availability and event blocks.
- Added integrated best-slot ranking, Week/5-day modes, a compact Tonight/Upcoming rail, and docked creation controls.
- Added responsive three-day calendar framing, stable phone toolbars and forms, corrected calendar snap alignment, icon-only phone actions, and compact event anatomy for narrow screens.
- Event times are now normalized to UTC and displayed in each account's configured timezone.
- Squad owners can rotate invite codes, while users can create, join, and switch squads.
- JSON backup and restore now include squads, proposals, Discord identities, UTC timestamps, and audit history.
- Full events now place additional accepted players on a visible waitlist instead of rejecting the response.
- Discord messages use a configured bot channel when available and fall back to the existing webhook setup.

### Security And Reliability

- Record lookups now enforce active-squad boundaries to prevent cross-squad ID access.
- Event invitees are validated against active squad membership.
- Discord interactions are verified with the application's Ed25519 public key.
- Automatic backup files use AES-256-GCM and atomic writes before retention cleanup.
- Expanded smoke coverage for group isolation, proposals, conflicts, waitlists, history, backups, and audit records.

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
