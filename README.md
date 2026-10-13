# Elevate Installations — Client & PM Project Portal

Project managers track each job (checklist, daily photos, hold-ups, install
matrix). Customers get a private link that updates on its own, where they can
see progress and photos, report a problem, and download the current matrix.
When a customer reports a problem, the PM gets a text.

- **PM dashboard** (`/`): password-protected. All projects, checklist, photo
  posting, hold-ups, matrix upload, customer link, text-alert number.
- **Customer page** (`/c/<unique-link>`): no login. Live progress, daily photo
  feed, checklist, matrix download, "report a hold-up" form.
- **Real time** means the customer's page and the PM's page check for changes
  every 15 seconds while open (and instantly when you switch back to the tab).
  It is not instant push — expect updates within about 15 seconds.

---

## 1. Put it on GitHub

The repository root must contain `server.js`, `package.json`, `vercel.json`
and the `public/` folder **directly** (not inside another folder).

```
your-repo/
├─ server.js  db.js  blob.js  sms.js
├─ package.json  vercel.json  .gitignore  README.md
└─ public/   (pages, styles, scripts, logo)
```

1. Create a new **private** repository on GitHub.
2. Unzip this project and upload the **contents** of the folder (drag the files
   and the `public` folder into the GitHub page → "Commit changes"), or use
   `git push`.
3. If you accidentally upload the wrapper folder too, don't worry: in Vercel set
   *Settings → General → Root Directory* to that folder's name.

Optional but recommended: run `npm install` once on any computer and commit the
`package-lock.json` it creates. That locks exact package versions so a future
package release can't surprise you. (This project uses `latest` for the Neon
and Blob packages because exact versions couldn't be checked when it was built.)

## 2. Deploy on Vercel (one-time setup)

1. Vercel → **Add New → Project** → import the GitHub repo. Leave the build
   settings alone (Framework auto-detects as Express; no build command).
2. **Database:** project → *Storage* → *Create* → **Neon (Postgres)** → connect
   to this project. Vercel adds `DATABASE_URL` for you.
3. **File storage:** *Storage* → *Create* → **Blob** → connect to this project.
   Vercel adds `BLOB_READ_WRITE_TOKEN` for you.
4. **Environment variables** (*Settings → Environment Variables*):

| Name | Required? | What it is |
|---|---|---|
| `DASHBOARD_PASSWORD` | Yes | The shared password PMs sign in with |
| `SESSION_SECRET` | Yes | Any long random string (keeps logins secure) |
| `DATABASE_URL` | Auto | Added by the Neon connection |
| `BLOB_READ_WRITE_TOKEN` | Auto | Added by the Blob connection |
| `TWILIO_ACCOUNT_SID` | For texts | From your Twilio console |
| `TWILIO_AUTH_TOKEN` | For texts | From your Twilio console |
| `TWILIO_FROM_NUMBER` | For texts | Your Twilio number, like `+12255550100` (or use the next line) |
| `TWILIO_MESSAGING_SERVICE_SID` | Alternative | Use instead of FROM_NUMBER if you set up a Messaging Service |
| `ALERT_PHONE_NUMBERS` | Optional | Company-wide fallback numbers, comma-separated, used when a project has no PM number |
| `APP_URL` | Optional | Your site address (e.g. `https://portal.yourcompany.com`) so text links always use it |

5. **Redeploy** (Deployments → ⋯ → Redeploy). Environment variables only apply
   to new deployments.

Tables are created automatically on first load. There is nothing to run by hand.
A demo project appears the first time — delete it when you like.

## 3. Turn on text alerts (Twilio)

1. Create a Twilio account and buy a phone number.
2. **Register the number — this step is required in the US.** US carriers block
   texts from unregistered numbers, so alerts silently won't arrive until you
   either complete **A2P 10DLC registration** (for a regular local number) or
   **toll-free verification** (for a toll-free number; typically a few business
   days). Twilio walks you through both in its console. The texts go only to
   your own PMs, which keeps the registration simple.
3. Add the Twilio variables above in Vercel and redeploy.
4. Open a project, enter the **PM mobile** number, click **Save details**, then
   **Send test text**. If your phone buzzes, you're done. The status line under
   the number tells you whether alerts are on.

How it behaves:
- Each project texts **its own PM's number**; if a project has none, it texts
  the `ALERT_PHONE_NUMBERS` list.
- The text includes the project, who reported, the issue, and a link straight to
  the PM page.
- The report is **always saved**, even if the text fails or Twilio isn't set up.
  The customer is told the truth: "texted" only if a text really went out.
- To stop abuse of the public link, a single project sends at most 5 texts per
  10 minutes (everything is still saved and shown on the dashboard).
- The PM's phone number is never visible to customers.

## 4. Daily photo updates

On a project page, choose photos, add an optional note (shown with the first
photo), and click **Post update**. Customers see them grouped by day, newest
first, within about 15 seconds. PMs can delete a photo with the × button.

Phone photos are 3–12 MB, but Vercel accepts about 4.5 MB per upload, so the
browser shrinks each photo (longest side 1600 px, JPEG) before sending. That
keeps the customer page fast too. iPhone HEIC photos are converted to JPEG.

## Honest limits

- **Not yet tested against the live services.** Everything was tested end to
  end with stand-ins for Neon, Blob and Twilio. Your first deploy is the first
  contact with the real ones — use *Send test text*, post a photo, and upload a
  matrix once to confirm each.
- Files and photos sit in a **public** Blob store behind long random URLs that
  are only shown on a project's private page. Anyone who obtained an exact photo
  URL could open it. Customer matrix downloads go through the server, so that
  file's address isn't handed out.
- Anyone with a customer link can view that project and post hold-ups. Send each
  link only to its own customer.
- One shared PM password (no per-person accounts or audit trail).
- Matrix files: `.xlsx .xls .csv .pdf`, max 4 MB (Vercel's request limit).
- Checking every 15 seconds uses some Vercel/Neon capacity per open page. It
  pauses when a tab is in the background. Fine for normal use; if you ever have
  many customers watching at once, tell me and we can slow it down or add push.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Customer page is blank/unstyled | The `/c/` rewrite in `vercel.json` isn't active. Try `https://your-site/client.html?c=<link-code>` — if that works, check `vercel.json` is at the repo root. |
| "request could not be found (404)" on data | `server.js` isn't at the repo root, or Framework Preset isn't Express/Other. |
| "Something went wrong on the server" | Vercel → *Logs*. A bad `DATABASE_URL` shows a connection error. |
| Data vanishes between visits | `DATABASE_URL` missing for that environment (Production vs Preview). Reconnect Neon, redeploy. |
| Photo upload says too large | Rare after shrinking; try a different photo. |
| Test text says "Twilio did not accept" | Sending number not yet registered/verified, or wrong SID/token. Check Twilio's message log and Vercel Logs. |
| Texts never arrive, no error | Same: unregistered US number. |

## Local development

```
npm install
npm start     # http://localhost:3000
```
With no `DATABASE_URL` / `BLOB_READ_WRITE_TOKEN` the app uses temporary
in-memory storage (resets on restart), which is fine for trying it out.
