// File storage for the install matrix. Uses real Vercel Blob when
// BLOB_READ_WRITE_TOKEN is set (Vercel sets this automatically once you
// connect a Blob store to the project — see README). Without it, falls
// back to an in-memory store served from this same app, for local
// development/testing only — those files vanish on restart.

const usingMemory = !process.env.BLOB_READ_WRITE_TOKEN;

const memStore = new Map(); // key -> { buffer, contentType, originalName }

let blobApi = null;
if (!usingMemory) {
  blobApi = require('@vercel/blob');
} else {
  console.warn('[blob] BLOB_READ_WRITE_TOKEN is not set — uploaded files are stored in memory only and will be lost on restart. Set up Vercel Blob for real persistence (see README).');
}

const CONTENT_TYPES = {
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function putFile(key, buffer, { contentType } = {}) {
  if (usingMemory) {
    memStore.set(key, { buffer, contentType, originalName: key });
    return { url: `/_devblob/${encodeURIComponent(key)}` };
  }
  const blob = await blobApi.put(key, buffer, { access: 'public', addRandomSuffix: false, contentType });
  return { url: blob.url };
}

async function deleteFile(urlOrKey) {
  if (!urlOrKey) return;
  if (usingMemory) {
    const match = String(urlOrKey).match(/^\/_devblob\/(.+)$/);
    if (match) memStore.delete(decodeURIComponent(match[1]));
    return;
  }
  try { await blobApi.del(urlOrKey); }
  catch (e) { console.error('[blob] Could not delete old file:', e.message); }
}

// Express route handler for GET /_devblob/:key — only registered when
// usingMemory is true (see server.js).
function devServeHandler(req, res) {
  const key = decodeURIComponent(req.params.key);
  const entry = memStore.get(key);
  if (!entry) return res.status(404).json({ error: 'File not found (in-memory dev store resets on restart)' });
  res.setHeader('Content-Type', entry.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.originalName}"`);
  res.end(entry.buffer);
}

module.exports = { usingMemory, putFile, deleteFile, devServeHandler, CONTENT_TYPES };
