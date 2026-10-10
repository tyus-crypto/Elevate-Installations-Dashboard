# Elevate Installations — Client & PM Project Portal (Vercel edition)

Project managers check off tasks, resolve hold-ups, and upload the install
matrix. Customers get a private live link to watch progress, report a
hold-up, and download the current matrix. No customer login.

## What changed from the Replit version (and why)

Vercel runs code as stateless serverless functions: no persistent disk, and
its CDN serves everything in `public/` directly (Express never sees those
requests). So:

| Before | Now |
|---|---|
| JSON files on disk | **Postgres** (Neon, via Vercel Marketplace) |
| Uploaded files on disk | **Vercel Blob** |
| Express served the pages & decided login vs dashboard | Pages are plain static files; the login check happens in the browser (`/api/session`) |
| `/c/<slug>` served by an Express route | `vercel.json` rewrites `/c/<slug>` to `client.html` |

`server.js` is now API-only (`/api/**`). Tables are created automatically on
first request — **you never run any SQL by hand.**

## Deploy on Vercel — one-time setup

1. **Import the project** into Vercel (push this folder to GitHub and import
   the repo, or run `vercel` from the folder). Framework preset: leave
   auto-detected (Express) / "Other". Don't set a build or output command.
2. **Add the database:** project → *Storage* → *Create Database* → choose
   **Neon (Postgres)** from the Marketplace → connect it to this project.
   Vercel injects `DATABASE_URL` automatically.
3. **Add file storage:** *Storage* → *Create Database* → **Blob** → connect
   it to this project. Vercel injects `BLOB_READ_WRITE_TOKEN` automatically.
4. **Add two environment variables** (*Settings → Environment Variables*):
   - `DASHBOARD_PASSWORD` — the shared password project managers use
   - `SESSION_SECRET` — any long random string
5. **Redeploy** (env vars only apply to new deployments).

Open your Vercel URL: you'll be sent to the password screen, then the PM
dashboard. A demo project is created on first load — delete it whenever.

## How it behaves

- **PMs** (`/`): all projects, checklist, hold-ups, install matrix, and a
  copy-able customer link per project.
- **Customers** (`/c/<unique-link>`): read-only live checklist (refreshes
  every 20 s), hold-up form, matrix download. Anyone with the link can view
  it, so only send each link to its own customer.
- Matrix files: `.xlsx`, `.xls`, `.csv`, `.pdf`, **max 4 MB** (Vercel's
  request-size limit for functions). Uploading a new one replaces the old.

## Honest limits

- Matrix files sit in a *public* Blob store behind a long unguessable URL
  that's only ever shown through the project's private link. If a direct
  file URL leaked, it would open without the project link.
- The shared PM password is one password for the whole team (no per-person
  accounts or audit trail).
- Hold-ups don't send email/text alerts yet; PMs see them when they load
  the dashboard.

## Local development / other hosts

Without `DATABASE_URL` / `BLOB_READ_WRITE_TOKEN` the app falls back to
in-memory storage (data resets on restart) — fine for trying it out:

```
npm install
npm start      # http://localhost:3000
```

Set the same two variables anywhere else (e.g. Replit) and it uses the same
cloud data; on those hosts the server also serves the pages itself.

## If something looks wrong

- **Pages load but "request could not be found (404)" on data calls:** the
  function isn't being reached — check Vercel's Framework Preset is
  Express/Other and that `server.js` is at the project root.
- **"Something went wrong on the server":** open *Vercel → Logs*. A
  missing `DATABASE_URL` shows as an in-memory warning; a bad one shows a
  connection error.
- **Data disappears between visits:** `DATABASE_URL` isn't set for the
  environment you're viewing (Production vs Preview) — redeploy after
  connecting Neon.

## Files

```
server.js        API routes (Express); exports the app for Vercel
db.js            Postgres layer (+ in-memory fallback); creates tables itself
blob.js          Vercel Blob layer (+ in-memory fallback)
vercel.json      /c/<slug> -> client.html rewrite
public/          static pages & assets (served by Vercel's CDN)
```
