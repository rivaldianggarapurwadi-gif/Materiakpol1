// Copy everything from the Google Drive version (Apps Script web app) into this server.
// Keeps ids (so shared #v=<id> links and watch positions still work), folders, names and dates.
// Safe to run again: items already here are skipped, so an interrupted run just continues.
//   node src/cli.js migrate-drive [APPS_SCRIPT_URL] [--dry-run]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { items, ID_RE } from './db.js';
import { registerFile } from './app.js';

// The URL the current website uses (DRIVE_API_URL in index.html).
export const DEFAULT_DRIVE_API =
  'https://script.google.com/macros/s/AKfycbyJ1hvlyX0vDeKo_Bf6-tdVnMm2nBfnbAypTVBgTvO-3hx0Fch2K4iksJ80vRTkc8gf/exec';
// Files are shared "anyone with the link", so no login is needed to download them.
const DOWNLOAD = process.env.MIGRATE_DOWNLOAD_URL || 'https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t';
const CONCURRENCY = Number(process.env.MIGRATE_CONCURRENCY || 3);
const YT_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;

const fmt = b => b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB' : (b / 1024 ** 2).toFixed(1) + ' MB';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchList(apiUrl) {
  const r = await fetch(apiUrl + (apiUrl.includes('?') ? '&' : '?') + 'action=list', { redirect: 'follow' });
  const data = await r.json().catch(() => { throw new Error(`Respon Apps Script tidak valid (HTTP ${r.status})`); });
  if (!data.ok) throw new Error('Apps Script: ' + (data.error || 'gagal'));
  return data.items || [];
}

async function download(driveId, dest) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(DOWNLOAD.replace('{id}', encodeURIComponent(driveId)), { redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // Drive answers with an HTML page instead of the file when access is denied or quota is exceeded.
      if (/text\/html/.test(r.headers.get('content-type') || '')) throw new Error('Drive mengirim halaman HTML, bukan file (akses ditolak atau kuota download habis)');
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
      return (await fsp.stat(dest)).size;
    } catch (e) {
      lastErr = e;
      await fsp.rm(dest, { force: true });
      if (/HTML/.test(e.message) && attempt >= 2) break;
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

// Parents before children, whatever order the sheet has.
function orderFolders(folders) {
  const byId = new Map(folders.map(f => [f.id, f]));
  const out = [], seen = new Set();
  const visit = (f, depth = 0) => {
    if (seen.has(f.id) || depth > 100) return;
    if (f.folder_id && byId.has(f.folder_id)) visit(byId.get(f.folder_id), depth + 1);
    seen.add(f.id); out.push(f);
  };
  folders.forEach(f => visit(f));
  return out;
}

export async function migrateFromDrive(apiUrl, { dryRun = process.argv.includes('--dry-run'), log = console.log } = {}) {
  if (!apiUrl || apiUrl.startsWith('--')) apiUrl = process.env.DRIVE_API_URL || DEFAULT_DRIVE_API;
  log('Mengambil daftar materi dari Google Drive...');
  const list = (await fetchList(apiUrl)).filter(i => {
    if (ID_RE.test(String(i.id))) return true;
    log(`  ! dilewati, id tidak valid: ${i.name}`);
    return false;
  });
  const folders = orderFolders(list.filter(i => i.is_folder));
  const links = list.filter(i => !i.is_folder && i.mime === 'video/youtube' && YT_RE.test(i.url || ''));
  const files = list.filter(i => !i.is_folder && i.mime !== 'video/youtube' && i.drive_id);
  const todo = files.filter(f => !items.get(f.id));
  const totalBytes = todo.reduce((a, f) => a + (Number(f.size) || 0), 0);
  log(`Ditemukan: ${folders.length} folder, ${files.length} file, ${links.length} video YouTube.`);
  log(`Belum dipindah: ${todo.length} file (${fmt(totalBytes)}).`);
  if (dryRun) { log('(--dry-run: tidak ada yang diubah)'); return { folders: folders.length, files: files.length, links: links.length, todo: todo.length, totalBytes }; }

  const known = id => !!id && !!items.get(id);
  const parentOf = i => (known(i.folder_id) ? i.folder_id : null);
  let created = 0;
  for (const f of folders) {
    if (known(f.id)) continue;
    items.insert({ id: f.id, name: String(f.name || 'Folder'), is_folder: true, folder_id: parentOf(f), created_at: f.created_at, source: 'drive' });
    created++;
  }
  for (const l of links) {
    if (known(l.id)) continue;
    items.insert({ id: l.id, name: String(l.name || 'Video YouTube'), folder_id: parentOf(l), mime: 'video/youtube', url: l.url, created_at: l.created_at, source: 'drive' });
    created++;
  }
  if (created) log(`${created} folder/link dibuat.`);

  const failed = [];
  let done = 0, bytes = 0;
  const t0 = Date.now();
  const queue = [...todo];
  const work = async () => {
    for (let f; (f = queue.shift());) {
      const n = todo.length - queue.length;
      const tmp = path.join(config.uploadDir, `migrate-${f.id}.part`);
      try {
        const size = await download(f.drive_id, tmp);
        if (known(f.id)) { await fsp.rm(tmp, { force: true }); continue; } // another run got it first
        await registerFile({
          srcPath: tmp, id: f.id, name: String(f.name || 'file'), mime: f.mime || '', folderId: parentOf(f),
          size, createdAt: f.created_at, source: 'drive:' + f.drive_id,
        });
        done++; bytes += size;
        const mbps = bytes / 1048576 / Math.max(1, (Date.now() - t0) / 1000);
        log(`[${n}/${todo.length}] ✓ ${f.name} (${fmt(size)}) — ${mbps.toFixed(1)} MB/s`);
      } catch (e) {
        failed.push({ name: f.name, id: f.id, error: e.message });
        log(`[${n}/${todo.length}] ✗ ${f.name}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, work));

  log(`\nSelesai: ${done} file dipindah (${fmt(bytes)}).`);
  if (failed.length) {
    log(`${failed.length} file gagal — jalankan perintah ini lagi untuk mencoba ulang:`);
    for (const f of failed) log(`  - ${f.name}: ${f.error}`);
    process.exitCode = 1;
  }
  log('Video akan diproses worker ke 1080p–360p di latar belakang (lihat: docker compose logs -f worker).');
  return { done, failed, bytes };
}
