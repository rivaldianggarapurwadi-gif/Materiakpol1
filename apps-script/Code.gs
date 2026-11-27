/**
 * Backend Materi AKPOL — Google Drive + Google Sheets (gratis).
 *
 * File disimpan di folder Google Drive "Materi AKPOL (jangan dihapus)".
 * Daftar file/folder disimpan di Google Sheet "Materi AKPOL - Database"
 * di dalam folder yang sama. Keduanya dibuat otomatis saat setup().
 *
 * Cara pasang: lihat SETUP.md
 */

const SHEET_NAME = 'items';
const HEADERS = ['id', 'name', 'is_folder', 'folder_id', 'size', 'mime', 'drive_id', 'created_at', 'url', 'variants'];
const API_VERSION = 3; // 2 = upload langsung ke Drive + versi 360p; 3 = sinkron dengan folder Google Drive

// ——— Jalankan sekali dari editor (pilih "setup" lalu klik Run) ———
function setup() {
  const s = getStore_();
  Logger.log('Siap. Folder Drive: https://drive.google.com/drive/folders/' + s.folderId);
}

// ——— HTTP ———
function doGet(e) {
  return handle_(() => {
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'list') { const st = getStore_(); return { version: API_VERSION, drive_folder: st.folderId, items: readAll_(st.sheet) }; }
    throw new Error('Aksi tidak dikenal: ' + action);
  });
}

function doPost(e) {
  return handle_(() => {
    const b = JSON.parse(e.postData.contents);
    switch (b.action) {
      case 'createFolder': return createFolder_(b);
      case 'startUpload':  return startUpload_(b);
      case 'uploadChunk':  return uploadChunk_(b);
      case 'delete':       return deleteItem_(b);
      case 'move':         return moveItem_(b);
      case 'addLink':      return addLink_(b);
      case 'finishUpload': return finishUpload_(b);
      case 'syncDrive':    return syncDrive_(b);
      default: throw new Error('Aksi tidak dikenal: ' + b.action);
    }
  });
}

function handle_(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ——— Actions ———
function createFolder_(b) {
  const name = String(b.name || '').trim();
  if (!name) throw new Error('Nama folder kosong');
  const store = getStore_();
  // Folder yang sama juga dibuat di Google Drive, supaya video bisa diupload langsung lewat Drive
  const parent = driveFolderFor_(store, readAll_(store.sheet), b.folder_id || null);
  const df = parent.createFolder(name);
  const item = { id: uid_(), name: name, is_folder: true, folder_id: b.folder_id || null, size: 0, mime: '', drive_id: df.getId(), created_at: new Date().toISOString() };
  withLock_(() => appendItem_(store.sheet, item));
  return { item: item };
}

// Video YouTube: disimpan sebagai link, diputar langsung di web (tidak memakai kuota Drive)
function addLink_(b) {
  const m = String(b.url || '').match(/^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/);
  if (!m) throw new Error('Link YouTube tidak valid');
  const name = String(b.name || '').trim() || 'Video YouTube';
  const item = { id: uid_(), name: name, is_folder: false, folder_id: b.folder_id || null, size: 0, mime: 'video/youtube', drive_id: '', created_at: new Date().toISOString(), url: m[0] };
  withLock_(() => appendItem_(getStore_().sheet, item));
  return { item: item };
}

// Membuat sesi resumable upload di Drive. File dikirim per potongan lewat uploadChunk.
function startUpload_(b) {
  const store = getStore_();
  const mime = b.mime || 'application/octet-stream';
  const headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'X-Upload-Content-Type': mime,
    'X-Upload-Content-Length': String(b.size || 0)
  };
  // Origin web → browser boleh mengirim file LANGSUNG ke Google Drive (jauh lebih cepat)
  if (/^https?:\/\/[^\/]+$/.test(String(b.origin || ''))) headers.Origin = b.origin;
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ name: b.name, mimeType: mime, description: WEB_UPLOAD_TAG, parents: [driveFolderFor_(store, readAll_(store.sheet), b.folder_id || null).getId()] }),
    headers: headers,
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Gagal memulai upload: ' + res.getContentText());
  const h = res.getAllHeaders();
  const session = h.Location || h.location;
  if (!session) throw new Error('Drive tidak memberi URL sesi upload');
  return { session: session };
}

function uploadChunk_(b) {
  if (!/^https:\/\/www\.googleapis\.com\/upload\/drive\//.test(String(b.session))) throw new Error('Sesi upload tidak valid');
  const bytes = b.data ? Utilities.base64Decode(b.data) : [];
  const total = Number(b.total) || 0;
  const start = Number(b.start) || 0;
  const range = total === 0 ? 'bytes */0' : 'bytes ' + start + '-' + (start + bytes.length - 1) + '/' + total;
  const res = UrlFetchApp.fetch(b.session, {
    method: 'put',
    contentType: 'application/octet-stream',
    payload: bytes,
    headers: { 'Content-Range': range },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 308) return { done: false };
  if (code !== 200 && code !== 201) throw new Error('Upload gagal (' + code + '): ' + res.getContentText());

  const driveId = JSON.parse(res.getContentText()).id;
  if (b.register === false) return { done: true, drive_id: driveId }; // didaftarkan lewat finishUpload
  const file = DriveApp.getFileById(driveId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const item = {
    id: uid_(), name: String(b.name), is_folder: false, folder_id: b.folder_id || null,
    size: total, mime: b.mime || '', drive_id: driveId, created_at: new Date().toISOString()
  };
  withLock_(() => appendItem_(getStore_().sheet, item));
  return { done: true, item: item };
}

// Mendaftarkan file yang sudah selesai diupload (langsung dari browser) ke daftar materi.
// variants: versi video lain, mis. { "360": "<driveId>" } untuk koneksi lambat.
function finishUpload_(b) {
  const store = getStore_();
  const variants = {};
  Object.keys(b.variants || {}).forEach(k => { if (/^\d{3,4}$/.test(k)) variants[k] = String(b.variants[k]); });
  const ids = [String(b.drive_id)].concat(Object.keys(variants).map(k => variants[k]));
  const registered = {};
  readAll_(store.sheet).forEach(i => {
    if (i.drive_id) registered[i.drive_id] = true;
    Object.keys(i.variants || {}).forEach(k => registered[i.variants[k]] = true);
  });
  ids.forEach(id => {
    if (registered[id]) throw new Error('File sudah terdaftar');
    const f = DriveApp.getFileById(id);
    // hanya file di folder materi yang boleh didaftarkan
    if (!inAppTree_(f, store.folderId)) throw new Error('File tidak valid');
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  });
  const main = DriveApp.getFileById(String(b.drive_id));
  const item = {
    id: uid_(), name: String(b.name || main.getName()), is_folder: false, folder_id: b.folder_id || null,
    size: main.getSize(), mime: b.mime || main.getMimeType(), drive_id: main.getId(),
    created_at: new Date().toISOString(), variants: variants
  };
  withLock_(() => appendItem_(store.sheet, item));
  return { item: item };
}

function deleteItem_(b) {
  return withLock_(() => {
    const sheet = getStore_().sheet;
    const items = readAll_(sheet);
    const ids = {};
    ids[b.id] = true;
    // kumpulkan semua turunan
    let grew = true;
    while (grew) {
      grew = false;
      items.forEach(i => { if (i.folder_id && ids[i.folder_id] && !ids[i.id]) { ids[i.id] = true; grew = true; } });
    }
    items.forEach(i => {
      if (!ids[i.id]) return;
      if (i.is_folder) {
        if (i.drive_id) try { DriveApp.getFolderById(i.drive_id).setTrashed(true); } catch (err) { /* sudah terhapus */ }
        return;
      }
      const files = [i.drive_id].concat(Object.keys(i.variants || {}).map(k => i.variants[k])).filter(Boolean);
      files.forEach(f => { try { DriveApp.getFileById(f).setTrashed(true); } catch (err) { /* sudah terhapus */ } });
    });
    const col = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    for (let r = col.length - 1; r >= 1; r--) {
      if (ids[String(col[r][0])]) sheet.deleteRow(r + 1);
    }
    return { deleted: Object.keys(ids) };
  });
}

function moveItem_(b) {
  return withLock_(() => {
    const sheet = getStore_().sheet;
    const row = findRow_(sheet, b.id);
    if (!row) throw new Error('Item tidak ditemukan');
    sheet.getRange(row, 4).setValue(b.folder_id || '');
    // Pindahkan juga di Google Drive (tidak wajib berhasil)
    try {
      const store = getStore_();
      const items = readAll_(sheet);
      const it = items.find(i => i.id === b.id);
      const target = driveFolderFor_(store, items, b.folder_id || null);
      if (it && it.drive_id) (it.is_folder ? DriveApp.getFolderById(it.drive_id) : DriveApp.getFileById(it.drive_id)).moveTo(target);
    } catch (err) { /* abaikan */ }
    return {};
  });
}

// ——— Sinkron dengan Google Drive ———
// File yang diupload LANGSUNG ke folder "Materi AKPOL (jangan dihapus)" di Google Drive (web / aplikasi Drive)
// otomatis muncul di web. Subfolder Drive = folder kursus di web.
function syncDrive_(b) {
  const p = PropertiesService.getScriptProperties();
  const last = Number(p.getProperty('LAST_SYNC') || 0);
  if (!(b && b.force) && Date.now() - last < 60 * 1000) return { added: 0, skipped: true };
  return withLock_(() => {
    p.setProperty('LAST_SYNC', String(Date.now()));
    const store = getStore_();
    const started = Date.now();
    let items = readAll_(store.sheet);
    // 1) Folder web yang belum punya folder Drive → buat (induk dulu)
    let pending = items.filter(i => i.is_folder && !i.drive_id);
    for (let guard = 0; pending.length && guard < 50; guard++) {
      pending.forEach(f => {
        const parent = f.folder_id ? items.find(i => i.id === f.folder_id) : null;
        if (parent && !parent.drive_id) return; // induk belum punya, tunggu putaran berikutnya
        const df = childFolderNamed_(parent ? DriveApp.getFolderById(parent.drive_id) : DriveApp.getFolderById(store.folderId), f.name, items);
        f.drive_id = df.getId();
        const row = findRow_(store.sheet, f.id);
        if (row) store.sheet.getRange(row, 7).setValue(f.drive_id);
      });
      pending = pending.filter(f => !f.drive_id);
    }
    // 2) Telusuri Drive, daftarkan yang baru
    const known = {};
    items.forEach(i => {
      if (i.drive_id) known[i.drive_id] = i;
      Object.keys(i.variants || {}).forEach(k => known[i.variants[k]] = i);
    });
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    let added = 0, timedOut = false;
    const walk = (folder, siteFolderId) => {
      const subs = folder.getFolders();
      while (subs.hasNext()) {
        const sub = subs.next();
        if (sub.isTrashed()) continue;
        let it = known[sub.getId()];
        if (!it) {
          it = { id: uid_(), name: sub.getName(), is_folder: true, folder_id: siteFolderId, size: 0, mime: '', drive_id: sub.getId(), created_at: sub.getDateCreated().toISOString() };
          appendItem_(store.sheet, it); known[it.drive_id] = it; added++;
        }
        if (it.is_folder) walk(sub, it.id);
      }
      const files = folder.getFiles();
      while (files.hasNext()) {
        if (Date.now() - started > 25000) { timedOut = true; return; }
        const f = files.next();
        const id = f.getId();
        if (known[id] || id === sheetId || f.isTrashed()) continue;
        const mime = f.getMimeType();
        if (/^application\/vnd\.google-apps\./.test(mime)) continue; // Google Docs/Sheets tidak didukung
        // Upload lewat web didaftarkan sendiri oleh finishUpload — jangan didahului (kecuali sudah lama terbengkalai)
        if (f.getDescription() === WEB_UPLOAD_TAG && Date.now() - f.getDateCreated().getTime() < 60 * 60 * 1000) continue;
        try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* kebijakan domain */ }
        const it = { id: uid_(), name: f.getName(), is_folder: false, folder_id: siteFolderId, size: f.getSize(), mime: mime, drive_id: id, created_at: f.getDateCreated().toISOString() };
        appendItem_(store.sheet, it); known[id] = it; added++;
      }
    };
    walk(DriveApp.getFolderById(store.folderId), null);
    return { added: added, partial: timedOut };
  });
}

const WEB_UPLOAD_TAG = 'akpol-web-upload';

// Folder Drive untuk folder web (null = folder utama). Dibuat bila belum ada.
function driveFolderFor_(store, items, siteFolderId) {
  if (!siteFolderId) return DriveApp.getFolderById(store.folderId);
  const it = items.find(i => i.id === siteFolderId);
  if (!it) return DriveApp.getFolderById(store.folderId);
  if (it.drive_id) { try { return DriveApp.getFolderById(it.drive_id); } catch (err) { /* dihapus di Drive → buat ulang */ } }
  const df = childFolderNamed_(driveFolderFor_(store, items, it.folder_id), it.name, items);
  it.drive_id = df.getId();
  const row = findRow_(store.sheet, it.id);
  if (row) store.sheet.getRange(row, 7).setValue(it.drive_id);
  return df;
}

// Pakai subfolder Drive yang namanya sama (dan belum dipakai folder web lain); kalau tidak ada, buat baru.
// Mencegah kursus dobel bila pengguna sudah membuat folder sendiri di Drive.
function childFolderNamed_(parentFolder, name, items) {
  const used = {};
  items.forEach(i => { if (i.drive_id) used[i.drive_id] = true; });
  const it = parentFolder.getFoldersByName(name);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed() && !used[f.getId()]) return f;
  }
  return parentFolder.createFolder(name);
}

function inAppTree_(fileOrFolder, rootId) {
  let parents = fileOrFolder.getParents();
  for (let depth = 0; depth < 20 && parents.hasNext(); depth++) {
    const p = parents.next();
    if (p.getId() === rootId) return true;
    parents = p.getParents();
  }
  return false;
}

// ——— Storage helpers ———
function getStore_() {
  const p = PropertiesService.getScriptProperties();
  let folderId = p.getProperty('FOLDER_ID');
  let sheetId = p.getProperty('SHEET_ID');
  if (!folderId) {
    folderId = DriveApp.createFolder('Materi AKPOL (jangan dihapus)').getId();
    p.setProperty('FOLDER_ID', folderId);
  }
  if (!sheetId) {
    const ss = SpreadsheetApp.create('Materi AKPOL - Database');
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderId));
    const sh = ss.getSheets()[0];
    sh.setName(SHEET_NAME);
    sh.getRange('A:J').setNumberFormat('@'); // simpan semua sebagai teks
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sheetId = ss.getId();
    p.setProperty('SHEET_ID', sheetId);
  }
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(SHEET_NAME);
  // Sheet lama (sebelum fitur video) belum punya kolom "url"
  // Sheet lama belum punya kolom baru ("url", "variants")
  for (let c = 1; c <= HEADERS.length; c++) {
    if (sheet.getRange(1, c).getValue() === '') {
      sheet.getRange(1, c).setValue(HEADERS[c - 1]);
      sheet.getRange(1, c, sheet.getMaxRows(), 1).setNumberFormat('@');
    }
  }
  return { folderId: folderId, sheet: sheet };
}

function readAll_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, HEADERS.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => ({
      id: String(r[0]),
      name: String(r[1]),
      is_folder: String(r[2]) === '1' || r[2] === true,
      folder_id: r[3] === '' ? null : String(r[3]),
      size: Number(r[4]) || 0,
      mime: String(r[5] || ''),
      drive_id: String(r[6] || ''),
      created_at: r[7] instanceof Date ? r[7].toISOString() : String(r[7]),
      url: String(r[8] || ''),
      variants: parseJson_(r[9])
    }));
}

function appendItem_(sheet, i) {
  sheet.appendRow([
    i.id,
    "'" + i.name, // tanda ' agar nama yang diawali "=" tidak dianggap rumus
    i.is_folder ? '1' : '0',
    i.folder_id || '',
    String(i.size || 0),
    i.mime || '',
    i.drive_id || '',
    i.created_at,
    i.url || '',
    i.variants && Object.keys(i.variants).length ? JSON.stringify(i.variants) : ''
  ]);
}

function parseJson_(v) {
  try { return v ? JSON.parse(String(v)) : {}; } catch (e) { return {}; }
}

function findRow_(sheet, id) {
  const col = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let r = 1; r < col.length; r++) if (String(col[r][0]) === String(id)) return r + 1;
  return 0;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function uid_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ——— Opsional: pindahkan materi lama dari Supabase ———
// Jalankan dari editor setelah project Supabase bisa diakses lagi.
// Aman dijalankan berulang kali: item yang sudah dipindah dilewati.
// Batas waktu Apps Script 6 menit per run — kalau berhenti di tengah, Run lagi.
const SUPABASE_URL = 'https://mqfhqudtcoxpqmbanoju.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xZmhxdWR0Y294cHFtYmFub2p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MDU2MDAsImV4cCI6MjEwMTM4MTYwMH0.0QIbZPJu53PeCFgF8KJggyI06TP_0pSX7doM-eB9Ddw';

function migrateFromSupabase() {
  const started = Date.now();
  const store = getStore_();
  const folder = DriveApp.getFolderById(store.folderId);
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/items?order=created_at.asc', {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Supabase belum bisa diakses: ' + res.getContentText());
  const rows = JSON.parse(res.getContentText());
  const have = {};
  readAll_(store.sheet).forEach(i => have[i.id] = true);
  const failed = [];
  let moved = 0;

  for (const r of rows) {
    if (have[r.id]) continue;
    if (Date.now() - started > 5 * 60 * 1000) { Logger.log('Waktu hampir habis — klik Run lagi untuk melanjutkan.'); break; }
    const item = { id: r.id, name: r.name, is_folder: !!r.is_folder, folder_id: r.folder_id || null, size: r.size || 0, mime: r.mime || '', drive_id: '', created_at: r.created_at };
    if (!r.is_folder) {
      try {
        const f = UrlFetchApp.fetch(SUPABASE_URL + '/storage/v1/object/public/materi/' + r.storage_path, { muteHttpExceptions: true });
        if (f.getResponseCode() !== 200) throw new Error('HTTP ' + f.getResponseCode());
        const file = folder.createFile(f.getBlob().setName(r.name));
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        item.drive_id = file.getId();
      } catch (err) {
        failed.push(r.name + ' (' + err.message + ')');
        continue;
      }
    }
    withLock_(() => appendItem_(store.sheet, item));
    moved++;
  }
  Logger.log('Dipindahkan: ' + moved);
  if (failed.length) Logger.log('Gagal (upload manual lewat web, file >50MB tidak bisa dipindah otomatis):\n' + failed.join('\n'));
}
