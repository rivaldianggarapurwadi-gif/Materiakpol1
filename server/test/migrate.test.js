// Migration from Google Drive, against a fake Apps Script + Drive download server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-mig-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.VIDEO_ENCODER = 'libx264';

const FILES = { D1: Buffer.from('isi PDF palsu'), D2: Buffer.from('catatan'), D3: null /* access denied */ };
const LIST = [
  // child listed before its parent on purpose
  { id: 'fSub', name: 'Sub', is_folder: true, folder_id: 'fTop', created_at: '2026-02-01T00:00:00.000Z' },
  { id: 'fTop', name: 'Hukum', is_folder: true, folder_id: null, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'i1', name: 'Modul.pdf', is_folder: false, folder_id: 'fSub', size: 13, mime: 'application/pdf', drive_id: 'D1', created_at: '2026-03-01T00:00:00.000Z', variants: {} },
  { id: 'i2', name: 'catatan.txt', is_folder: false, folder_id: null, size: 7, mime: 'text/plain', drive_id: 'D2', created_at: '2026-03-02T00:00:00.000Z' },
  { id: 'i3', name: 'terkunci.docx', is_folder: false, folder_id: 'fTop', size: 5, mime: '', drive_id: 'D3', created_at: '2026-03-03T00:00:00.000Z' },
  { id: 'y1', name: 'Video YT', is_folder: false, folder_id: 'fTop', mime: 'video/youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', drive_id: '', created_at: '2026-03-04T00:00:00.000Z' },
  { id: 'bad id!', name: 'x', is_folder: true },
];

let srv, base;
before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/exec') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, version: 2, items: LIST })); }
    if (u.pathname === '/dl') {
      const body = FILES[u.searchParams.get('id')];
      if (!body) { res.setHeader('Content-Type', 'text/html'); return res.end('<html>Akses ditolak</html>'); }
      return res.end(body);
    }
    res.statusCode = 404; res.end();
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  process.env.MIGRATE_DOWNLOAD_URL = base + '/dl?id={id}';
});
after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('migrates folders, files and links, keeping ids; re-run continues', async () => {
  const { migrateFromDrive } = await import('../src/migrate.js');
  const { items, toApi } = await import('../src/db.js');
  const logs = [];
  const log = m => logs.push(m);

  const dry = await migrateFromDrive(base + '/exec', { dryRun: true, log });
  assert.equal(dry.todo, 3);
  assert.equal(items.all().length, 0);

  const r1 = await migrateFromDrive(base + '/exec', { dryRun: false, log });
  assert.equal(r1.done, 2);
  assert.equal(r1.failed.length, 1);
  assert.match(r1.failed[0].error, /HTML/);
  process.exitCode = 0;

  const sub = items.get('fSub');
  assert.equal(sub.folder_id, 'fTop');
  const pdf = toApi(items.get('i1'));
  assert.equal(pdf.folder_id, 'fSub');
  assert.equal(pdf.created_at, '2026-03-01T00:00:00.000Z');
  assert.equal(pdf.status, 'ready');
  assert.equal(fs.readFileSync(path.join(process.env.DATA_DIR, 'media', decodeURIComponent(pdf.src.slice(7)))).toString(), 'isi PDF palsu');
  assert.equal(items.get('y1').url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(items.get('i3'), undefined);

  // the locked file becomes available; the second run only fetches what's missing
  FILES.D3 = Buffer.from('docx!');
  const r2 = await migrateFromDrive(base + '/exec', { dryRun: false, log });
  assert.equal(r2.done, 1);
  assert.equal(r2.failed.length, 0);
  const docx = items.get('i3');
  assert.equal(docx.status, 'processing'); // office file queued for a PDF preview
  assert.equal(docx.source, 'drive:D3');
  assert.equal(items.all().length, 6);
});
