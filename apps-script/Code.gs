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
const HEADERS = ['id', 'name', 'is_folder', 'folder_id', 'size', 'mime', 'drive_id', 'created_at'];

// ——— Jalankan sekali dari editor (pilih "setup" lalu klik Run) ———
function setup() {
  const s = getStore_();
  Logger.log('Siap. Folder Drive: https://drive.google.com/drive/folders/' + s.folderId);
}

// ——— HTTP ———
function doGet(e) {
  return handle_(() => {
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'list') return { items: readAll_(getStore_().sheet) };
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
  const item = { id: uid_(), name: name, is_folder: true, folder_id: b.folder_id || null, size: 0, mime: '', drive_id: '', created_at: new Date().toISOString() };
  withLock_(() => appendItem_(getStore_().sheet, item));
  return { item: item };
}

// Membuat sesi resumable upload di Drive. File dikirim per potongan lewat uploadChunk.
function startUpload_(b) {
  const store = getStore_();
  const mime = b.mime || 'application/octet-stream';
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ name: b.name, mimeType: mime, parents: [store.folderId] }),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(b.size || 0)
    },
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
  const file = DriveApp.getFileById(driveId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const item = {
    id: uid_(), name: String(b.name), is_folder: false, folder_id: b.folder_id || null,
    size: total, mime: b.mime || '', drive_id: driveId, created_at: new Date().toISOString()
  };
  withLock_(() => appendItem_(getStore_().sheet, item));
  return { done: true, item: item };
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
      if (ids[i.id] && i.drive_id) {
        try { DriveApp.getFileById(i.drive_id).setTrashed(true); } catch (err) { /* sudah terhapus */ }
      }
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
    return {};
  });
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
    sh.getRange('A:H').setNumberFormat('@'); // simpan semua sebagai teks
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sheetId = ss.getId();
    p.setProperty('SHEET_ID', sheetId);
  }
  return { folderId: folderId, sheet: SpreadsheetApp.openById(sheetId).getSheetByName(SHEET_NAME) };
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
      created_at: r[7] instanceof Date ? r[7].toISOString() : String(r[7])
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
    i.created_at
  ]);
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
