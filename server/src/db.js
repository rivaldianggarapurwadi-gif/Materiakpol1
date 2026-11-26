// SQLite database: items (files, folders, YouTube links), processing jobs, admins, sessions.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_folder   INTEGER NOT NULL DEFAULT 0,
  folder_id   TEXT,
  size        INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '',   -- YouTube watch URL (link items only)
  file        TEXT,                       -- original file, relative to media/ (e.g. files/<id>/<name>)
  status      TEXT NOT NULL DEFAULT 'ready', -- ready | processing | failed
  progress    INTEGER NOT NULL DEFAULT 0, -- 0..100 while processing
  error       TEXT,
  thumb       TEXT,                       -- relative to media/
  hls         TEXT,                       -- master playlist, relative to media/
  preview     TEXT,                       -- PDF preview of Office files, relative to media/
  duration    REAL,
  width       INTEGER,
  height      INTEGER,
  upload_id   TEXT UNIQUE,                -- tus upload that created this item
  source      TEXT                        -- e.g. drive:<driveId> for migrated items
);
CREATE INDEX IF NOT EXISTS items_folder ON items(folder_id);
CREATE INDEX IF NOT EXISTS items_source ON items(source);

CREATE TABLE IF NOT EXISTS jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 0,  -- lower runs first
  state      TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, priority, id);

CREATE TABLE IF NOT EXISTS admins (
  username   TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username   TEXT NOT NULL REFERENCES admins(username) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
`);

export const now = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const q = {
  all: db.prepare('SELECT * FROM items'),
  get: db.prepare('SELECT * FROM items WHERE id = ?'),
  byUpload: db.prepare('SELECT * FROM items WHERE upload_id = ?'),
  bySource: db.prepare('SELECT * FROM items WHERE source = ?'),
  children: db.prepare('SELECT * FROM items WHERE folder_id = ?'),
  insert: db.prepare(`INSERT INTO items (id, name, is_folder, folder_id, size, mime, created_at, url, file, status, upload_id, source)
    VALUES (:id, :name, :is_folder, :folder_id, :size, :mime, :created_at, :url, :file, :status, :upload_id, :source)`),
  move: db.prepare('UPDATE items SET folder_id = ? WHERE id = ?'),
  rename: db.prepare('UPDATE items SET name = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM items WHERE id = ?'),
  enqueue: db.prepare('INSERT INTO jobs (item_id, priority, created_at, updated_at) VALUES (?, ?, ?, ?)'),
  dropJobs: db.prepare("DELETE FROM jobs WHERE item_id = ? AND state IN ('queued', 'done', 'failed')"),
};

export const items = {
  all: () => q.all.all(),
  get: id => q.get.get(id),
  byUpload: id => q.byUpload.get(id),
  bySource: s => q.bySource.get(s),
  children: id => q.children.all(id),
  insert(it) {
    q.insert.run({
      id: it.id, name: it.name, is_folder: it.is_folder ? 1 : 0, folder_id: it.folder_id || null,
      size: it.size || 0, mime: it.mime || '', created_at: it.created_at || now(), url: it.url || '',
      file: it.file || null, status: it.status || 'ready', upload_id: it.upload_id || null, source: it.source || null,
    });
    return q.get.get(it.id);
  },
  move: (id, folderId) => q.move.run(folderId || null, id),
  rename: (id, name) => q.rename.run(name, id),
  // Update any set of columns on one item.
  update(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    db.prepare(`UPDATE items SET ${keys.map(k => `${k} = :${k}`).join(', ')} WHERE id = :id`).run({ ...fields, id });
  },
  delete: id => { q.del.run(id); q.dropJobs.run(id); },
  // id plus every item below it (for recursive delete)
  subtree(id) {
    const out = [];
    const walk = i => { out.push(i); for (const c of q.children.all(i.id)) walk(c); };
    const root = q.get.get(id);
    if (root) walk(root);
    return out;
  },
  isDescendant(targetId, ancestorId) {
    let cur = targetId ? q.get.get(targetId) : null;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      if (cur.id === ancestorId) return true;
      seen.add(cur.id);
      cur = cur.folder_id ? q.get.get(cur.folder_id) : null;
    }
    return false;
  },
};

export function enqueue(itemId, priority = 0) {
  const t = now();
  q.enqueue.run(itemId, priority, t, t);
}

const enc = p => p.split('/').map(encodeURIComponent).join('/');

// The shape the frontend receives. Keeps the fields of the Apps Script API (§2.1 of the handoff)
// and adds server URLs: src (original), thumb, hls (master playlist), preview (PDF of Office files).
export function toApi(r) {
  const out = {
    id: r.id,
    name: r.name,
    is_folder: !!r.is_folder,
    folder_id: r.folder_id || null,
    size: r.size || 0,
    mime: r.mime || '',
    created_at: r.created_at,
    url: r.url || '',
    variants: {},
    drive_id: '',
  };
  if (r.is_folder) return out;
  out.status = r.status;
  if (r.status === 'processing') out.progress = r.progress || 0;
  if (r.status === 'failed' && r.error) out.error = r.error;
  if (r.file) out.src = '/media/' + enc(r.file);
  if (r.thumb) out.thumb = '/media/' + enc(r.thumb);
  if (r.hls) out.hls = '/media/' + enc(r.hls);
  if (r.preview) out.preview = '/media/' + enc(r.preview);
  if (r.duration) out.duration = r.duration;
  if (r.width) { out.width = r.width; out.height = r.height; }
  return out;
}
