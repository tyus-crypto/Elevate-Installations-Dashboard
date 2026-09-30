# Ops Hub

An internal dashboard that consolidates your team's links (HubSpot, Gmail,
ClickUp, Claude tools) into one place, with a no-login client status view and
a lightly-gated admin section.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | The site's entry point — required by Vercel so `/` doesn't 404. Identical to `hub.html`. |
| `hub.html` | The dashboard itself — Team Hub and Client View tabs. Kept as a direct-link alias to `index.html`. |
| `admin.html` | The Admin section, now a real page at `/admin` instead of a hidden tab, so `middleware.js` has an actual route to protect. |
| `sprint-plan.html` | An interactive, checkbox-driven sprint plan for rolling this out in 8 sessions. Progress saves in your browser. |
| `middleware.js` | Optional Vercel Edge Middleware that adds a basic-auth gate on `/admin`. See the reliability note inside the file before depending on it. |
| `vercel.json` | Tells Vercel to use clean URLs, so `/admin` maps to `admin.html` without the `.html` extension — this is what makes the middleware matcher work. |
| `README.md` | This file. |

## Bug fix history

The first version of this folder had no `index.html`, which is why Vercel
returned "this page does not exist" at the root domain — there was nothing
for it to serve at `/`. It also had the Admin section built as a JavaScript
tab inside `hub.html` rather than a real page, which meant `middleware.js`'s
`/admin` matcher had no route to actually intercept. Both are fixed as of
this version: `index.html` exists, and Admin is its own page at `/admin`.

## Before you go live

`hub.html` currently has placeholder content in a few spots:

- The quote calculator tile is disabled — send Claude the real
  `quote_calculator.html` file so it can be merged into this project and
  linked properly (it currently only works as a local file on one computer).
- The Client View tab has three sample project rows — replace the link with
  a real ClickUp **Public View** link once you've set one up per client
  (Session 4 in the sprint plan).
- The Admin tab's passcode defaults to `admin` — change the `PASSCODE`
  variable inside `hub.html`'s `<script>` section before sharing this with
  anyone.

None of the admin gating in `hub.html` (the passcode) or `middleware.js`
(basic auth) is meant for genuinely sensitive data — payroll, contracts, and
similar belong in HubSpot's or ClickUp's own permission systems, not in this
dashboard.

## Deploying to Vercel

One-time setup:

```bash
npm install -g vercel
vercel login
vercel
```

From then on, after making changes:

```bash
git add .
git commit -m "describe what changed"
vercel --prod
```

If you want the free basic-auth gate on `/admin`, keep `middleware.js` in
the project root — Vercel picks it up automatically. Update the
`yourusername:yourpassword` placeholder inside it first.

**After deploying, verify it actually works:** open `/admin` in an
incognito/private window. You should get a browser login prompt, not the
page itself. If the page loads without prompting, the middleware isn't
firing — likely because this is a bare static project with no framework.
The fix is usually adding a minimal `package.json`:

```json
{
  "name": "ops-hub",
  "version": "1.0.0"
}
```

Redeploy after adding it and test `/admin` again. If it still doesn't
prompt, fall back to Vercel's native Password Protection instead of relying
on `middleware.js`: Project → Settings → Deployment Protection → Password
Protection (Pro add-on or Enterprise).

## Working through the rollout

Open `sprint-plan.html` in a browser and go session by session. It's a
regular HTML file — you can open it locally, or deploy it alongside
`hub.html` if you'd like a shareable version for anyone else involved in
setup.
