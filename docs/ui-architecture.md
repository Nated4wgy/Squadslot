# UI Structure

The Midnight Board update splits the scheduling UI by feature without changing
the API contracts or introducing another state-management library.

- `src/main.jsx`: application state, account lifecycle and view routing only.
- `src/components/AppShell.jsx`: shared header, navigation and workspace layout.
- `src/components/forms.jsx`: shared labelled fields, actions and status messages.
- `src/components/PageLayout.jsx`: scoped page headers and responsive form grids.
- `src/components/PlayerMedia.jsx`: avatars, game artwork and loading placeholders.
- `src/features/auth`: registration, login and temporary-password screens.
- `src/features/admin`: administration, registration approval, backups and storage status.
- `src/features/calendar`: calendar navigation, overlap blocks, event lanes and details.
- `src/features/availability`: one-off/recurring forms and free-time management.
- `src/features/events/EventForm.jsx`: compact session composer and expanded options.
- `src/features/events/EventsView.jsx`: event management, invitations and details.
- `src/features/dashboard`: dashboard and Tonight screens with scoped layout styles.
- `src/features/profile`: profile and subscription management with shared fields and scoped styles.
- `src/features/friends`, `groups`, `proposals`, `games`: remaining screen modules.
- `src/lib`: shared API calls, date helpers and debounced Steam search.

`src/theme.css` owns the shared colour tokens. New layout styles are CSS modules
beside their components. Existing global form and view styles remain in
`src/styles.css`; migrate those alongside their owning feature instead of adding
another global override. Dashboard/profile-owned rules have moved into their
feature modules. Smaller screens still use common global rows, buttons and panels;
this extraction does not claim to eliminate every legacy shared selector.

## Regression Checks

Run `npm run lint`, `npm test` and `npm run build`, then run
`node scripts/layout-review.mjs` and `node scripts/layout-review.mjs --webkit`.
The browser checks require installed Playwright Chromium and WebKit browsers.
They use a temporary database, disable external notification credentials and
leave screenshots in the temporary directory reported at completion.

The layout review covers both themes, eleven views, widths from 320 to 1440 px,
filled-form rotation, registration approval, calendar details, overlap lanes,
multi-day drag selection and duration-preserving rescheduling. WebKit on Windows
is useful regression coverage but does not replace testing on a physical iPhone.
