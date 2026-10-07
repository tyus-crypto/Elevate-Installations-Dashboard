// Elevate Installations — Client & PM Project Portal
//
// Two audiences:
//  - Project Managers: log in with a shared password, manage every project,
//    check off checklist items, resolve reported hold-ups, upload the
//    install matrix.
//  - Customers: no login. Each project gets its own unguessable link
//    (/c/:slug) that shows real-time progress, lets them report a hold-up,
//    and lets them download the current install matrix.

const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || ''; // PM login; unset = open PM access
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-secrets';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const CHECKLIST_FILE = path.join(DATA_DIR, 'checklist.json');
const ISSUES_FILE = path.join(DATA_DIR, 'issues.json');
const MATRIX_FILE = path.join(DATA_DIR, 'matrix.json');
const TEMPLATE_FILE = path.join(DATA_DIR, 'checklist-template.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- tiny JSON "database" ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}
function newSlug() {
  return crypto.randomBytes(5).toString('hex'); // short, unguessable link token
}

function buildChecklistForProject(projectId) {
  const template = readJSON(TEMPLATE_FILE, []);
  return template.map(item => ({
    id: newId('item'),
    projectId,
    category: item.category,
    text: item.text,
    done: false,
    doneAt: null,
  }));
}

// Seed one example project on first run so the portal isn't empty.
function ensureSeedData() {
  let projects = readJSON(PROJECTS_FILE, null);
  if (projects !== null) return; // already initialized

  const projectId = newId('proj');
  const slug = newSlug();
  projects = [{
    id: projectId,
    slug,
    name: 'The Grayson Student Housing',
    customerName: 'Grayson Property Management',
    address: 'Baton Rouge, LA',
    pm: 'Ty Sisson',
    foreman: 'TBD',
    startDate: new Date().toISOString().slice(0, 10),
    targetDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    status: 'In Progress',
    createdAt: new Date().toISOString(),
  }];
  writeJSON(PROJECTS_FILE, projects);

  const checklist = buildChecklistForProject(projectId);
  // mark a realistic chunk of pre-project items done already, for demo purposes
  checklist.slice(0, 7).forEach(i => { i.done = true; i.doneAt = new Date().toISOString(); });
  writeJSON(CHECKLIST_FILE, { [projectId]: checklist });

  const issues = { [projectId]: [{
    id: newId('issue'),
    title: 'Loading dock access delayed',
    description: 'Building management opened the loading dock 45 minutes late this morning. Crew adjusted schedule and is back on track.',
    reportedBy: 'Ty Sisson (PM)',
    reportedAt: new Date().toISOString(),
    status: 'resolved',
    resolutionNote: 'Confirmed dock access time with building manager for remaining days.',
    resolvedAt: new Date().toISOString(),
  }] };
  writeJSON(ISSUES_FILE, issues);

  writeJSON(MATRIX_FILE, {});
}

ensureSeedData();

app.use(express.json());
app.use(cookieParser());

// ---------- PM auth (cookie-based, same pattern as the website hub) ----------
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
    res.cookie('pm_session', makeToken(), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
});
app.post('/api/logout', (req, res) => { res.clearCookie('pm_session'); res.json({ ok: true }); });
app.get('/api/session', (req, res) => {
  res.json({ authRequired: !!PASSWORD, authed: !PASSWORD || isValidToken(req.cookies && req.cookies.pm_session) });
});

// ---------- helpers ----------
function findProject(id) {
  return readJSON(PROJECTS_FILE, []).find(p => p.id === id);
}
function findProjectBySlug(slug) {
  return readJSON(PROJECTS_FILE, []).find(p => p.slug === slug);
}
function projectSummary(p) {
  const checklist = readJSON(CHECKLIST_FILE, {})[p.id] || [];
  const issues = readJSON(ISSUES_FILE, {})[p.id] || [];
  const done = checklist.filter(i => i.done).length;
  return {
    ...p,
    pctComplete: checklist.length ? Math.round((done / checklist.length) * 100) : 0,
    openIssueCount: issues.filter(i => i.status === 'open').length,
  };
}
function publicProjectView(p) {
  const checklist = (readJSON(CHECKLIST_FILE, {})[p.id] || []);
  const issues = (readJSON(ISSUES_FILE, {})[p.id] || [])
    .slice().sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
  const matrix = (readJSON(MATRIX_FILE, {})[p.id]) || null;
  const done = checklist.filter(i => i.done).length;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    customerName: p.customerName,
    address: p.address,
    pm: p.pm,
    foreman: p.foreman,
    startDate: p.startDate,
    targetDate: p.targetDate,
    status: p.status,
    pctComplete: checklist.length ? Math.round((done / checklist.length) * 100) : 0,
    checklist,
    issues,
    matrix: matrix ? { originalName: matrix.originalName, uploadedAt: matrix.uploadedAt, uploadedBy: matrix.uploadedBy } : null,
  };
}

// =======================================================================
// PM-protected API
// =======================================================================
app.get('/api/projects', requirePmAuth, (req, res) => {
  const projects = readJSON(PROJECTS_FILE, []);
  res.json(projects.map(projectSummary));
});

app.post('/api/projects', requirePmAuth, (req, res) => {
  const { name, customerName, address, pm, foreman, startDate, targetDate } = req.body || {};
  if (!name || !customerName) return res.status(400).json({ error: 'Project name and customer name are required' });

  const projects = readJSON(PROJECTS_FILE, []);
  const id = newId('proj');
  const project = {
    id,
    slug: newSlug(),
    name: name.trim(),
    customerName: customerName.trim(),
    address: (address || '').trim(),
    pm: (pm || '').trim(),
    foreman: (foreman || '').trim(),
    startDate: startDate || '',
    targetDate: targetDate || '',
    status: 'Pre-Project',
    createdAt: new Date().toISOString(),
  };
  projects.push(project);
  writeJSON(PROJECTS_FILE, projects);

  const allChecklists = readJSON(CHECKLIST_FILE, {});
  allChecklists[id] = buildChecklistForProject(id);
  writeJSON(CHECKLIST_FILE, allChecklists);

  const allIssues = readJSON(ISSUES_FILE, {});
  allIssues[id] = [];
  writeJSON(ISSUES_FILE, allIssues);

  res.status(201).json(projectSummary(project));
});

app.patch('/api/projects/:id', requirePmAuth, (req, res) => {
  const projects = readJSON(PROJECTS_FILE, []);
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const editable = ['name', 'customerName', 'address', 'pm', 'foreman', 'startDate', 'targetDate', 'status'];
  editable.forEach(key => {
    if (req.body && req.body[key] !== undefined) project[key] = req.body[key];
  });
  writeJSON(PROJECTS_FILE, projects);
  res.json(projectSummary(project));
});

app.delete('/api/projects/:id', requirePmAuth, (req, res) => {
  const projects = readJSON(PROJECTS_FILE, []);
  const next = projects.filter(p => p.id !== req.params.id);
  if (next.length === projects.length) return res.status(404).json({ error: 'Project not found' });
  writeJSON(PROJECTS_FILE, next);

  const checklists = readJSON(CHECKLIST_FILE, {}); delete checklists[req.params.id]; writeJSON(CHECKLIST_FILE, checklists);
  const issues = readJSON(ISSUES_FILE, {}); delete issues[req.params.id]; writeJSON(ISSUES_FILE, issues);

  const matrices = readJSON(MATRIX_FILE, {});
  const m = matrices[req.params.id];
  if (m) { fs.unlink(path.join(UPLOAD_DIR, m.storedName), () => {}); delete matrices[req.params.id]; writeJSON(MATRIX_FILE, matrices); }

  res.json({ ok: true });
});

app.get('/api/projects/:id', requirePmAuth, (req, res) => {
  const project = findProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(publicProjectView(project));
});

app.patch('/api/projects/:id/checklist/:itemId', requirePmAuth, (req, res) => {
  const allChecklists = readJSON(CHECKLIST_FILE, {});
  const list = allChecklists[req.params.id];
  if (!list) return res.status(404).json({ error: 'Project not found' });
  const item = list.find(i => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });

  item.done = !!(req.body && req.body.done);
  item.doneAt = item.done ? new Date().toISOString() : null;
  writeJSON(CHECKLIST_FILE, allChecklists);
  res.json(item);
});

app.patch('/api/projects/:id/issues/:issueId', requirePmAuth, (req, res) => {
  const allIssues = readJSON(ISSUES_FILE, {});
  const list = allIssues[req.params.id];
  if (!list) return res.status(404).json({ error: 'Project not found' });
  const issue = list.find(i => i.id === req.params.issueId);
  if (!issue) return res.status(404).json({ error: 'Hold-up not found' });

  if (req.body.status) issue.status = req.body.status;
  if (req.body.resolutionNote !== undefined) issue.resolutionNote = req.body.resolutionNote;
  if (issue.status === 'resolved' && !issue.resolvedAt) issue.resolvedAt = new Date().toISOString();
  if (issue.status === 'open') issue.resolvedAt = null;

  writeJSON(ISSUES_FILE, allIssues);
  res.json(issue);
});

// install matrix upload (PM only)
const matrixStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(5).toString('hex');
    cb(null, `${req.params.id}-${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const matrixUpload = multer({
  storage: matrixStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.csv', '.pdf'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Install matrix must be a .xlsx, .xls, .csv, or .pdf file'), ok);
  },
});

app.post('/api/projects/:id/matrix', requirePmAuth, (req, res) => {
  matrixUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const project = findProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    const matrices = readJSON(MATRIX_FILE, {});
    const previous = matrices[req.params.id];
    matrices[req.params.id] = {
      storedName: req.file.filename,
      originalName: req.file.originalname,
      uploadedAt: new Date().toISOString(),
      uploadedBy: (req.body && req.body.uploadedBy) || project.pm || 'Project Manager',
    };
    writeJSON(MATRIX_FILE, matrices);
    if (previous) fs.unlink(path.join(UPLOAD_DIR, previous.storedName), () => {});

    res.status(201).json(matrices[req.params.id]);
  });
});

// =======================================================================
// Public (customer) API — scoped by unguessable project slug, no login
// =======================================================================
app.get('/api/public/:slug', (req, res) => {
  const project = findProjectBySlug(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(publicProjectView(project));
});

app.post('/api/public/:slug/issues', (req, res) => {
  const project = findProjectBySlug(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { title, description, reportedBy } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'Please include both a title and a description' });

  const allIssues = readJSON(ISSUES_FILE, {});
  if (!allIssues[project.id]) allIssues[project.id] = [];
  const issue = {
    id: newId('issue'),
    title: title.trim(),
    description: description.trim(),
    reportedBy: (reportedBy || 'Customer').trim(),
    reportedAt: new Date().toISOString(),
    status: 'open',
    resolutionNote: '',
    resolvedAt: null,
  };
  allIssues[project.id].unshift(issue);
  writeJSON(ISSUES_FILE, allIssues);
  res.status(201).json(issue);
});

app.get('/api/public/:slug/matrix', (req, res) => {
  const project = findProjectBySlug(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const matrices = readJSON(MATRIX_FILE, {});
  const m = matrices[project.id];
  if (!m) return res.status(404).json({ error: 'No install matrix uploaded yet' });
  res.download(path.join(UPLOAD_DIR, m.storedName), m.originalName);
});

// Any /api/* request that didn't match a route above is almost certainly a
// bug or a stale client — answer it in JSON rather than letting it fall
// through to a plain-text/HTML 404, so the frontend never has to guess
// what kind of response it got back.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
});

// =======================================================================
// Page routes
// =======================================================================
app.get('/c/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
app.get('/', (req, res, next) => {
  if (!PASSWORD || isValidToken(req.cookies && req.cookies.pm_session)) return next();
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Last-resort error handler. Without this, an unexpected throw anywhere
// above results in Express's default HTML error page, which breaks any
// frontend code expecting JSON back from an /api/ call.
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  }
  res.status(500).send('Something went wrong on the server.');
});

// Replit (and most hosts) need the server bound to 0.0.0.0, not just
// localhost, or the webview/proxy can't reach it.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Elevate client portal running on port ${PORT}`);
  if (!PASSWORD) console.log('No DASHBOARD_PASSWORD set — the PM dashboard is open to anyone with the link.');
});
