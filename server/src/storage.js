// Files on disk: where originals and generated media live, safe names, trash.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

for (const d of [config.mediaDir, config.uploadDir, config.trashDir, config.backupDir,
  ...['files', 'hls', 'thumbs', 'previews'].map(s => path.join(config.mediaDir, s))]) {
  fs.mkdirSync(d, { recursive: true });
}

// A filename that is safe on disk and in a URL path segment, keeping the original as far as possible.
export function safeName(name) {
  let n = String(name || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .replace(/^\.+/, '_')
    .trim();
  if (!n) n = 'file';
  // keep the extension when trimming long names (255-byte limit on most filesystems)
  while (Buffer.byteLength(n) > 200) {
    const ext = path.extname(n).slice(0, 16);
    n = n.slice(0, Math.max(1, n.length - ext.length - 8)) + ext;
  }
  return n;
}

export const mediaPath = rel => path.join(config.mediaDir, rel);

const EXT = {
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', '3gp', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'avif'],
  office: ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'pps', 'ppsx'],
};

// What the worker should do with a file: video | image | office | null (nothing to do)
export function kindOf(name, mime) {
  const ext = path.extname(String(name)).slice(1).toLowerCase();
  if (String(mime).startsWith('video/') || EXT.video.includes(ext)) return 'video';
  if (EXT.image.includes(ext) || (String(mime).startsWith('image/') && ext !== 'svg' && mime !== 'image/svg+xml')) return 'image';
  if (EXT.office.includes(ext)) return 'office';
  return null;
}

// Move a finished file into media/files/<id>/<name>; returns the path relative to media/.
export async function placeFile(srcPath, id, name) {
  const rel = path.posix.join('files', id, safeName(name));
  const dest = mediaPath(rel);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try { await fsp.rename(srcPath, dest); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(srcPath, dest);
    await fsp.unlink(srcPath);
  }
  return rel;
}

// Everything that belongs to one item on disk.
export function itemPaths(id) {
  return [
    path.join(config.mediaDir, 'files', id),
    path.join(config.mediaDir, 'hls', id),
    path.join(config.mediaDir, 'hls', id + '.tmp'),
    path.join(config.mediaDir, 'thumbs', id + '.jpg'),
    path.join(config.mediaDir, 'previews', id + '.pdf'),
  ];
}

// Deleted items go to trash/<timestamp>-<id>/ and are purged after TRASH_DAYS (like Google Drive's trash).
// Only the original file is kept; generated media can be rebuilt.
export async function trashItem(id) {
  const orig = path.join(config.mediaDir, 'files', id);
  if (fs.existsSync(orig)) {
    const dest = path.join(config.trashDir, `${Date.now()}-${id}`);
    await fsp.rename(orig, dest).catch(async () => {
      await fsp.cp(orig, dest, { recursive: true });
      await fsp.rm(orig, { recursive: true, force: true });
    });
  }
  for (const p of itemPaths(id).slice(1)) await fsp.rm(p, { recursive: true, force: true });
}

export async function purgeTrash(days = config.trashDays) {
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  for (const d of await fsp.readdir(config.trashDir).catch(() => [])) {
    const ts = Number(d.split('-')[0]);
    if (ts && ts < cutoff) { await fsp.rm(path.join(config.trashDir, d), { recursive: true, force: true }); removed++; }
  }
  return removed;
}

// Unfinished uploads older than a week are abandoned.
export async function purgeStaleUploads(days = 7) {
  const cutoff = Date.now() - days * 86400000;
  for (const f of await fsp.readdir(config.uploadDir).catch(() => [])) {
    const p = path.join(config.uploadDir, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) await fsp.rm(p, { recursive: true, force: true });
  }
}

export async function diskFree() {
  try {
    const s = await fsp.statfs(config.dataDir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch { return null; }
}
