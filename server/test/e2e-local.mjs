// Runs the browser end-to-end test (e2e-browser.cjs) against a temporary server: the real app and the
// real worker, started in this process on a throw-away data folder. No Docker needed.
//   npm run test:e2e
// Needs Playwright with Chromium (set NODE_PATH if it is installed globally), FFmpeg and LibreOffice.
// Screenshots go to $SHOTS (default: a temp folder, printed at the end).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-e2e-server-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.VIDEO_ENCODER ||= 'libx264';

const { createApp } = await import('../src/app.js');
const { admins } = await import('../src/auth.js');
const { drain } = await import('../src/worker.js');

const ADMIN = { user: 'admin', password: 'uji-e2e-' + Math.random().toString(36).slice(2, 10) };
admins.set(ADMIN.user, ADMIN.password);
const server = createApp().listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

// The worker normally runs as its own process; here it shares ours and polls for queued jobs.
let stopping = false;
const worker = (async () => {
  while (!stopping) {
    await drain().catch(e => console.error('worker:', e.message));
    await new Promise(r => setTimeout(r, 400));
  }
})();

const child = spawn(process.execPath, [path.join(here, 'e2e-browser.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, BASE_URL: base, ADMIN_USER: ADMIN.user, ADMIN_PASSWORD: ADMIN.password },
});
const code = await new Promise(r => child.on('exit', c => r(c ?? 1)));

stopping = true;
await worker;
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(code);
