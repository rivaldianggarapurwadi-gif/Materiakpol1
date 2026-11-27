// Sorting the library into one folder per subject (mapel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-org-'));
process.env.DATA_DIR = path.join(tmp, 'data');
const { items } = await import('../src/db.js');
const { organizeMapel, matchMapel, subfolderFor } = await import('../src/organize.js');

test('name matching', () => {
  assert.equal(matchMapel('Modul_Lalu-Lintas (2025).pdf'), 'Lantas');
  assert.equal(matchMapel('Intelijen Dasar.mp4'), 'Intel');
  assert.equal(matchMapel('Materi Manajemen Bin Polri.pptx'), 'Manajemen Bin Polri');
  assert.equal(matchMapel('IELTS Listening Test 1.mp3'), 'IELTS');
  assert.equal(matchMapel('KB pertemuan 3.docx'), 'Karakter Kebhayangkaraan');
  assert.equal(matchMapel('Kebijakan umum.pdf'), null); // "kb" only as a whole word
  assert.equal(matchMapel('Dasar TIK.pdf'), 'TIK');
  assert.equal(matchMapel('Statistik.pdf'), null);      // "tik" only as a whole word
  assert.equal(matchMapel('Intelektual.pdf'), null);
  assert.equal(matchMapel('Sabhara dan Lantas.pdf'), 'ambiguous');
  assert.equal(matchMapel('Foto upacara.jpg'), null);
});

test('subfolder by file type', () => {
  assert.equal(subfolderFor({ name: 'Bab 1.mp4', mime: 'video/mp4' }), 'Video');
  assert.equal(subfolderFor({ name: 'Etika', mime: 'video/youtube' }), 'Video');
  assert.equal(subfolderFor({ name: 'Materi 2.pptx', mime: '' }), 'PPT');
  assert.equal(subfolderFor({ name: 'Tentir UTS Lantas.pdf', mime: '' }), 'Tentir');
  assert.equal(subfolderFor({ name: 'Rangkuman Bab 3.pptx', mime: '' }), 'Tentir'); // the name wins over the type
  assert.equal(subfolderFor({ name: 'Modul.pdf', mime: 'application/pdf' }), null);
  assert.equal(subfolderFor({ name: 'Sub', is_folder: true }), null);
});

test('dry run changes nothing; apply sorts and keeps folder structure', () => {
  const add = (id, name, folder_id = null, is_folder = false) => items.insert({ id, name, is_folder, folder_id });
  add('sab', 'sabhara', null, true);                 // existing root folder is reused (case-insensitive)
  add('f1', 'Modul Lalu Lintas.pdf');
  add('old', 'Materi Semester 1', null, true);       // non-matching folder: searched inside
  add('f2', 'Intelijen Dasar.mp4', 'old');
  add('f3', 'Catatan umum.txt', 'old');
  add('pol', 'Polair 2025', null, true);             // matching folder moves as a whole
  add('f4', 'video kapal.mp4', 'pol');
  add('f5', 'Sabhara dan Lantas.pdf');
  add('f6', 'Turjawali.pdf', 'sab');                 // already in place, not a video/PPT/tentir
  add('f7', 'Sabhara bab 1.pptx', 'sab');            // loose slides in a mapel → PPT
  add('f8', 'Tentir Sabhara.docx');                  // into Sabhara, then into Tentir
  add('vid', 'video', 'sab', true);                  // existing "Video" folder is reused (case-insensitive)

  const quiet = () => {};
  const plan = organizeMapel({ apply: false, log: quiet });
  assert.equal(plan.moves, 4);
  assert.equal(plan.subMoves, 3); // f2 → Intel›Video, f7 → Sabhara›PPT, f8 → Sabhara›Tentir
  assert.equal(items.get('f1').folder_id, null);
  assert.equal(items.all().filter(i => i.is_folder).length, 4);

  const r = organizeMapel({ apply: true, log: quiet });
  assert.equal(r.moves, 4);
  assert.equal(r.created.length, 10); // all but Sabhara
  assert.equal(r.subCreated.length, 32); // 11 mapel × 3, minus Sabhara's existing Video
  const sub = (mapel, name) => items.all().find(i => i.is_folder && i.name === name && i.folder_id === root(mapel).id);
  const root = name => items.all().find(i => i.is_folder && !i.folder_id && i.name.toLowerCase() === name.toLowerCase());
  assert.equal(items.get('f1').folder_id, root('Lantas').id); // PDF without a hint stays in the mapel folder
  assert.equal(items.get('f2').folder_id, sub('Intel', 'Video').id);
  assert.equal(items.get('f7').folder_id, sub('Sabhara', 'PPT').id);
  assert.equal(items.get('f8').folder_id, sub('Sabhara', 'Tentir').id);
  assert.equal(sub('Sabhara', 'video').id, 'vid');
  for (const m of ['Binmas', 'Karakter Kebhayangkaraan', 'Lantas']) for (const n of ['Video', 'PPT', 'Tentir']) assert.ok(sub(m, n), `${m}/${n}`);
  assert.equal(items.get('pol').folder_id, root('Polair').id);
  assert.equal(items.get('f4').folder_id, 'pol');
  assert.equal(items.get('f3').folder_id, 'old');
  assert.equal(items.get('f5').folder_id, null);
  assert.equal(items.get('f6').folder_id, 'sab');
  assert.deepEqual(r.ambiguous, ['Sabhara dan Lantas.pdf']);
  assert.ok(r.unmatched.includes('Catatan umum.txt'));

  // running again is a no-op
  const again = organizeMapel({ apply: true, log: quiet });
  assert.equal(again.moves + again.subMoves + again.subCreated.length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
