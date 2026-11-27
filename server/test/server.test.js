// End-to-end tests of the API, auth, tus uploads and the processing worker (real FFmpeg + LibreOffice).
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.VIDEO_ENCODER = 'libx264';

const { createApp } = await import('../src/app.js');
const { admins } = await import('../src/auth.js');
const { drain } = await import('../src/worker.js');

let server, base, cookie = '';

before(async () => {
  admins.set('admin', 'rahasia123');
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function api(action, body = {}, opts = {}) {
  const r = await fetch(base + '/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await r.json();
  return { status: r.status, data, res: r };
}
async function list() {
  const r = await fetch(base + '/api', { headers: cookie ? { Cookie: cookie } : {} });
  return r.json();
}

// Minimal tus client: create + one PATCH.
async function tusUpload(file, meta) {
  const buf = fs.readFileSync(file);
  const md = Object.entries(meta).map(([k, v]) => `${k} ${Buffer.from(v).toString('base64')}`).join(',');
  const c = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(buf.length), 'Upload-Metadata': md, Cookie: cookie },
  });
  if (c.status !== 201) return { status: c.status, body: await c.text() };
  const loc = c.headers.get('location');
  const p = await fetch(new URL(loc, base), {
    method: 'PATCH',
    headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream', Cookie: cookie },
    body: buf,
  });
  return { status: p.status, location: loc, itemId: p.headers.get('x-item-id') };
}

const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

test('viewing is open, changes need login', async () => {
  const l = await list();
  assert.equal(l.ok, true);
  assert.equal(l.version, 3);
  assert.equal(l.admin, false);
  assert.deepEqual(l.items, []);
  const r = await api('createFolder', { name: 'X' });
  assert.equal(r.status, 401);
  const up = await tusUpload(__filename(), { filename: 'a.txt' });
  assert.equal(up.status, 401);
});

test('rejects non-JSON and cross-site posts', async () => {
  const r = await fetch(base + '/api', { method: 'POST', body: JSON.stringify({ action: 'me' }) });
  assert.equal(r.status, 415);
  const o = await api('me', {}, { headers: { Origin: 'https://evil.example' } });
  assert.equal(o.status, 403);
  const cross = await api('me', {}, { headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  // behind a tunnel that rewrites Host (Tailscale Funnel): the browser still marks it same-origin
  const tunnel = await api('me', {}, { headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://materi-akpol.tailnet.ts.net' } });
  assert.equal(tunnel.status, 200);
});

test('login', async () => {
  const bad = await api('login', { username: 'admin', password: 'salah' });
  assert.equal(bad.status, 401);
  const ok = await api('login', { username: 'admin', password: 'rahasia123' });
  assert.equal(ok.status, 200);
  const sc = ok.res.headers.get('set-cookie');
  assert.match(sc, /akpol_session=.+HttpOnly/i);
  cookie = sc.split(';')[0];
  assert.equal((await list()).admin, true);
});

let folderA, folderB;
test('folders, move rules, YouTube links', async () => {
  folderA = (await api('createFolder', { name: 'Materi Hukum', folder_id: null })).data.item;
  folderB = (await api('createFolder', { name: 'Sub', folder_id: folderA.id })).data.item;
  assert.equal(folderB.folder_id, folderA.id);
  const loop = await api('move', { id: folderA.id, folder_id: folderB.id });
  assert.equal(loop.status, 400);
  assert.equal((await api('createFolder', { name: 'Y', folder_id: 'nope' })).status, 400);
  assert.equal((await api('addLink', { url: 'https://evil.example/watch?v=abcdefghijk' })).status, 400);
  const yt = await api('addLink', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', name: 'Video', folder_id: folderA.id });
  assert.equal(yt.data.item.mime, 'video/youtube');
});

let examId;
test('exam schedule: admin saves and edits, everyone sees it, bad input is refused', async () => {
  const r = await api('saveExam', { title: 'UTS', folder_id: folderA.id, date: '2026-12-08', time: '08:00', place: 'Aula', note: 'Bab 1-4' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  examId = r.data.exam.id;
  assert.equal(r.data.exam.folder_id, folderA.id);
  const up = await api('saveExam', { id: examId, title: 'UTS Hukum', folder_id: folderA.id, date: '2026-12-09', time: '', place: '', note: '' });
  assert.equal(up.data.exam.title, 'UTS Hukum');
  assert.equal(up.data.exam.time, '');
  for (const bad of [{ title: '', date: '2026-12-08' }, { title: 'X', date: '8-12-2026' }, { title: 'X', date: '2026-12-08', time: '25:00' }, { title: 'X', date: '2026-12-08', folder_id: 'nope' }, { id: 'nope', title: 'X', date: '2026-12-08' }])
    assert.equal((await api('saveExam', bad)).status, 400, JSON.stringify(bad));
  const saved = cookie; cookie = '';
  const l = await list();
  assert.deepEqual(l.exams.map(e => [e.id, e.title, e.date]), [[examId, 'UTS Hukum', '2026-12-09']]);
  assert.equal((await api('saveExam', { title: 'Hack', date: '2026-12-08' })).status, 401);
  assert.equal((await api('deleteExam', { id: examId })).status, 401);
  cookie = saved;
  const tmp = await api('saveExam', { title: 'Kuis', date: '2026-12-01' });
  assert.equal((await api('deleteExam', { id: tmp.data.exam.id })).status, 200);
  assert.equal((await api('deleteExam', { id: tmp.data.exam.id })).status, 400);
});

let textItem;
test('upload a document: stored as-is, served with range requests', async () => {
  const f = path.join(tmp, 'catatan kuliah.txt');
  fs.writeFileSync(f, 'Halo taruna! '.repeat(100));
  const up = await tusUpload(f, { filename: 'catatan kuliah.txt', filetype: 'text/plain', folder_id: folderB.id });
  assert.equal(up.status, 204);
  assert.ok(up.itemId);
  textItem = (await api('uploadedItem', { upload_id: up.location })).data.item;
  assert.equal(textItem.id, up.itemId);
  assert.equal(textItem.status, 'ready');
  assert.equal(textItem.folder_id, folderB.id);
  assert.equal(textItem.size, 1300);
  const r = await fetch(base + textItem.src, { headers: { Range: 'bytes=0-4' } });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), 'Halo ');
  const dl = await fetch(base + textItem.src + '?dl=1');
  assert.equal(dl.headers.get('content-disposition'), 'attachment');
});

let videoItem, imageItem, docItem;
test('upload video, image and office file; worker processes them', { timeout: 300000 }, async () => {
  const vid = path.join(tmp, 'latihan.mov');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid]);
  const img = path.join(tmp, 'foto.png');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1600x1200', '-frames:v', '1', img]);
  const doc = path.join(tmp, 'modul.rtf');
  fs.writeFileSync(doc, '{\\rtf1\\ansi Modul pembelajaran AKPOL\\par}');

  const vu = await tusUpload(vid, { filename: 'latihan.mov', filetype: 'video/quicktime' });
  const iu = await tusUpload(img, { filename: 'foto.png', filetype: 'image/png' });
  const du = await tusUpload(doc, { filename: 'modul.rtf', filetype: 'application/rtf' });
  for (const u of [vu, iu, du]) assert.equal(u.status, 204);

  let l = await list();
  videoItem = l.items.find(i => i.id === vu.itemId);
  assert.equal(videoItem.status, 'processing');
  assert.ok(videoItem.src, 'original stays playable while processing');

  await drain();

  l = await list();
  videoItem = l.items.find(i => i.id === vu.itemId);
  imageItem = l.items.find(i => i.id === iu.itemId);
  docItem = l.items.find(i => i.id === du.itemId);
  assert.equal(videoItem.status, 'ready', videoItem.error);
  assert.ok(videoItem.hls && videoItem.thumb);
  assert.ok(Math.abs(videoItem.duration - 6) < 0.5);
  const master = await (await fetch(base + videoItem.hls)).text();
  assert.match(master, /#EXT-X-STREAM-INF/);
  for (const h of ['720', '480', '360']) assert.match(master, new RegExp(`${h}p/index.m3u8`));
  assert.doesNotMatch(master, /1080p/);
  const variant = await fetch(new URL(videoItem.hls.replace('master.m3u8', '360p/index.m3u8'), base));
  assert.equal(variant.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  assert.match(await variant.text(), /seg_00000\.ts/);
  const thumb = await fetch(base + videoItem.thumb);
  assert.equal(thumb.headers.get('content-type'), 'image/jpeg');

  assert.equal(imageItem.status, 'ready');
  assert.ok(imageItem.thumb);
  assert.equal(docItem.status, 'ready', docItem.error);
  const pdf = await fetch(base + docItem.preview);
  assert.equal((await pdf.arrayBuffer()).byteLength > 500, true);
});

test('portrait phone video gets a ladder by its short side', { timeout: 120000 }, async () => {
  const vid = path.join(tmp, 'hp.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=480x854:rate=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vid]);
  const up = await tusUpload(vid, { filename: 'hp.mp4', filetype: 'video/mp4' });
  await drain();
  const it = (await list()).items.find(i => i.id === up.itemId);
  assert.equal(it.status, 'ready', it.error);
  const master = await (await fetch(base + it.hls)).text();
  assert.match(master, /480p\/index\.m3u8/);
  assert.match(master, /360p\/index\.m3u8/);
  assert.match(master, /RESOLUTION=360x640/);
});

test('a broken video is marked failed but stays downloadable', { timeout: 60000 }, async () => {
  const f = path.join(tmp, 'rusak.mp4');
  fs.writeFileSync(f, 'bukan video');
  const up = await tusUpload(f, { filename: 'rusak.mp4', filetype: 'video/mp4' });
  await drain();
  const it = (await list()).items.find(i => i.id === up.itemId);
  assert.equal(it.status, 'failed');
  assert.ok(it.src);
});

test('recursive delete moves files to trash', async () => {
  const r = await api('delete', { id: folderA.id });
  assert.equal(r.status, 200);
  const exam = (await list()).exams.find(e => e.id === examId);
  assert.equal(exam.folder_id, null, 'exam of a deleted mapel stays, as "Umum"');
  assert.equal(r.data.deleted.length, 4); // folder A, sub folder, text file, YouTube link
  const l = await list();
  assert.ok(!l.items.some(i => i.id === textItem.id));
  const gone = await fetch(base + textItem.src);
  assert.equal(gone.status, 404);
  const trash = fs.readdirSync(path.join(process.env.DATA_DIR, 'trash'));
  assert.ok(trash.some(d => d.endsWith('-' + textItem.id)));
});

test('only index.html, config.js and vendor/ are served from the site folder', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.match(await (await fetch(base + '/config.js')).text(), /AKPOL_SERVER = true/);
  assert.equal((await fetch(base + '/server/package.json')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.notEqual((await fetch(base + '/media/../server/package.json')).status, 200);
});

test('logout', async () => {
  await api('logout');
  assert.equal((await list()).admin, false);
  cookie = '';
});

function __filename() { return new URL(import.meta.url).pathname; }
