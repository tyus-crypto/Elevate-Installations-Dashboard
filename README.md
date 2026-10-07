# Elevate Installations — Client & PM Project Portal

### Fixed: "Unexpected token 'T'... is not valid JSON"
That error happened because a few places in the frontend assumed every
server response would be JSON and tried to parse it as such. If the
server (or the hosting platform) ever answered with something else — an
HTML error page, a platform-level 404 — the page would crash with that
raw parser error instead of a readable message. This showed up most
reliably on the "New project" form, which is why it appeared right when
entering job details.

All five places doing this (new project, checklist toggling, resolving a
hold-up, uploading the install matrix, and the customer's hold-up form)
now go through one shared, defensive fetch helper (`public/http.js`) that
always surfaces a plain-language error instead. The server was also
hardened to always answer API requests in JSON — including unmatched
routes and unexpected server errors — and to bind explicitly to
`0.0.0.0`, which Replit's webview needs to reach it reliably. I ran the
full flow (create project, toggle checklist, upload/download the install
matrix, report and resolve a hold-up, password login) against the actual
server code to confirm all of this works end-to-end, not just by reading
the code.


A real-time project status portal: project managers check off tasks and
resolve hold-ups, customers get a live link to watch progress, report
problems, and download the current install matrix — no login required on
their end.

## Why it's built this way

I looked at how platforms like Buildertrend and Procore handle this (both
are standard in construction/install project management) before building
this. The pattern that shows up everywhere: a simple customer-facing
portal with live progress, a punch-list/hold-up log, document access, and
daily-log-style updates — kept deliberately lighter-weight than the
internal PM tooling, since customers don't need (or want) the full
complexity.

The checklist itself is pulled directly from your **Project Manager
Checklist** PDF — Pre-Project Readiness, Daily Crew & Safety, Daily
Progress, and Quality Control are all in here as checkable items, grouped
the same way your checklist groups them.

## Two views

**Project managers** (`/`) — sign in with a shared password, see every
project, check off checklist items in real time, resolve reported
hold-ups, upload/replace the install matrix, and grab each project's
customer link.

**Customers** (`/c/<project's unique link>`) — no login. They see:
- Project status and overall progress, updated live
- The full checklist, same as the PM sees it, read-only
- A box to report a hold-up (with their name, a summary, and details) —
  it shows up on the PM's dashboard immediately
- The current install matrix, with a download button

The customer page refreshes itself every 20 seconds, so if a PM checks
off a task while the customer has the page open, it shows up without
them needing to reload.

## Running it on Replit

1. Create a new Repl → **Import from a folder/zip**, and select this
   project.
2. Replit runs `npm install && npm start` automatically from `.replit`.
   If it doesn't, open the Shell and run `npm install && npm start`.
3. Open the webview URL — that's your PM dashboard.

### Lock the PM dashboard with a password

By default anyone with the link can reach the PM dashboard. To add a
password:

1. In Replit, open **Secrets** and add `DASHBOARD_PASSWORD` with your
   team's password.
2. Restart the Repl.

The customer pages (`/c/...`) are never behind this password — they're
meant to be sent straight to the customer. Each one uses a long random
link instead of a login, the same way a lot of client portals handle
this; only share a project's link with that project's customer.

## What ships with it

A demo project ("The Grayson Student Housing") is preloaded so you can
see it working right away — some checklist items already checked, one
resolved hold-up, so you can see what it looks like mid-project. Delete
it from the PM dashboard whenever you're ready to add real ones.

## Adding more projects

From the PM dashboard: fill in the "New project" form at the bottom.
Every new project automatically gets the full checklist loaded and a
fresh customer link — nothing else to set up.

## Project structure

```
server.js                     Express server: PM auth, project/checklist/issue/matrix API
data/checklist-template.json  The standard checklist applied to every new project
data/projects.json            Projects (created automatically on first run)
data/checklist.json           Checklist items per project
data/issues.json              Reported hold-ups per project
data/matrix.json              Install matrix file metadata per project
uploads/                      Where uploaded install matrix files are stored
public/
  index.html, app-pm.js       PM dashboard (project list + create)
  project.html                PM project detail: checklist, hold-ups, matrix, share link
  client.html                 Customer-facing project view
  login.html                  PM password screen
  styles.css                  Shared styling, matching elevateinstallations.com's
                               navy/blue palette and your existing logo mark
  logo.png                    Your logo, pulled from the quote calculator's favicon
```

## Notes / limits

- Install matrix accepts `.xlsx`, `.xls`, `.csv`, or `.pdf` — uploading a
  new one replaces the old one (the old file is removed).
- Data is stored as plain JSON files, which is fine for this scale. If
  you outgrow it — many simultaneous projects, needing an edit history,
  etc. — swapping in a real database is a contained change, mostly
  limited to the `readJSON`/`writeJSON` helpers in `server.js`.
- Customer hold-up reports don't currently trigger an email/text to the
  PM — they show up on the PM dashboard next time it's loaded or
  refreshed. Wiring up a notification (email, Slack, SMS) would be a
  good next addition if real-time alerting matters to you.
