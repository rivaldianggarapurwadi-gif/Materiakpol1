// Browser end-to-end test of the website against a running server (Docker stack or `npm start` + `npm run worker`).
// Needs Playwright with Chromium, FFmpeg and LibreOffice on the machine running the test.
//   BASE_URL=http://127.0.0.1 ADMIN_USER=admin ADMIN_PASSWORD=... node test/e2e-browser.cjs
// Screenshots go to $SHOTS (default: a temp folder).
const { chromium, devices } = require('playwright');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASSWORD;
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-shots-'));
if (!PASS) { console.error('Set ADMIN_PASSWORD'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-e2e-'));
const f = n => path.join(tmp, n);
fs.writeFileSync(f('Modul Hukum.txt'), 'Modul Hukum Pidana\n\nPasal 1. Tiada suatu perbuatan dapat dipidana...\n'.repeat(40));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: tmp, stdio: 'ignore' });
run('soffice', ['--headless', '--convert-to', 'pdf', 'Modul Hukum.txt']);
run('soffice', ['--headless', '--convert-to', 'docx:MS Word 2007 XML', 'Modul Hukum.txt']);
run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=500', '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'Latihan Baris.mp4']);
run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1200x800', '-frames:v', '1', 'foto.jpg']);

const step = async (name, fn) => { process.stdout.write(`• ${name} ... `); await fn(); console.log('ok'); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  let expect401 = false; // the wrong-password step answers 401 on purpose
  page.on('console', m => {
    if (m.type() !== 'error' || /favicon|ERR_ABORTED/.test(m.text())) return;
    if (expect401 && /401/.test(m.text())) { expect401 = false; return; }
    errors.push('console: ' + m.text());
  });
  page.on('dialog', d => d.accept());
  const folderName = 'Uji E2E ' + Date.now().toString(36);

  await step('viewer sees materials, no admin buttons', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#fileListBody .file-item, #fileListBody .empty');
    assert.equal(await page.locator('button[title="Upload Materi"]').isVisible(), false);
    assert.equal(await page.locator('#dropZone').isVisible(), false);
    assert.equal(await page.locator('button[title="Masuk admin"]').isVisible(), true);
  });

  await step('wrong password shows an error, right one logs in', async () => {
    await page.click('button[title="Masuk admin"]');
    await page.fill('#loginUser', USER);
    await page.fill('#loginPass', 'salah-sekali');
    expect401 = true;
    await page.click('#loginBtn');
    await page.waitForFunction(() => document.getElementById('loginErr').textContent.length > 0);
    await page.fill('#loginPass', PASS);
    await page.press('#loginPass', 'Enter');
    await page.waitForSelector('button[title="Upload Materi"]', { state: 'visible' });
    assert.match(await page.textContent('#adminName'), new RegExp(USER));
  });

  await step('create a folder and open it', async () => {
    await page.click('button[title="Folder baru"]');
    await page.fill('#folderNameInput', folderName);
    await page.press('#folderNameInput', 'Enter');
    await page.click(`.file-name.folder-name:text-is("${folderName}")`);
    await page.waitForSelector(`.breadcrumb-item.active:text-is("${folderName}")`);
  });

  await step('upload documents, image and video (tus)', async () => {
    await page.setInputFiles('#fileInput', ['Modul Hukum.pdf', 'Modul Hukum.docx', 'Modul Hukum.txt', 'foto.jpg', 'Latihan Baris.mp4'].map(f));
    await page.waitForFunction(() => document.querySelectorAll('#fileListBody .file-item').length === 5, null, { timeout: 120000 });
    await page.screenshot({ path: path.join(SHOTS, '1-files-admin.png') });
  });

  await step('processing badges disappear when the worker is done (polling)', async () => {
    await page.waitForFunction(() => !document.querySelector('#fileListBody .proc-badge'), null, { timeout: 240000 });
  });

  await step('PDF renders with pdf.js', async () => {
    await page.click('.file-name:text-is("Modul Hukum.pdf")');
    await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await page.screenshot({ path: path.join(SHOTS, '2-pdf.png') });
    await page.click('.viewer-acts button:has-text("Tutup")');
  });

  await step('Word file previews as PDF', async () => {
    await page.click('.file-name:text-is("Modul Hukum.docx")');
    await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await page.click('.viewer-acts button:has-text("Tutup")');
  });

  await step('text and image viewers', async () => {
    await page.click('.file-name:text-is("Modul Hukum.txt")');
    await page.waitForSelector('.txt-viewer');
    assert.match(await page.textContent('.txt-viewer'), /Pasal 1/);
    await page.click('.viewer-acts button:has-text("Tutup")');
    await page.click('.file-name:text-is("foto.jpg")');
    await page.waitForSelector('.img-viewer');
    await page.click('.viewer-acts button:has-text("Tutup")');
  });

  await step('download link points at the original file', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.file-item:has(.file-name:text-is("Modul Hukum.txt")) button[title="Download"]').click()]);
    assert.equal(dl.suggestedFilename(), 'Modul Hukum.txt');
  });

  let videoId;
  await step('video tab shows a poster; watch page plays HLS with a quality menu', async () => {
    await page.click('#tabVideos');
    const card = page.locator('.video-card:has(.video-title:text-is("Latihan Baris"))');
    await card.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.video-card img')].some(i => i.complete && i.naturalWidth > 0));
    await page.screenshot({ path: path.join(SHOTS, '3-videos.png') });
    await card.click();
    await page.waitForFunction(() => { const v = document.querySelector('#player video'); return v && v.currentTime > 1; }, null, { timeout: 30000 });
    videoId = await page.evaluate(() => location.hash.slice(3));
    assert.ok(await page.evaluate(() => !!(W.hls && W.levels.length === 3)), 'hls.js with 720/480/360');
    await page.hover('#player');
    await page.click('#pSettings');
    await page.click('#pMenu button:has-text("Kualitas")');
    const labels = await page.locator('#pMenu button').allTextContents();
    for (const l of ['720p', '480p', '360p', 'Otomatis']) assert.ok(labels.some(t => t.includes(l)), 'menu has ' + l);
    await page.click('#pMenu button:has-text("360p")');
    await page.waitForFunction(() => W.levels[W.hls.currentLevel] && W.levels[W.hls.currentLevel].h === 360);
    assert.equal(await page.evaluate(() => localStorage.getItem('akpol_q')), '"360"');
    await page.screenshot({ path: path.join(SHOTS, '4-watch.png') });
    await page.click('#pSettings');
    await page.click('#pMenu button:has-text("Kualitas")');
    await page.click('#pMenu button:has-text("Otomatis")');
    await page.keyboard.press('Escape');
  });

  await step('deep link #v=<id> opens the watch page for a logged-out viewer', async () => {
    const p2 = await browser.newPage();
    await p2.goto(BASE + '/#v=' + videoId);
    await p2.waitForFunction(() => { const v = document.querySelector('#player video'); return v && v.readyState >= 2; }, null, { timeout: 30000 });
    await p2.close();
  });

  await step('phone layout', async () => {
    const m = await browser.newContext({ ...devices['Pixel 7'] });
    const mp = await m.newPage();
    await mp.goto(BASE + '/');
    await mp.waitForSelector('#fileListBody .file-item');
    await mp.screenshot({ path: path.join(SHOTS, '5-phone.png') });
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, 'no horizontal scroll on phones');
    await m.close();
  });

  await step('delete the test folder (recursive), then log out', async () => {
    await page.click('#tabFiles');
    await page.click('.breadcrumb-item:has-text("Semua Materi")');
    await page.locator(`.file-item:has(.file-name:text-is("${folderName}")) button[title="Hapus"]`).click();
    await page.waitForSelector(`.file-name:text-is("${folderName}")`, { state: 'detached' });
    await page.click('#logoutBtn');
    await page.waitForSelector('button[title="Masuk admin"]', { state: 'visible' });
    assert.equal(await page.locator('button[title="Upload Materi"]').isVisible(), false);
  });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (errors.length) { console.error('\nBrowser errors:\n' + errors.join('\n')); process.exit(1); }
  console.log(`\nSemua langkah berhasil. Screenshot: ${SHOTS}`);
})().catch(e => { console.error('\nGAGAL:', e); process.exit(1); });
