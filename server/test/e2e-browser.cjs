// Browser end-to-end test of the website against a running server.
// Easiest:  npm run test:e2e   (test/e2e-local.mjs starts a temporary server + worker and runs this file)
// Against an installed server (Docker stack):
//   BASE_URL=http://127.0.0.1 ADMIN_USER=admin ADMIN_PASSWORD=... node test/e2e-browser.cjs
// Needs Playwright with Chromium, FFmpeg and LibreOffice on the machine running the test.
// It creates one test folder, uploads into it and deletes it again at the end.
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
fs.mkdirSync(SHOTS, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-e2e-'));
const f = n => path.join(tmp, n);
fs.writeFileSync(f('Modul Hukum.txt'), 'Modul Hukum Pidana\n\nPasal 1. Tiada suatu perbuatan dapat dipidana...\n'.repeat(40));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: tmp, stdio: 'ignore' });
run('soffice', ['--headless', '--convert-to', 'pdf', 'Modul Hukum.txt']);
run('soffice', ['--headless', '--convert-to', 'docx:MS Word 2007 XML', 'Modul Hukum.txt']);
run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=500', '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'Latihan Baris.mp4']);
run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1200x800', '-frames:v', '1', 'foto.jpg']);

let mainPage = null; // for a screenshot of what the browser showed when a step fails
const step = async (name, fn) => {
  process.stdout.write(`• ${name} ... `);
  try { await fn(); } catch (e) {
    if (mainPage) await mainPage.screenshot({ path: path.join(SHOTS, 'FAILED.png') }).catch(() => {});
    throw e;
  }
  console.log('ok');
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  mainPage = page;
  const errors = [];
  let expect401 = false; // the wrong-password step answers 401 on purpose
  const watchErrors = (pg, tag) => {
    pg.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
    pg.on('console', m => {
      if (m.type() !== 'error' || /favicon|ERR_ABORTED/.test(m.text())) return;
      if (expect401 && /401/.test(m.text())) { expect401 = false; return; }
      errors.push(`${tag} console: ${m.text()}`);
    });
  };
  watchErrors(page, 'desktop');
  const stamp = Date.now().toString(36);
  const folderName = 'Uji E2E ' + stamp;
  const subName = 'Arsip ' + stamp;
  const folderTitle = name => `#folderTitle:text-is("${name}")`;
  // rows of the folder / search / manage list (the home view has its own short lists)
  const row = (pg, name) => pg.locator(`#fileListBody .file-item:has(.file-name:text-is("${name}"))`);
  const watchClosed = pg => pg.waitForFunction(() => !document.getElementById('watch').classList.contains('open'));
  const loaded = sel => { const i = document.querySelector(sel); return !!i && i.complete && i.naturalWidth > 0; };
  const noOverflow = async (pg, where) =>
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no horizontal scroll: ' + where);

  await step('home: Kentung greets, crest and credit are there, viewers get no admin controls', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#mapelGrid .mapel-card, #mapelGrid .state-card');
    assert.ok(await page.locator('.hero-panel').isVisible());
    await page.waitForFunction(loaded, '#heroImg');
    await page.waitForFunction(loaded, 'header .brand-crest');
    await page.waitForFunction(loaded, '.hero-crest');
    const greeting = (await page.textContent('#heroBubble')).trim();
    assert.ok(greeting.length > 3, 'greeting in the speech bubble');
    await page.click('#heroKentungBtn');
    assert.notEqual((await page.textContent('#heroBubble')).trim(), greeting, 'tapping Kentung changes his line');
    assert.match(await page.textContent('.footer-credit'), /Run and managed by\s+Tim IT MS 60/);
    assert.equal(await page.locator('a.nav-link[data-page="upload"]').isVisible(), false);
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'searchInput', '"/" jumps to the search box');
    await page.screenshot({ path: path.join(SHOTS, '0-home.png') });
  });

  await step('the upload page asks viewers to log in', async () => {
    await page.goto(BASE + '/?page=upload');
    await page.waitForSelector('#fileListBody .state-card');
    assert.match(await page.textContent('#fileListBody'), /khusus admin/);
    assert.equal(await page.locator('#dropZone').isVisible(), false);
    assert.equal(await page.locator('#uploadTools').isVisible(), false);
    assert.equal(await page.locator('button[title="Masuk admin"]').isVisible(), true);
  });

  await step('wrong password shows an error, right one logs in', async () => {
    await page.click('#fileListBody button:has-text("Masuk admin")');
    await page.waitForSelector('#loginModal', { state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#loginModal', { state: 'hidden' });
    await page.click('button[title="Masuk admin"]');
    await page.fill('#loginUser', USER);
    await page.fill('#loginPass', 'salah-sekali');
    expect401 = true;
    await page.click('#loginBtn');
    await page.waitForFunction(() => document.getElementById('loginErr').textContent.length > 0);
    await page.fill('#loginPass', PASS);
    await page.press('#loginPass', 'Enter');
    await page.waitForSelector('#dropZone', { state: 'visible' });
    assert.equal(await page.locator('a.nav-link[data-page="upload"]').isVisible(), true);
    assert.match(await page.textContent('#adminName'), new RegExp(USER));
  });

  await step('create a folder and open it', async () => {
    await page.click('#uploadTools button:has-text("Buat folder kursus")');
    await page.fill('#folderNameInput', folderName);
    await page.press('#folderNameInput', 'Enter');
    await page.click(`.file-name.folder-name:text-is("${folderName}")`);
    await page.waitForSelector(folderTitle(folderName));
    await page.waitForSelector(`.breadcrumb-item.active:text-is("${folderName}")`);
    assert.match(await page.textContent('#dzDest'), new RegExp(folderName), 'upload box names the destination folder');
    assert.match(page.url(), /[?&]f=/);
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
    const [dl] = await Promise.all([page.waitForEvent('download'), row(page, 'Modul Hukum.txt').locator('button[title="Download"]').click()]);
    assert.equal(dl.suggestedFilename(), 'Modul Hukum.txt');
  });

  await step('library: mapel card opens the folder, Back returns home, search looks in every folder', async () => {
    await page.goto(BASE + '/');
    const card = page.locator(`.mapel-card:has(.mapel-name:text-is("${folderName}"))`);
    await card.waitFor();
    assert.match(await card.locator('.mapel-meta').textContent(), /1 video · 4 dokumen/);
    await card.click();
    await page.waitForSelector(folderTitle(folderName));
    assert.equal(await page.locator('#fileListBody .file-item').count(), 5);
    assert.equal(await page.locator('#fileListBody button[title="Hapus"]').count(), 0, 'the library has no manage buttons');
    assert.equal(await page.locator('.hero-panel').isVisible(), false);
    assert.match(page.url(), /[?&]f=/);
    await page.goBack();
    await page.waitForSelector('#mapelGrid .mapel-card');
    assert.ok(await page.locator('.hero-panel').isVisible(), 'browser Back returns to the home view');
    await page.fill('#searchInput', 'modul hukum');
    await page.waitForSelector('#folderTitle:has-text("Hasil untuk")');
    for (const name of ['Modul Hukum.pdf', 'Modul Hukum.docx', 'Modul Hukum.txt']) await row(page, name).first().waitFor();
    assert.match(await row(page, 'Modul Hukum.pdf').first().locator('.file-meta').textContent(), new RegExp(folderName), 'results show their folder');
    await page.click('#searchClear');
    await page.waitForSelector('#mapelGrid .mapel-card');
  });

  let videoId;
  await step('course page shows a poster; watch page plays HLS with a quality menu', async () => {
    await page.click('a.nav-link[data-page="videos"]');
    const course = page.locator(`.course-card:has(h2:text-is("${folderName}"))`);
    await course.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.course-card .course-thumb')].some(i => i.complete && i.naturalWidth > 0));
    await page.screenshot({ path: path.join(SHOTS, '3-courses.png') });
    await course.locator('a.btn').click();
    await page.waitForFunction(() => { const v = document.querySelector('#player video'); return v && v.currentTime > 1; }, null, { timeout: 30000 });
    videoId = await page.evaluate(() => decodeURIComponent(location.hash.slice(3)));
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
  });

  await step('leaving mid-video offers "Lanjutkan belajar"; watching to the end marks the lesson done', async () => {
    await page.waitForFunction(() => document.querySelector('#player video').currentTime > 4, null, { timeout: 30000 });
    await page.evaluate(() => document.querySelector('#player video').pause());
    await page.keyboard.press('Escape');
    await watchClosed(page);
    assert.equal(await page.evaluate(() => location.hash), '', 'closing the player clears #v= from the address');
    const resume = page.locator('.continue-card:has-text("Latihan Baris")');
    await resume.waitFor();
    await resume.click();
    await page.waitForFunction(() => { const v = document.querySelector('#player video'); return v && v.duration > 1 && v.readyState >= 2; }, null, { timeout: 30000 });
    await page.evaluate(() => { const v = document.querySelector('#player video'); v.currentTime = v.duration - 0.5; v.play(); });
    await page.waitForSelector('#pEnd.open:has-text("Selesai ditonton")', { timeout: 20000 });
    assert.ok(await page.locator('#completeLesson.is-done').isVisible());
    await page.screenshot({ path: path.join(SHOTS, '4b-finished.png') });
    await page.click('#pEnd button:has-text("Kembali")');
    await watchClosed(page);
    await page.waitForSelector(`.course-card.is-done:has(h2:text-is("${folderName}")) .course-stamp`);
    assert.equal(await page.locator('.continue-card').count(), 0, 'finished lessons leave "Lanjutkan belajar"');
  });

  await step('deep link #v=<id>: a logged-out viewer can watch, and Back shows the folder it is in', async () => {
    const p2 = await browser.newPage();
    watchErrors(p2, 'deep link');
    await p2.goto(BASE + '/#v=' + encodeURIComponent(videoId));
    await p2.waitForFunction(() => { const v = document.querySelector('#player video'); return v && v.readyState >= 2; }, null, { timeout: 30000 });
    await p2.click('.watch-top .w-icon');
    await watchClosed(p2);
    await p2.waitForSelector(folderTitle(folderName));
    assert.equal(await p2.evaluate(() => location.hash), '');
    assert.match(p2.url(), /[?&]f=/);
    await p2.close();
  });

  await step('phone layout: bottom tab bar, no sideways scrolling (also at 320 px)', async () => {
    const m = await browser.newContext({ ...devices['Pixel 7'] });
    const mp = await m.newPage();
    watchErrors(mp, 'phone');
    await mp.goto(BASE + '/');
    await mp.waitForSelector('#mapelGrid .mapel-card');
    await mp.screenshot({ path: path.join(SHOTS, '5-phone.png') });
    await noOverflow(mp, 'home');
    assert.ok(await mp.locator('.tabbar').isVisible());
    assert.equal(await mp.locator('header .nav-link').first().isVisible(), false, 'navigation moves to the tab bar');
    await mp.locator(`.mapel-card:has(.mapel-name:text-is("${folderName}"))`).click();
    await mp.waitForSelector(folderTitle(folderName));
    await noOverflow(mp, 'folder');
    await mp.click('.tabbar a[data-page="videos"]');
    await mp.waitForSelector('.course-card');
    await noOverflow(mp, 'courses');
    await m.close();
    const s = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
    const sp = await s.newPage();
    watchErrors(sp, '320px');
    await sp.goto(BASE + '/');
    await sp.waitForSelector('#mapelGrid .mapel-card');
    await noOverflow(sp, 'home at 320 px');
    await sp.goto(BASE + '/?page=courses');
    await sp.waitForSelector('.course-card');
    await noOverflow(sp, 'courses at 320 px');
    await s.close();
  });

  await step('admin: rename, move with the folder picker and by dragging, Back goes up one folder', async () => {
    await page.goto(BASE + '/?page=upload');
    await page.waitForSelector('#fileListBody .file-item');
    await page.click(`.file-name.folder-name:text-is("${folderName}")`);
    await page.waitForSelector(folderTitle(folderName));
    await row(page, 'Modul Hukum.txt').locator('button[title="Ganti nama"]').click();
    await page.fill('#renameInput', 'Catatan Hukum.txt');
    await page.press('#renameInput', 'Enter');
    await row(page, 'Catatan Hukum.txt').waitFor();
    assert.equal(await row(page, 'Modul Hukum.txt').count(), 0);
    await page.click('#uploadTools button:has-text("Buat folder kursus")');
    await page.fill('#folderNameInput', subName);
    await page.press('#folderNameInput', 'Enter');
    await row(page, subName).waitFor();
    await row(page, 'foto.jpg').locator('button[title="Pindahkan"]').click();
    await page.screenshot({ path: path.join(SHOTS, '6-move.png') });
    await page.click(`#moveList .pick-row:has(span:text-is("${subName}"))`);
    await row(page, 'foto.jpg').waitFor({ state: 'detached' });
    await row(page, 'Modul Hukum.docx').dragTo(row(page, subName)); // drag and drop still works next to the buttons
    await row(page, 'Modul Hukum.docx').waitFor({ state: 'detached' });
    await page.click(`.file-name.folder-name:text-is("${subName}")`);
    await page.waitForSelector(folderTitle(subName));
    await row(page, 'foto.jpg').waitFor();
    await row(page, 'Modul Hukum.docx').waitFor();
    await page.click('#backBtn');
    await page.waitForSelector(folderTitle(folderName));
  });

  await step('delete the test folder (recursive) through the confirm dialog, then log out', async () => {
    await page.goto(BASE + '/?page=upload');
    await page.waitForSelector('#fileListBody .file-item');
    const folder = row(page, folderName);
    await folder.locator('button[title="Hapus"]').click();
    await page.waitForSelector('#confirmModal', { state: 'visible' });
    assert.match(await page.textContent('#confirmTitle'), new RegExp(folderName));
    assert.match(await page.textContent('#confirmText'), /6 item/);
    await page.screenshot({ path: path.join(SHOTS, '7-confirm.png') });
    await page.click('#confirmCancel');
    await page.waitForSelector('#confirmModal', { state: 'hidden' });
    assert.equal(await folder.count(), 1, 'Batal keeps the folder');
    await folder.locator('button[title="Hapus"]').click();
    await page.click('#confirmOk');
    await folder.waitFor({ state: 'detached' });
    await page.click('#logoutBtn');
    await page.waitForSelector('button[title="Masuk admin"]', { state: 'visible' });
    assert.equal(await page.locator('a.nav-link[data-page="upload"]').isVisible(), false);
  });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (errors.length) { console.error('\nBrowser errors:\n' + errors.join('\n')); process.exit(1); }
  console.log(`\nSemua langkah berhasil. Screenshot: ${SHOTS}`);
})().catch(e => { console.error('\nGAGAL:', e); process.exit(1); });
