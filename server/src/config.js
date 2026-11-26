// Runtime configuration, read from environment variables (see .env.example).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const dataDir = path.resolve(env.DATA_DIR || path.join(here, '..', 'data'));

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  dataDir,
  dbFile: path.join(dataDir, 'db', 'akpol.sqlite'),
  mediaDir: path.join(dataDir, 'media'),    // served publicly at /media
  uploadDir: path.join(dataDir, 'uploads'), // unfinished resumable uploads
  trashDir: path.join(dataDir, 'trash'),    // deleted items, purged after TRASH_DAYS
  backupDir: path.join(dataDir, 'backups'),
  // Folder holding index.html. The app serves it when SERVE_STATIC is on (Caddy does it in production).
  siteDir: path.resolve(env.SITE_DIR || path.join(here, '..', '..')),
  serveStatic: env.SERVE_STATIC !== '0',
  maxUploadBytes: Number(env.MAX_UPLOAD_GB || 50) * 1024 ** 3,
  trashDays: Number(env.TRASH_DAYS || 30),
  sessionDays: Number(env.SESSION_DAYS || 30),
  videoEncoder: env.VIDEO_ENCODER || 'auto', // auto | libx264 | h264_vaapi | h264_qsv | h264_nvenc
  vaapiDevice: env.VAAPI_DEVICE || '/dev/dri/renderD128',
  x264Preset: env.X264_PRESET || 'veryfast',
  lowDiskBytes: Number(env.LOW_DISK_GB || 10) * 1024 ** 3,
  workerPollMs: Number(env.WORKER_POLL_MS || 2000),
};
