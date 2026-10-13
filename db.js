// Data access layer for the Elevate client portal.
//
// On Vercel (or anywhere with DATABASE_URL set, pointing at a Postgres
// database — Neon's integration sets this automatically) this talks to a
// real, persistent Postgres database. Without DATABASE_URL set, it falls
// back to an in-memory store so the app still runs for local development
// or a quick test — but that data is NOT persistent and resets whenever
// the process restarts. That fallback is for convenience only; production
// use needs DATABASE_URL set. See README for the one-click Vercel setup.

const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
const usingMemory = !DATABASE_URL;

let sql = null;
if (!usingMemory) {
  const { neon } = require('@neondatabase/serverless');
  sql = neon(DATABASE_URL);
} else {
  console.warn('[db] DATABASE_URL is not set — using a non-persistent in-memory store. Data resets on every restart/cold start. Set DATABASE_URL for real persistence (see README).');
}

function newId(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }
function newSlug() { return crypto.randomBytes(5).toString('hex'); }

const CHECKLIST_TEMPLATE = [
  { category: 'Pre-Project Readiness', text: 'Scope and requirements confirmed' },
  { category: 'Pre-Project Readiness', text: 'Job site confirmed ready for installation' },
  { category: 'Pre-Project Readiness', text: 'Crew assigned and briefed' },
  { category: 'Pre-Project Readiness', text: 'Equipment, tools, and materials staged' },
  { category: 'Pre-Project Readiness', text: 'Travel and hotel arrangements confirmed' },
  { category: 'Pre-Project Readiness', text: 'Project schedule confirmed' },
  { category: 'Pre-Project Readiness', text: 'Approved room placement list (install matrix) obtained' },
  { category: 'Pre-Project Readiness', text: 'Safety requirements reviewed with crew' },
  { category: 'Pre-Project Readiness', text: 'Customer expectations confirmed' },
  { category: 'Daily Crew & Safety', text: 'Daily crew check-in completed' },
  { category: 'Daily Crew & Safety', text: 'Crew attendance and assignments confirmed' },
  { category: 'Daily Crew & Safety', text: 'Tools, equipment, and materials verified safe' },
  { category: 'Daily Crew & Safety', text: 'Worksite kept clean and organized' },
  { category: 'Daily Crew & Safety', text: 'Safety procedures followed' },
  { category: 'Daily Progress', text: 'Progress reviewed against schedule' },
  { category: 'Daily Progress', text: 'Completed work matches installation requirements' },
  { category: 'Daily Progress', text: 'Materials stored and handled properly' },
  { category: 'Daily Progress', text: 'Schedule updates communicated to customer' },
  { category: 'Quality Control', text: 'Routine quality inspection completed' },
  { category: 'Quality Control', text: 'Installation matches approved specifications' },
  { category: 'Quality Control', text: 'Defective or incomplete work corrected' },
  { category: 'Quality Control', text: 'Property manager sign-off obtained for any changes' },
  { category: 'Quality Control', text: 'Project records and photos updated' },
];

// ---------------------------------------------------------------------
// camelCase shape used everywhere outside this file, regardless of backend
// ---------------------------------------------------------------------
function projectRowToCamel(r) {
  return {
    id: r.id, slug: r.slug, name: r.name, customerName: r.customer_name ?? r.customerName,
    address: r.address, pm: r.pm, pmPhone: r.pm_phone ?? r.pmPhone ?? null, foreman: r.foreman,
    startDate: r.start_date ?? r.startDate, targetDate: r.target_date ?? r.targetDate,
    status: r.status, createdAt: r.created_at ?? r.createdAt,
  };
}
function itemRowToCamel(r) {
  return {
    id: r.id, projectId: r.project_id ?? r.projectId, category: r.category,
    text: r.item_text ?? r.text, done: r.done, doneAt: r.done_at ?? r.doneAt,
    sortOrder: r.sort_order ?? r.sortOrder,
  };
}
function issueRowToCamel(r) {
  return {
    id: r.id, projectId: r.project_id ?? r.projectId, title: r.title, description: r.description,
    reportedBy: r.reported_by ?? r.reportedBy, reportedAt: r.reported_at ?? r.reportedAt,
    status: r.status, resolutionNote: r.resolution_note ?? r.resolutionNote,
    resolvedAt: r.resolved_at ?? r.resolvedAt,
  };
}
function photoRowToCamel(r) {
  return {
    id: r.id, projectId: r.project_id ?? r.projectId, url: r.url, caption: r.caption || '',
    takenBy: r.taken_by ?? r.takenBy ?? '', createdAt: r.created_at ?? r.createdAt,
  };
}
function matrixRowToCamel(r) {
  if (!r) return null;
  return {
    projectId: r.project_id ?? r.projectId, blobUrl: r.blob_url ?? r.blobUrl,
    originalName: r.original_name ?? r.originalName,
    uploadedAt: r.uploaded_at ?? r.uploadedAt, uploadedBy: r.uploaded_by ?? r.uploadedBy,
  };
}

// =======================================================================
// Postgres implementation
// =======================================================================
const pg = {
  async ensureSchema() {
    await sql`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      customer_name TEXT NOT NULL, address TEXT, pm TEXT, foreman TEXT,
      start_date TEXT, target_date TEXT, status TEXT NOT NULL DEFAULT 'Pre-Project',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    // Upgrade-safe: databases created by an earlier version get the new column.
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS pm_phone TEXT`;
    await sql`CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL, item_text TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT false,
      done_at TIMESTAMPTZ, sort_order INTEGER NOT NULL DEFAULT 0
    )`;
    await sql`CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL, reported_by TEXT,
      reported_at TIMESTAMPTZ NOT NULL DEFAULT now(), status TEXT NOT NULL DEFAULT 'open',
      resolution_note TEXT, resolved_at TIMESTAMPTZ
    )`;
    await sql`CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url TEXT NOT NULL, caption TEXT, taken_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS matrices (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      blob_url TEXT NOT NULL, original_name TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), uploaded_by TEXT
    )`;
  },

  async ensureSeed() {
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM projects`;
    if (count > 0) return;

    const projectId = newId('proj');
    const slug = newSlug();
    const now = new Date().toISOString();
    const start = now.slice(0, 10);
    const target = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

    await sql`INSERT INTO projects (id, slug, name, customer_name, address, pm, foreman, start_date, target_date, status)
      VALUES (${projectId}, ${slug}, 'The Grayson Student Housing', 'Grayson Property Management', 'Baton Rouge, LA', 'Ty Sisson', 'TBD', ${start}, ${target}, 'In Progress')`;

    for (let i = 0; i < CHECKLIST_TEMPLATE.length; i++) {
      const item = CHECKLIST_TEMPLATE[i];
      const done = i < 7;
      await sql`INSERT INTO checklist_items (id, project_id, category, item_text, done, done_at, sort_order)
        VALUES (${newId('item')}, ${projectId}, ${item.category}, ${item.text}, ${done}, ${done ? now : null}, ${i})`;
    }

    await sql`INSERT INTO issues (id, project_id, title, description, reported_by, status, resolution_note, resolved_at)
      VALUES (${newId('issue')}, ${projectId}, 'Loading dock access delayed',
        'Building management opened the loading dock 45 minutes late this morning. Crew adjusted schedule and is back on track.',
        'Ty Sisson (PM)', 'resolved', 'Confirmed dock access time with building manager for remaining days.', ${now})`;
  },

  async listProjects() {
    const rows = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
    return rows.map(projectRowToCamel);
  },
  async getProjectById(id) {
    const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
    return rows[0] ? projectRowToCamel(rows[0]) : null;
  },
  async getProjectBySlug(slug) {
    const rows = await sql`SELECT * FROM projects WHERE slug = ${slug}`;
    return rows[0] ? projectRowToCamel(rows[0]) : null;
  },
  async createProject({ name, customerName, address, pm, pmPhone, foreman, startDate, targetDate }) {
    const id = newId('proj');
    const slug = newSlug();
    const rows = await sql`INSERT INTO projects (id, slug, name, customer_name, address, pm, pm_phone, foreman, start_date, target_date, status)
      VALUES (${id}, ${slug}, ${name}, ${customerName}, ${address || null}, ${pm || null}, ${pmPhone || null}, ${foreman || null}, ${startDate || null}, ${targetDate || null}, 'Pre-Project')
      RETURNING *`;
    const project = projectRowToCamel(rows[0]);
    for (let i = 0; i < CHECKLIST_TEMPLATE.length; i++) {
      const item = CHECKLIST_TEMPLATE[i];
      await sql`INSERT INTO checklist_items (id, project_id, category, item_text, done, sort_order)
        VALUES (${newId('item')}, ${id}, ${item.category}, ${item.text}, false, ${i})`;
    }
    return project;
  },
  async updateProject(id, fields) {
    const { name, customerName, address, pm, pmPhone, foreman, startDate, targetDate, status } = fields;
    const rows = await sql`UPDATE projects SET
        name = COALESCE(${name ?? null}, name),
        customer_name = COALESCE(${customerName ?? null}, customer_name),
        address = COALESCE(${address ?? null}, address),
        pm = COALESCE(${pm ?? null}, pm),
        pm_phone = CASE WHEN ${pmPhone ?? null}::text IS NULL THEN pm_phone ELSE NULLIF(${pmPhone ?? null}::text, '') END,
        foreman = COALESCE(${foreman ?? null}, foreman),
        start_date = COALESCE(${startDate ?? null}, start_date),
        target_date = COALESCE(${targetDate ?? null}, target_date),
        status = COALESCE(${status ?? null}, status)
      WHERE id = ${id} RETURNING *`;
    return rows[0] ? projectRowToCamel(rows[0]) : null;
  },
  async deleteProject(id) {
    const matrixRows = await sql`SELECT blob_url FROM matrices WHERE project_id = ${id}`;
    const photoRows = await sql`SELECT url FROM photos WHERE project_id = ${id}`;
    const rows = await sql`DELETE FROM projects WHERE id = ${id} RETURNING *`;
    if (!rows[0]) return null;
    return { deleted: projectRowToCamel(rows[0]), blobUrl: matrixRows[0]?.blob_url || null, photoUrls: photoRows.map(r => r.url) };
  },

  async listChecklist(projectId) {
    const rows = await sql`SELECT * FROM checklist_items WHERE project_id = ${projectId} ORDER BY sort_order ASC`;
    return rows.map(itemRowToCamel);
  },
  async updateChecklistItem(projectId, itemId, done) {
    const doneAt = done ? new Date().toISOString() : null;
    const rows = await sql`UPDATE checklist_items SET done = ${done}, done_at = ${doneAt}
      WHERE id = ${itemId} AND project_id = ${projectId} RETURNING *`;
    return rows[0] ? itemRowToCamel(rows[0]) : null;
  },

  async listIssues(projectId) {
    const rows = await sql`SELECT * FROM issues WHERE project_id = ${projectId} ORDER BY reported_at DESC`;
    return rows.map(issueRowToCamel);
  },
  async createIssue(projectId, { title, description, reportedBy }) {
    const id = newId('issue');
    const rows = await sql`INSERT INTO issues (id, project_id, title, description, reported_by, status)
      VALUES (${id}, ${projectId}, ${title}, ${description}, ${reportedBy || 'Customer'}, 'open') RETURNING *`;
    return issueRowToCamel(rows[0]);
  },
  async updateIssue(projectId, issueId, { status, resolutionNote }) {
    const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
    const rows = await sql`UPDATE issues SET
        status = COALESCE(${status ?? null}, status),
        resolution_note = COALESCE(${resolutionNote ?? null}, resolution_note),
        resolved_at = CASE WHEN ${status ?? null} = 'resolved' THEN ${resolvedAt}
                           WHEN ${status ?? null} = 'open' THEN NULL
                           ELSE resolved_at END
      WHERE id = ${issueId} AND project_id = ${projectId} RETURNING *`;
    return rows[0] ? issueRowToCamel(rows[0]) : null;
  },

  async countRecentIssues(projectId, minutes) {
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM issues WHERE project_id = ${projectId} AND reported_at > ${since}`;
    return count;
  },

  async listPhotos(projectId) {
    const rows = await sql`SELECT * FROM photos WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 200`;
    return rows.map(photoRowToCamel);
  },
  async createPhoto(projectId, { url, caption, takenBy }) {
    const rows = await sql`INSERT INTO photos (id, project_id, url, caption, taken_by)
      VALUES (${newId('photo')}, ${projectId}, ${url}, ${caption || null}, ${takenBy || null}) RETURNING *`;
    return photoRowToCamel(rows[0]);
  },
  async deletePhoto(projectId, photoId) {
    const rows = await sql`DELETE FROM photos WHERE id = ${photoId} AND project_id = ${projectId} RETURNING *`;
    return rows[0] ? photoRowToCamel(rows[0]) : null;
  },

  async getMatrix(projectId) {
    const rows = await sql`SELECT * FROM matrices WHERE project_id = ${projectId}`;
    return matrixRowToCamel(rows[0]);
  },
  async upsertMatrix(projectId, { blobUrl, originalName, uploadedBy }) {
    const previous = await pg.getMatrix(projectId);
    await sql`INSERT INTO matrices (project_id, blob_url, original_name, uploaded_by)
      VALUES (${projectId}, ${blobUrl}, ${originalName}, ${uploadedBy || null})
      ON CONFLICT (project_id) DO UPDATE SET
        blob_url = EXCLUDED.blob_url, original_name = EXCLUDED.original_name,
        uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`;
    return { previousBlobUrl: previous?.blobUrl || null };
  },
};

// =======================================================================
// In-memory fallback implementation (same interface, no persistence)
// =======================================================================
const mem = {
  projects: new Map(),
  checklist: new Map(), // id -> item
  issues: new Map(),    // id -> issue
  matrices: new Map(),  // projectId -> matrix
  photos: new Map(),    // id -> photo
};

const memImpl = {
  async ensureSchema() {},
  async ensureSeed() {
    if (mem.projects.size > 0) return;
    const projectId = newId('proj');
    const slug = newSlug();
    const now = new Date().toISOString();
    mem.projects.set(projectId, {
      id: projectId, slug, name: 'The Grayson Student Housing', customerName: 'Grayson Property Management',
      address: 'Baton Rouge, LA', pm: 'Ty Sisson', foreman: 'TBD',
      startDate: now.slice(0, 10), targetDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      status: 'In Progress', createdAt: now,
    });
    CHECKLIST_TEMPLATE.forEach((item, i) => {
      const id = newId('item');
      const done = i < 7;
      mem.checklist.set(id, { id, projectId, category: item.category, text: item.text, done, doneAt: done ? now : null, sortOrder: i });
    });
    const issueId = newId('issue');
    mem.issues.set(issueId, {
      id: issueId, projectId, title: 'Loading dock access delayed',
      description: 'Building management opened the loading dock 45 minutes late this morning. Crew adjusted schedule and is back on track.',
      reportedBy: 'Ty Sisson (PM)', reportedAt: now, status: 'resolved',
      resolutionNote: 'Confirmed dock access time with building manager for remaining days.', resolvedAt: now,
    });
  },

  async listProjects() {
    return [...mem.projects.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },
  async getProjectById(id) { return mem.projects.get(id) || null; },
  async getProjectBySlug(slug) { return [...mem.projects.values()].find(p => p.slug === slug) || null; },
  async createProject({ name, customerName, address, pm, pmPhone, foreman, startDate, targetDate }) {
    const id = newId('proj');
    const project = {
      id, slug: newSlug(), name, customerName, address: address || '', pm: pm || '', pmPhone: pmPhone || null, foreman: foreman || '',
      startDate: startDate || '', targetDate: targetDate || '', status: 'Pre-Project', createdAt: new Date().toISOString(),
    };
    mem.projects.set(id, project);
    CHECKLIST_TEMPLATE.forEach((item, i) => {
      const itemId = newId('item');
      mem.checklist.set(itemId, { id: itemId, projectId: id, category: item.category, text: item.text, done: false, doneAt: null, sortOrder: i });
    });
    return project;
  },
  async updateProject(id, fields) {
    const project = mem.projects.get(id);
    if (!project) return null;
    ['name', 'customerName', 'address', 'pm', 'pmPhone', 'foreman', 'startDate', 'targetDate', 'status'].forEach(key => {
      if (fields[key] !== undefined && fields[key] !== null) project[key] = fields[key];
    });
    return project;
  },
  async deleteProject(id) {
    const project = mem.projects.get(id);
    if (!project) return null;
    mem.projects.delete(id);
    [...mem.checklist.values()].filter(i => i.projectId === id).forEach(i => mem.checklist.delete(i.id));
    [...mem.issues.values()].filter(i => i.projectId === id).forEach(i => mem.issues.delete(i.id));
    const matrix = mem.matrices.get(id);
    mem.matrices.delete(id);
    const photoUrls = [...mem.photos.values()].filter(ph => ph.projectId === id).map(ph => ph.url);
    [...mem.photos.values()].filter(ph => ph.projectId === id).forEach(ph => mem.photos.delete(ph.id));
    return { deleted: project, blobUrl: matrix?.blobUrl || null, photoUrls };
  },

  async listChecklist(projectId) {
    return [...mem.checklist.values()].filter(i => i.projectId === projectId).sort((a, b) => a.sortOrder - b.sortOrder);
  },
  async updateChecklistItem(projectId, itemId, done) {
    const item = mem.checklist.get(itemId);
    if (!item || item.projectId !== projectId) return null;
    item.done = done;
    item.doneAt = done ? new Date().toISOString() : null;
    return item;
  },

  async listIssues(projectId) {
    return [...mem.issues.values()].filter(i => i.projectId === projectId).sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
  },
  async createIssue(projectId, { title, description, reportedBy }) {
    const id = newId('issue');
    const issue = { id, projectId, title, description, reportedBy: reportedBy || 'Customer', reportedAt: new Date().toISOString(), status: 'open', resolutionNote: '', resolvedAt: null };
    mem.issues.set(id, issue);
    return issue;
  },
  async updateIssue(projectId, issueId, { status, resolutionNote }) {
    const issue = mem.issues.get(issueId);
    if (!issue || issue.projectId !== projectId) return null;
    if (status) issue.status = status;
    if (resolutionNote !== undefined) issue.resolutionNote = resolutionNote;
    if (issue.status === 'resolved' && !issue.resolvedAt) issue.resolvedAt = new Date().toISOString();
    if (issue.status === 'open') issue.resolvedAt = null;
    return issue;
  },

  async countRecentIssues(projectId, minutes) {
    const since = Date.now() - minutes * 60000;
    return [...mem.issues.values()].filter(i => i.projectId === projectId && new Date(i.reportedAt).getTime() > since).length;
  },

  async listPhotos(projectId) {
    return [...mem.photos.values()].filter(p => p.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 200);
  },
  async createPhoto(projectId, { url, caption, takenBy }) {
    const id = newId('photo');
    const photo = { id, projectId, url, caption: caption || '', takenBy: takenBy || '', createdAt: new Date().toISOString() };
    mem.photos.set(id, photo);
    return photo;
  },
  async deletePhoto(projectId, photoId) {
    const photo = mem.photos.get(photoId);
    if (!photo || photo.projectId !== projectId) return null;
    mem.photos.delete(photoId);
    return photo;
  },

  async getMatrix(projectId) { return mem.matrices.get(projectId) || null; },
  async upsertMatrix(projectId, { blobUrl, originalName, uploadedBy }) {
    const previous = mem.matrices.get(projectId) || null;
    mem.matrices.set(projectId, { projectId, blobUrl, originalName, uploadedBy: uploadedBy || null, uploadedAt: new Date().toISOString() });
    return { previousBlobUrl: previous?.blobUrl || null };
  },
};

const impl = usingMemory ? memImpl : pg;

module.exports = {
  usingMemory,
  CHECKLIST_TEMPLATE,
  ...impl,
};
