// Sorting the library into one folder per subject (mapel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-org-'));
process.env.DATA_DIR = path.join(tmp, 'data');
const { items } = await import('../src/db.js');
const { organizeMapel, matchMapel } = await import('../src/organize.js');

test('name matching', () => {
  assert.equal(matchMapel('Modul_Lalu-Lintas (2025).pdf'), 'Lantas');
  assert.equal(matchMapel('Intelijen Dasar.mp4'), 'Intel');
  assert.equal(matchMapel('Materi Manajemen Bin Polri.pptx'), 'Manajemen Bin Polri');
  assert.equal(matchMapel('IELTS Listening Test 1.mp3'), 'IELTS');
  assert.equal(matchMapel('KB pertemuan 3.docx'), 'KB');
  assert.equal(matchMapel('Kebijakan umum.pdf'), null); // "kb" only as a whole word
  assert.equal(matchMapel('Dasar TIK.pdf'), 'TIK');
  assert.equal(matchMapel('Statistik.pdf'), null);      // "tik" only as a whole word
  assert.equal(matchMapel('Intelektual.pdf'), null);
  assert.equal(matchMapel('Sabhara dan Lantas.pdf'), 'ambiguous');
  assert.equal(matchMapel('Foto upacara.jpg'), null);
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
  add('f6', 'Turjawali.pdf', 'sab');                 // already in place

  const quiet = () => {};
  const plan = organizeMapel({ apply: false, log: quiet });
  assert.equal(plan.moves, 3);
  assert.equal(items.get('f1').folder_id, null);
  assert.equal(items.all().filter(i => i.is_folder).length, 3);

  const r = organizeMapel({ apply: true, log: quiet });
  assert.equal(r.moves, 3);
  assert.equal(r.created.length, 10); // all but Sabhara
  const root = name => items.all().find(i => i.is_folder && !i.folder_id && i.name === name);
  assert.equal(items.get('f1').folder_id, root('Lantas').id);
  assert.equal(items.get('f2').folder_id, root('Intel').id);
  assert.equal(items.get('pol').folder_id, root('Polair').id);
  assert.equal(items.get('f4').folder_id, 'pol');
  assert.equal(items.get('f3').folder_id, 'old');
  assert.equal(items.get('f5').folder_id, null);
  assert.equal(items.get('f6').folder_id, 'sab');
  assert.deepEqual(r.ambiguous, ['Sabhara dan Lantas.pdf']);
  assert.ok(r.unmatched.includes('Catatan umum.txt'));

  // running again is a no-op
  assert.equal(organizeMapel({ apply: true, log: quiet }).moves, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
