// Background worker: turns uploaded files into playable/previewable media, one job at a time.
//   video  → HLS ladder (1080/720/480/360 as the source allows) + poster frame + duration
//   image  → thumbnail
//   office → PDF preview
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { db, items, now } from './db.js';
import { kindOf, mediaPath, purgeTrash, purgeStaleUploads } from './storage.js';
import { probe, pickEncoder, transcodeHls, videoThumb, imageThumb, officeToPdf, killAll } from './media.js';

const MAX_ATTEMPTS = 2;

function claim() {
  return db.prepare(`UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ?
    WHERE id = (SELECT id FROM jobs WHERE state = 'queued' ORDER BY priority, id LIMIT 1)
    RETURNING *`).get(now());
}
const finish = (job, state, error = null) =>
  db.prepare('UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?').run(state, error, now(), job.id);

const exists = id => !!items.get(id);

async function processVideo(item, src) {
  const id = item.id;
  const info = await probe(src);
  if (!info.hasVideo) throw new Error('File tidak berisi video');
  items.update(id, { duration: info.duration || null, width: info.width, height: info.height });

  const thumb = path.posix.join('thumbs', id + '.jpg');
  try { await videoThumb(src, mediaPath(thumb), info); if (exists(id)) items.update(id, { thumb }); }
  catch (e) { console.warn(`[${id}] thumbnail gagal: ${e.message}`); }

  const tmpDir = mediaPath(path.posix.join('hls', id + '.tmp'));
  const finalDir = mediaPath(path.posix.join('hls', id));
  let lastWrite = 0;
  const onProgress = pct => {
    if (Date.now() - lastWrite < 2000) return;
    lastWrite = Date.now();
    items.update(id, { progress: pct });
  };
  let result;
  try {
    result = await transcodeHls(src, tmpDir, info, { onProgress });
  } catch (e) {
    const enc = await pickEncoder();
    if (enc === 'libx264') throw e;
    console.warn(`[${id}] ${enc} gagal, mencoba ulang dengan libx264: ${e.message}`);
    result = await transcodeHls(src, tmpDir, info, { encoder: 'libx264', onProgress });
  }
  if (!exists(id)) { await fsp.rm(tmpDir, { recursive: true, force: true }); return; }
  await fsp.rm(finalDir, { recursive: true, force: true });
  await fsp.rename(tmpDir, finalDir);
  items.update(id, { hls: path.posix.join('hls', id, 'master.m3u8') });
  console.log(`[${id}] HLS siap (${result.rungs.join('/')}p, ${result.encoder})`);
}

async function processImage(item, src) {
  const thumb = path.posix.join('thumbs', item.id + '.jpg');
  try { await imageThumb(src, mediaPath(thumb)); items.update(item.id, { thumb }); }
  catch (e) { console.warn(`[${item.id}] thumbnail gambar gagal (gambar asli tetap dipakai): ${e.message}`); }
}

async function processOffice(item, src) {
  const preview = path.posix.join('previews', item.id + '.pdf');
  await officeToPdf(src, mediaPath(preview));
  items.update(item.id, { preview });
}

export async function runJob(job) {
  const item = items.get(job.item_id);
  if (!item || !item.file) { finish(job, 'done'); return; }
  const src = mediaPath(item.file);
  const t0 = Date.now();
  try {
    if (!fs.existsSync(src)) throw new Error('File asli tidak ditemukan di disk');
    items.update(item.id, { status: 'processing', progress: 0, error: null });
    const kind = kindOf(item.name, item.mime);
    if (kind === 'video') await processVideo(item, src);
    else if (kind === 'image') await processImage(item, src);
    else if (kind === 'office') await processOffice(item, src);
    if (exists(item.id)) items.update(item.id, { status: 'ready', progress: 100, error: null });
    finish(job, 'done');
    console.log(`[${item.id}] selesai: ${item.name} (${((Date.now() - t0) / 1000).toFixed(1)} dtk)`);
  } catch (e) {
    console.error(`[${item.id}] gagal (percobaan ${job.attempts}): ${e.message}`);
    if (job.attempts < MAX_ATTEMPTS) {
      db.prepare("UPDATE jobs SET state = 'queued', error = ?, updated_at = ? WHERE id = ?").run(e.message, now(), job.id);
    } else {
      finish(job, 'failed', e.message);
      // A file that can't be processed stays downloadable; office/image previews just aren't available.
      if (exists(item.id)) items.update(item.id, { status: 'failed', error: e.message.slice(0, 500) });
    }
  }
}

// Process every queued job, then return (used by tests and the migration tool).
export async function drain() {
  let job;
  while ((job = claim())) await runJob(job);
}

async function maintenance() {
  try {
    const n = await purgeTrash();
    if (n) console.log(`Sampah: ${n} item lama dihapus permanen`);
    await purgeStaleUploads();
    db.prepare("DELETE FROM jobs WHERE state = 'done' AND updated_at < ?").run(new Date(Date.now() - 7 * 86400000).toISOString());
  } catch (e) { console.error('Pemeliharaan gagal:', e.message); }
}

async function main() {
  // Jobs that were running when the worker stopped (crash, reboot) start again.
  const reset = db.prepare("UPDATE jobs SET state = 'queued', attempts = MAX(0, attempts - 1) WHERE state = 'running'").run().changes;
  if (reset) console.log(`${reset} pekerjaan dilanjutkan setelah restart`);
  // Leftover partial HLS output from an interrupted run
  for (const d of await fsp.readdir(mediaPath('hls')).catch(() => [])) {
    if (d.endsWith('.tmp')) await fsp.rm(mediaPath(path.posix.join('hls', d)), { recursive: true, force: true });
  }
  console.log(`Worker siap. Encoder video: ${await pickEncoder()}`);
  await maintenance();
  setInterval(maintenance, 3600 * 1000);
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; killAll(); process.exit(0); });
  while (!stopping) {
    const job = claim();
    if (job) await runJob(job);
    else await new Promise(r => setTimeout(r, config.workerPollMs));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
