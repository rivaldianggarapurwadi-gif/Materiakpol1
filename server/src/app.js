// HTTP server: JSON API, admin login, resumable (tus) uploads, and static files when no reverse proxy is used.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { config } from './config.js';
import { db, items, toApi, enqueue, uid, now, ID_RE } from './db.js';
import { placeFile, kindOf, trashItem, diskFree } from './storage.js';
import { COOKIE, login, logout, parseCookies, sessionUser, loginBlocked, loginFailed, loginSucceeded, admins } from './auth.js';

export const API_VERSION = 3; // 1–2 = Google Apps Script, 3 = self-hosted server
const YT_RE = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new HttpError(400, msg);

function cleanName(name, fallback) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return n || fallback;
}

// A folder id from the client: null (root) or an existing folder.
function targetFolder(folderId) {
  if (folderId === null || folderId === undefined || folderId === '') return null;
  const f = items.get(String(folderId));
  if (!f || !f.is_folder) throw bad('Folder tujuan tidak ditemukan');
  return f.id;
}

// Processing priority: images and documents first, videos (slow) last.
const PRIORITY = { image: 0, office: 1, video: 10 };

// Register a file that is already on disk at `srcPath` as a new item.
export async function registerFile({ srcPath, name, mime, folderId, size, uploadId, source, id, createdAt }) {
  id = id || uid();
  const file = await placeFile(srcPath, id, name);
  const kind = kindOf(name, mime);
  const item = items.insert({
    id, name, mime: mime || '', folder_id: folderId, size, file, created_at: createdAt || now(),
    status: kind ? 'processing' : 'ready', upload_id: uploadId, source,
  });
  if (kind) enqueue(id, PRIORITY[kind]);
  return item;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, uniquelocal');

  // ——— Resumable uploads (tus protocol) at /api/upload ———
  const tus = new TusServer({
    path: '/api/upload',
    relativeLocation: true,
    maxSize: config.maxUploadBytes,
    datastore: new FileStore({ directory: config.uploadDir }),
    async onIncomingRequest(req) {
      if (!sessionUser(req.headers.get('cookie'))) throw { status_code: 401, body: 'Silakan masuk sebagai admin untuk mengupload\n' };
    },
    async onUploadCreate(req, upload) {
      const md = upload.metadata || {};
      if (!cleanName(md.filename, '')) throw { status_code: 400, body: 'Nama file kosong\n' };
      try { targetFolder(md.folder_id); } catch (e) { throw { status_code: 400, body: e.message + '\n' }; }
      return { metadata: md };
    },
    async onUploadFinish(req, upload) {
      const md = upload.metadata || {};
      let folderId = null;
      try { folderId = targetFolder(md.folder_id); } catch { /* folder deleted during upload → root */ }
      const item = await registerFile({
        srcPath: path.join(config.uploadDir, upload.id),
        name: cleanName(md.filename, 'file'),
        mime: String(md.filetype || '').slice(0, 100),
        folderId, size: upload.size ?? upload.offset, uploadId: upload.id,
      });
      await fsp.rm(path.join(config.uploadDir, upload.id + '.json'), { force: true });
      return { headers: { 'X-Item-Id': item.id } };
    },
  });
  app.all(['/api/upload', '/api/upload/*'], (req, res) => tus.handle(req, res));

  // ——— JSON API ———
  const json = express.json({ limit: '1mb' });

  app.get(['/api', '/api/items'], (req, res) => {
    const user = sessionUser(req.headers.cookie);
    if ((req.query.action || 'list') !== 'list') return res.status(400).json({ ok: false, error: 'Aksi tidak dikenal: ' + req.query.action });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, version: API_VERSION, admin: !!user, user: user || null, items: items.all().map(toApi) });
  });

  app.get('/api/health', async (req, res) => {
    const user = sessionUser(req.headers.cookie);
    const jobs = Object.fromEntries(db.prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').all().map(r => [r.state, r.n]));
    const out = { ok: true, version: API_VERSION, queue: { queued: jobs.queued || 0, running: jobs.running || 0 } };
    if (user) {
      const disk = await diskFree();
      out.disk = disk;
      out.lowDisk = !!disk && disk.free < config.lowDiskBytes;
      out.failed = db.prepare("SELECT id, name, error FROM items WHERE status = 'failed'").all();
    }
    res.set('Cache-Control', 'no-store').json(out);
  });

  app.post(['/api', '/api/items'], (req, res, next) => {
    // Cross-site requests can't send JSON without a CORS preflight, which this server never allows.
    if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Kirim sebagai application/json' });
    const deny = () => res.status(403).json({ ok: false, error: 'Asal permintaan tidak diizinkan' });
    // Browsers say whether a request comes from the site's own page. Prefer that over comparing
    // Origin with Host, because tunnels/proxies in front of Caddy (e.g. Tailscale Funnel) may rewrite Host.
    const site = req.headers['sec-fetch-site'];
    if (site) {
      if (site !== 'same-origin' && site !== 'none') return deny();
    } else {
      const origin = req.headers.origin;
      if (origin && origin !== 'null') {
        let host = '';
        try { host = new URL(origin).host; } catch { /* invalid */ }
        if (host !== req.headers.host) return deny();
      }
    }
    next();
  }, json, async (req, res) => {
    const b = req.body || {};
    try {
      const out = await handleAction(req, res, b);
      res.json({ ok: true, ...out });
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      res.status(e.status || 500).json({ ok: false, error: e instanceof HttpError ? e.message : 'Terjadi kesalahan di server' });
    }
  });

  async function handleAction(req, res, b) {
    const action = String(b.action || '');
    // Public actions
    if (action === 'login') {
      const ip = req.ip;
      if (loginBlocked(ip)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.');
      const s = login(b.username, b.password);
      if (!s) { loginFailed(ip); throw new HttpError(401, 'Nama atau kata sandi salah'); }
      loginSucceeded(ip);
      res.cookie(COOKIE, s.token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', expires: new Date(s.expires) });
      return { user: s.username };
    }
    if (action === 'logout') {
      logout(parseCookies(req.headers.cookie)[COOKIE]);
      res.clearCookie(COOKIE, { path: '/' });
      return {};
    }
    if (action === 'me') {
      const user = sessionUser(req.headers.cookie);
      return { admin: !!user, user: user || null };
    }

    // Everything else changes data → admin only
    const known = ['createFolder', 'addLink', 'move', 'rename', 'delete', 'uploadedItem', 'retry'];
    if (!known.includes(action)) throw bad('Aksi tidak dikenal: ' + action);
    if (!sessionUser(req.headers.cookie)) throw new HttpError(401, 'Silakan masuk sebagai admin');

    switch (action) {
      case 'createFolder': {
        const name = cleanName(b.name, '');
        if (!name) throw bad('Nama folder kosong');
        const item = items.insert({ id: uid(), name, is_folder: true, folder_id: targetFolder(b.folder_id) });
        return { item: toApi(item) };
      }
      case 'addLink': {
        const m = String(b.url || '').match(YT_RE);
        if (!m) throw bad('Link YouTube tidak valid');
        const item = items.insert({ id: uid(), name: cleanName(b.name, 'Video YouTube'), folder_id: targetFolder(b.folder_id), mime: 'video/youtube', url: m[0] });
        return { item: toApi(item) };
      }
      case 'move': {
        const item = items.get(String(b.id));
        if (!item) throw bad('Item tidak ditemukan');
        const target = targetFolder(b.folder_id);
        if (target && (target === item.id || items.isDescendant(target, item.id))) throw bad('Tidak bisa memindahkan folder ke dalam subfolder-nya sendiri');
        items.move(item.id, target);
        return {};
      }
      case 'rename': {
        const item = items.get(String(b.id));
        if (!item) throw bad('Item tidak ditemukan');
        const name = cleanName(b.name, '');
        if (!name) throw bad('Nama kosong');
        items.rename(item.id, name);
        return { item: toApi(items.get(item.id)) };
      }
      case 'delete': {
        const all = items.subtree(String(b.id));
        if (!all.length) return { deleted: [] };
        for (const it of all) {
          if (!it.is_folder) await trashItem(it.id);
          items.delete(it.id);
        }
        return { deleted: all.map(i => i.id) };
      }
      case 'uploadedItem': { // the item a finished tus upload became
        const id = String(b.upload_id || '').split('/').pop();
        const item = items.byUpload(id);
        if (!item) throw bad('Upload belum selesai');
        return { item: toApi(item) };
      }
      case 'retry': { // re-run processing for a failed item
        const item = items.get(String(b.id));
        if (!item || item.is_folder || !item.file) throw bad('Item tidak ditemukan');
        const kind = kindOf(item.name, item.mime);
        if (!kind) throw bad('File ini tidak perlu diproses');
        items.update(item.id, { status: 'processing', progress: 0, error: null });
        enqueue(item.id, PRIORITY[kind]);
        return { item: toApi(items.get(item.id)) };
      }
    }
  }

  // ——— Static files (Caddy serves these in production; this is for running without it) ———
  if (config.serveStatic) {
    app.get('/config.js', (req, res) => {
      res.type('application/javascript').set('Cache-Control', 'no-cache').send('window.AKPOL_SERVER = true;\n');
    });
    app.use('/media', (req, res, next) => {
      if (req.query.dl === '1') res.setHeader('Content-Disposition', 'attachment');
      next();
    }, express.static(config.mediaDir, {
      fallthrough: false, index: false, dotfiles: 'deny',
      setHeaders(res, p) {
        if (p.endsWith('.m3u8')) res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        else if (p.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', p.includes(`${path.sep}files${path.sep}`) ? 'public, max-age=3600' : 'public, max-age=86400');
      },
    }));
    app.use('/vendor', express.static(path.join(config.siteDir, 'vendor'), {
      fallthrough: false, maxAge: '7d',
      setHeaders(res, p) { if (p.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript'); },
    }));
    // Tema, lambang dan font tampilan (folder assets/ di repo)
    app.use('/assets', express.static(path.join(config.siteDir, 'assets'), { fallthrough: false, maxAge: '1d' }));
    app.get(['/', '/index.html'], (req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(path.join(config.siteDir, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Tidak ditemukan' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) res.status(status).json({ ok: false, error: status === 404 ? 'Tidak ditemukan' : 'Terjadi kesalahan di server' });
  });
  return app;
}

// Run directly: `node src/app.js`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // First start: create the admin from ADMIN_USER / ADMIN_PASSWORD if there is none yet.
  if (admins.count() === 0 && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    admins.set(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
    console.log(`Admin "${process.env.ADMIN_USER}" dibuat.`);
  }
  if (admins.count() === 0) console.warn('Belum ada admin. Buat dengan: node src/cli.js add-admin <nama>');
  if (config.serveStatic && !fs.existsSync(path.join(config.siteDir, 'index.html'))) console.warn('index.html tidak ditemukan di SITE_DIR=' + config.siteDir);
  createApp().listen(config.port, config.host, () => console.log(`Materi AKPOL server di http://${config.host}:${config.port}`));
}
