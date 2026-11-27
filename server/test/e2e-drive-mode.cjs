// Browser test of Google Drive mode, i.e. the site as GitHub Pages serves it from `main`.
//   npm run test:e2e:drive
// No server and no Google account needed: the repo's static files are served to the browser at a sub-path
// (like https://<user>.github.io/Materiakpol1/), and the Apps Script web app is replaced by an in-memory stub
// shaped like the owner's real data. Everything else (Drive thumbnails, YouTube, CDNs) is unreachable,
// which is also how the page has to behave on a network that blocks them.
// Needs Playwright with Chromium (set NODE_PATH if it is installed globally). Screenshots go to $SHOTS.
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..');
const OUT = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-drive-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const SITE = 'https://pages.test/Materiakpol1/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
const iso = d => new Date(Date.now() - d * 86400000).toISOString();
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
function seed() {
  const folder = (id, name) => ({ id, name, is_folder: true, folder_id: null, size: 0, mime: '', drive_id: 'DF-' + id, created_at: iso(30), url: '', variants: {} });
  const file = (id, name, folder_id, mime, size, days, extra = {}) => ({ id, name, is_folder: false, folder_id, size, mime, drive_id: 'D-' + id, created_at: iso(days), url: '', variants: {}, ...extra });
  return [
    folder('f1', 'reserse'), folder('f2', 'intel'), folder('f3', 'Polair'), folder('f4', 'ADM'), folder('f5', 'Lantas'),
    file('a1', 'Penyidikan Tindak Pidana.pptx', 'f1', PPTX, 5400000, 1),
    file('a2', 'Hukum Acara Pidana.pdf', 'f1', 'application/pdf', 820000, 9),
    file('a3', 'Dasar Intelijen.pptx', 'f2', PPTX, 3100000, 12),
    file('a4', 'Peraturan Perairan.pdf', 'f3', 'application/pdf', 640000, 20),
    file('a5', 'Administrasi Umum.docx', 'f4', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 91000, 4),
    file('a6', '01 Pengantar Lalu Lintas.mp4', 'f5', 'video/mp4', 48000000, 2, { variants: { 360: 'D-a6-low' } }),
    file('a7', 'Etika Berlalu Lintas', 'f5', 'video/youtube', 0, 6, { drive_id: '', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    file('a8', 'Jadwal Kuliah.xlsx', null, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 23000, 0),
  ];
}

async function open(browser, { phone = false, version = 3 } = {}) {
  const context = await browser.newContext(phone ? { ...devices['Pixel 7'], deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const state = { items: seed(), calls: [] };
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.href.startsWith(SITE)) {
      let rel = decodeURIComponent(url.pathname.slice('/Materiakpol1/'.length)) || 'index.html';
      const ok = rel === 'index.html' || rel === 'config.js' || rel.startsWith('assets/') || rel.startsWith('vendor/');
      const file = path.join(REPO, rel);
      if (!ok || rel.includes('..') || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(rel)] || 'application/octet-stream' });
    }
    if (url.hostname === 'script.google.com') {
      const json = o => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
      if (route.request().method() === 'GET') {
        return json(version >= 3 ? { ok: true, version, drive_folder: 'DRIVE-ROOT', items: state.items } : { ok: true, items: state.items.map(i => ({ ...i, drive_id: i.is_folder ? '' : i.drive_id })) });
      }
      const b = JSON.parse(route.request().postData() || '{}');
      state.calls.push(b);
      if (b.action === 'syncDrive') return json(version >= 3 ? { ok: true, added: 0 } : { ok: false, error: 'Aksi tidak dikenal: syncDrive' });
      if (b.action === 'move') { state.items.find(i => i.id === b.id).folder_id = b.folder_id || null; return json({ ok: true }); }
      if (b.action === 'delete') { state.items = state.items.filter(i => i.id !== b.id && i.folder_id !== b.id); return json({ ok: true, deleted: [b.id] }); }
      if (b.action === 'createFolder') { const item = { id: 'n' + state.items.length, name: b.name, is_folder: true, folder_id: b.folder_id || null, size: 0, mime: '', drive_id: 'DF-new', created_at: iso(0) }; state.items.push(item); return json({ ok: true, item }); }
      return json({ ok: false, error: 'Aksi tidak dikenal: ' + b.action });
    }
    return route.abort(); // Drive thumbnails, YouTube, CDNs: unreachable here
  });
  return { context, page, state, errors };
}
const shot = async (page, name, full = false) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full }); };
const step = async (name, fn) => { process.stdout.write(`• ${name} ... `); await fn(); console.log('ok'); };

(async () => {
  const browser = await chromium.launch();
  const allErrors = [];

  let t = await open(browser);
  let { page, state } = t;
  await step('home: mapel cards, loose files, everyone may edit (no login button)', async () => {
    await page.goto(SITE);
    await page.waitForSelector('#mapelGrid .mapel-card');
    assert.equal(await page.evaluate(() => document.body.className.includes('mode-drive') && document.body.className.includes('is-admin')), true);
    assert.equal(await page.locator('#mapelGrid .mapel-card').count(), 5);
    assert.equal(await page.locator('a.nav-link[data-page="upload"]').isVisible(), true);
    assert.equal(await page.locator('button[title="Masuk admin"]').isVisible(), false);
    assert.equal(await page.locator('#logoutBtn').isVisible(), false);
    assert.equal(await page.locator('#looseList .file-item').count(), 1, 'root files are listed under "Materi lainnya"');
    assert.match(await page.textContent('.footer-credit'), /Tim IT MS 60/);
    for (const img of ['#heroImg', 'header .brand-crest', '#mapelGrid .mapel-kentung'])
      await page.waitForFunction(s => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, img);
    await shot(page, 'drive-home', true);
  });
  await step('folder link works at the GitHub Pages sub-path; Office file shows the open-in-new-tab card', async () => {
    await page.click('.mapel-card:has(.mapel-name:text-is("reserse"))');
    await page.waitForSelector('#folderTitle:text-is("reserse")');
    assert.ok(page.url().startsWith(SITE + '?f=f1'), page.url());
    assert.equal(await page.locator('#fileListBody .file-item').count(), 2);
    assert.equal(await page.locator('#fileListBody button[title="Ganti nama"]').count(), 0);
    await page.click('#fileListBody .file-name:text-is("Penyidikan Tindak Pidana.pptx")');
    await page.waitForSelector('.office-preview .k-sticker');
    assert.match(await page.getAttribute('.office-preview a.btn', 'href'), /drive\.google\.com\/file\/d\/D-a1\/view/);
    await shot(page, 'drive-office');
    await page.click('#viewerCloseBtn');
    await page.click('#fileListBody .file-name:text-is("Hukum Acara Pidana.pdf")');
    assert.match(await page.getAttribute('#viewerBody iframe', 'src'), /drive\.google\.com\/file\/d\/D-a2\/preview/);
    await page.click('#viewerCloseBtn');
    await page.goBack();
    await page.waitForSelector('#mapelGrid .mapel-card');
    assert.equal(page.url(), SITE);
  });
  await step('upload page: Drive box, move and delete without rename', async () => {
    await page.click('a.nav-link[data-page="upload"]');
    await page.waitForSelector('#fileListBody .file-item');
    assert.equal(await page.locator('#driveBox').isVisible(), true);
    assert.match(await page.getAttribute('#driveOpenBtn', 'href'), /folders\/DRIVE-ROOT/);
    assert.equal(await page.locator('#fileListBody button[title="Ganti nama"]').count(), 0, 'Apps Script has no rename');
    await shot(page, 'drive-upload', true);
    await page.click('#fileListBody .file-name.folder-name:text-is("Lantas")');
    await page.waitForSelector('#folderTitle:text-is("Lantas")');
    assert.match(await page.getAttribute('#driveOpenBtn', 'href'), /folders\/DF-f5/);
    await page.locator('#fileListBody .file-item:has(.file-name:text-is("Etika Berlalu Lintas")) button[title="Pindahkan"]').click();
    await page.click('#moveList .pick-row:has(span:text-is("intel"))');
    await page.waitForSelector('#fileListBody .file-name:text-is("Etika Berlalu Lintas")', { state: 'detached' });
    assert.deepEqual(state.calls.filter(c => c.action === 'move').pop(), { action: 'move', id: 'a7', folder_id: 'f2' });
    await page.locator('#fileListBody .file-item:has(.file-name:text-is("01 Pengantar Lalu Lintas.mp4")) button[title="Hapus"]').click();
    assert.match(await page.textContent('#confirmText'), /Sampah Google Drive/);
    await page.click('#confirmOk');
    await page.waitForSelector('#fileListBody .file-name:text-is("01 Pengantar Lalu Lintas.mp4")', { state: 'detached' });
  });
  await step('courses: YouTube lesson explains itself when YouTube is blocked', async () => {
    await page.goto(SITE + '?page=courses');
    await page.waitForSelector('.course-card');
    await shot(page, 'drive-courses');
    await page.click('.course-card a.btn');
    await page.waitForSelector('#pEnd.open:has-text("YouTube tidak bisa diputar")', { timeout: 15000 });
    await page.waitForTimeout(700); // let the pop-in animation finish before measuring
    const box = await page.locator('#pEnd .k-sticker').boundingBox();
    assert.ok(box.width > 80 && box.width < 130 && box.height > 80, 'sticker keeps its shape: ' + JSON.stringify(box));
    await shot(page, 'drive-youtube-blocked');
  });
  allErrors.push(...t.errors.map(e => 'desktop ' + e));
  await t.context.close();

  t = await open(browser, { phone: true });
  page = t.page;
  await step('phone: tab bar has Materi / Kursus / Upload and nothing about login', async () => {
    await page.goto(SITE);
    await page.waitForSelector('#mapelGrid .mapel-card');
    const tabs = (await page.locator('.tabbar .tab-link:visible').allTextContents()).map(s => s.trim());
    assert.deepEqual(tabs, ['Materi', 'Kursus', 'Upload']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await shot(page, 'drive-home-phone', true);
    await page.click('.tabbar a[data-page="upload"]');
    await page.waitForSelector('#fileListBody .file-item');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await shot(page, 'drive-upload-phone', true);
  });
  allErrors.push(...t.errors.map(e => 'phone ' + e));
  await t.context.close();

  t = await open(browser, { version: 1 });
  page = t.page;
  await step('old Apps Script (v1, as still deployed): library loads, Drive box stays hidden', async () => {
    await page.goto(SITE);
    await page.waitForSelector('#mapelGrid .mapel-card');
    assert.equal(await page.locator('#mapelGrid .mapel-card').count(), 5);
    await page.goto(SITE + '?page=upload');
    await page.waitForSelector('#fileListBody .file-item');
    assert.equal(await page.locator('#driveBox').isVisible(), false);
    assert.equal(t.state.calls.some(c => c.action === 'syncDrive'), false, 'no syncDrive against v1');
  });
  allErrors.push(...t.errors.map(e => 'v1 ' + e));
  await t.context.close();

  await browser.close();
  if (allErrors.length) { console.error('\nBrowser errors:\n' + [...new Set(allErrors)].join('\n')); process.exit(1); }
  console.log(`\nMode Google Drive: semua langkah berhasil. Screenshot: ${OUT}`);
})().catch(e => { console.error('\nGAGAL:', e); process.exit(1); });
