// Elevate Installations — Client & PM Project Portal (API)
//
// This file is ONLY the API (/api/**). All pages (index.html, project.html,
// client.html, login.html, css/js/images) are plain static files in
// /public, served by Vercel's CDN directly; vercel.json maps the pretty
// customer link /c/<slug> onto client.html.
//
// Storage lives in the cloud, not on local disk (Vercel functions have no
// persistent disk): project data in Postgres (db.js), install matrix files
// in Vercel Blob (blob.js). Both fall back to in-memory stores when not
// configured, for local development only.

const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const db = require('./db');
const blob = require('./blob');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || ''; // PM login; unset = open PM access
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-secrets';

// Vercel's request body limit for functions is 4.5 MB, so stay under it.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Express 4 doesn't catch rejected promises from async handlers on its
// own — without this, a failed DB call would hang the request instead of
// returning an error.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use(express.json());
app.use(cookieParser());

// Make sure tables exist and the demo project is seeded — once per
// (warm) instance, before the first request is handled.
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await db.ensureSchema();
      await db.ensureSeed();
    })().catch((err) => { readyPromise = null; throw err; });
  }
  return readyPromise;
}
app.use('/api', wrap(async (req, res, next) => { await ready(); next(); }));

// ---------- PM auth (stateless signed cookie) ----------
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function makeToken() { return 'ok.' + sign('ok'); }
function isValidToken(token) {
  if (!token) return false;
  const [val, sig] = token.split('.');
  return !!val && sig === sign(val);
}
function requirePmAuth(req, res, next) {
  if (!PASSWORD) return next();
  if (isValidToken(req.cookies && req.cookies.pm_session)) return next();
  return res.status(401).json({ error: 'Sign in required' });
}

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  const { password } = req.body || {};
  if (password === PASSWORD) {
    res.cookie('pm_session', makeToken(), { httpOnly: true, sameSite: 'lax', secure: !!process.env.VERCEL, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
});
app.post('/api/logout', (req, res) => { res.clearCookie('pm_session'); res.json({ ok: true }); });
app.get('/api/session', (req, res) => {
  res.json({ authRequired: !!PASSWORD, authed: !PASSWORD || isValidToken(req.cookies && req.cookies.pm_session) });
});

// ---------- view builders ----------
async function projectSummary(p) {
  const [checklist, issues] = await Promise.all([db.listChecklist(p.id), db.listIssues(p.id)]);
  const done = checklist.filter(i => i.done).length;
  return {
    ...p,
    pctComplete: checklist.length ? Math.round((done / checklist.length) * 100) : 0,
    openIssueCount: issues.filter(i => i.status === 'open').length,
  };
}
async function fullProjectView(p) {
  const [checklist, issues, matrix] = await Promise.all([db.listChecklist(p.id), db.listIssues(p.id), db.getMatrix(p.id)]);
  const done = checklist.filter(i => i.done).length;
  return {
    id: p.id, slug: p.slug, name: p.name, customerName: p.customerName, address: p.address,
    pm: p.pm, foreman: p.foreman, startDate: p.startDate, targetDate: p.targetDate, status: p.status,
    pctComplete: checklist.length ? Math.round((done / checklist.length) * 100) : 0,
    checklist, issues,
    matrix: matrix ? { originalName: matrix.originalName, uploadedAt: matrix.uploadedAt, uploadedBy: matrix.uploadedBy } : null,
  };
}

// =======================================================================
// PM-protected API
// =======================================================================
app.get('/api/projects', requirePmAuth, wrap(async (req, res) => {
  const projects = await db.listProjects();
  res.json(await Promise.all(projects.map(projectSummary)));
}));

app.post('/api/projects', requirePmAuth, wrap(async (req, res) => {
  const { name, customerName, address, pm, foreman, startDate, targetDate } = req.body || {};
  if (!name || !customerName) return res.status(400).json({ error: 'Project name and customer name are required' });
  const project = await db.createProject({
    name: name.trim(), customerName: customerName.trim(), address: (address || '').trim(),
    pm: (pm || '').trim(), foreman: (foreman || '').trim(), startDate, targetDate,
  });
  res.status(201).json(await projectSummary(project));
}));

app.get('/api/projects/:id', requirePmAuth, wrap(async (req, res) => {
  const project = await db.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await fullProjectView(project));
}));

app.patch('/api/projects/:id', requirePmAuth, wrap(async (req, res) => {
  const project = await db.updateProject(req.params.id, req.body || {});
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await projectSummary(project));
}));

app.delete('/api/projects/:id', requirePmAuth, wrap(async (req, res) => {
  const result = await db.deleteProject(req.params.id);
  if (!result) return res.status(404).json({ error: 'Project not found' });
  if (result.blobUrl) await blob.deleteFile(result.blobUrl);
  res.json({ ok: true });
}));

app.patch('/api/projects/:id/checklist/:itemId', requirePmAuth, wrap(async (req, res) => {
  const item = await db.updateChecklistItem(req.params.id, req.params.itemId, !!(req.body && req.body.done));
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });
  res.json(item);
}));

app.patch('/api/projects/:id/issues/:issueId', requirePmAuth, wrap(async (req, res) => {
  const { status, resolutionNote } = req.body || {};
  const issue = await db.updateIssue(req.params.id, req.params.issueId, { status, resolutionNote });
  if (!issue) return res.status(404).json({ error: 'Hold-up not found' });
  res.json(issue);
}));

// install matrix upload (PM only) — kept in memory, then handed to Blob
const matrixUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.csv', '.pdf'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Install matrix must be a .xlsx, .xls, .csv, or .pdf file'), ok);
  },
});

app.post('/api/projects/:id/matrix', requirePmAuth, (req, res) => {
  matrixUpload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? `That file is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`
          : err.message;
        return res.status(400).json({ error: message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file received' });

      const project = await db.getProjectById(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const ext = path.extname(req.file.originalname).toLowerCase();
      const safeBase = path.basename(req.file.originalname, ext).replace(/[^a-z0-9\-_]+/gi, '-').toLowerCase() || 'matrix';
      const key = `matrix-${project.id}-${safeBase}${ext}`;

      const { url } = await blob.putFile(key, req.file.buffer, { contentType: blob.CONTENT_TYPES[ext] });
      const uploadedBy = (req.body && req.body.uploadedBy) || project.pm || 'Project Manager';
      const { previousBlobUrl } = await db.upsertMatrix(project.id, { blobUrl: url, originalName: req.file.originalname, uploadedBy });
      if (previousBlobUrl && previousBlobUrl !== url) await blob.deleteFile(previousBlobUrl);

      res.status(201).json({ originalName: req.file.originalname, uploadedBy });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not save the file. Please try again.' });
    }
  });
});

// =======================================================================
// Public (customer) API — scoped by unguessable project slug, no login
// =======================================================================
app.get('/api/public/:slug', wrap(async (req, res) => {
  const project = await db.getProjectBySlug(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await fullProjectView(project));
}));

app.post('/api/public/:slug/issues', wrap(async (req, res) => {
  const project = await db.getProjectBySlug(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { title, description, reportedBy } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'Please include both a title and a description' });
  const issue = await db.createIssue(project.id, {
    title: title.trim(), description: description.trim(), reportedBy: (reportedBy || 'Customer').trim(),
  });
  res.status(201).json(issue);
}));

app.get('/api/public/:slug/matrix', wrap(async (req, res) => {
  const project = await db.getProjectBySlug(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const matrix = await db.getMatrix(project.id);
  if (!matrix) return res.status(404).json({ error: 'No install matrix uploaded yet' });
  res.redirect(302, matrix.blobUrl);
}));

// Any /api/* request that didn't match a route above — answer in JSON so the
// frontend never has to guess what kind of response it got back.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
});

// Dev-only: serves uploaded files from memory when Vercel Blob isn't configured.
if (blob.usingMemory) app.get('/_devblob/:key', blob.devServeHandler);

// Local dev / Replit only. On Vercel, public/ is served by the CDN and
// vercel.json handles the /c/<slug> rewrite, so none of this runs there.
if (!process.env.VERCEL) {
  app.get('/c/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
  app.use(express.static(path.join(__dirname, 'public')));
}

// Last-resort error handler: JSON for /api, never an HTML stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  }
  res.status(500).send('Something went wrong on the server.');
});

// On Vercel the platform wraps the exported app as a function; everywhere
// else (local dev, Replit, any Node host) start a normal listener.
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Elevate client portal API running on port ${PORT}`);
    if (!PASSWORD) console.log('No DASHBOARD_PASSWORD set — the PM dashboard is open to anyone with the link.');
  });
}

module.exports = app;
