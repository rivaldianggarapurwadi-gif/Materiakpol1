// organize-mapel on the library as it comes out of the Google Drive migration (the owner's real names, Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-orgdrive-'));
process.env.DATA_DIR = path.join(tmp, 'data');
const { items } = await import('../src/db.js');
const { organizeMapel, matchMapel } = await import('../src/organize.js');

test('extra words for the owner\'s file names', () => {
  assert.equal(matchMapel('4. PERTEMUAN 4 Teori Pokdar Kamtibmas.pptx'), 'Binmas');
  assert.equal(matchMapel('3. 24 OKTOBER 2026 TRI WIDADA FIX..... BLANGKO LP MODEL A.pdf'), 'Reserse');
  assert.equal(matchMapel('2. PENANGANAN TKP(1). PENANGANAN TKP.pdf'), 'Reserse');
  assert.equal(matchMapel('( answer key) CHAPTER 3 LISTENING FOR ACTIONS AND PROCESSES - Copy.pptx'), 'IELTS');
  assert.equal(matchMapel('ADM'), 'Administrasi Kepolisian');
  assert.equal(matchMapel('Admiral.pdf'), null); // whole words only
});

test('Drive folders named after a subject become the subject folder and get sorted', () => {
  const add = (id, name, folder_id = null, is_folder = false, mime = '') => items.insert({ id, name, is_folder, folder_id, mime });
  // root folders as they exist in Google Drive
  add('res', 'reserse', null, true);
  add('int', 'intel', null, true);
  add('pol', 'Polair', null, true);
  add('adm', 'ADM', null, true);
  add('lan', 'Lantas', null, true);
  // files inside them
  add('r1', '1. Hakikat Reserse 1 (1).pptx', 'res');
  add('r2', '2. PENANGANAN TKP(1). PENANGANAN TKP.pdf', 'res');
  add('i1', 'TEORI DASAR INTEL.pptx', 'int');
  add('i2', 'SEJARAH INTELIJEN.pptx', 'int');
  add('p1', 'POLAIR Pertemuan 7.pptx', 'pol');
  add('a1', 'PERTEMUAN 1 EDIT.pptx', 'adm');
  add('a2', 'PERTEMUAN 2 EDIT.pptx', 'adm');
  add('v1', 'Latihan lapangan.mp4', 'adm', false, 'video/mp4');
  // loose files at the root
  add('l1', 'POLAIR pertemuan 6.pptx');
  add('l2', 'Konsep_Operasional_Intelkam_Polri.pptx');
  add('l3', '4. PERTEMUAN 4 Teori Pokdar Kamtibmas.pptx');
  add('l4', '3. 24 OKTOBER 2026 TRI WIDADA FIX..... BLANGKO LP MODEL A.pdf');
  add('l5', '( answer key) CHAPTER 3 LISTENING FOR ACTIONS AND PROCESSES - Copy.pptx');
  add('l6', 'PPT HEATSTROKE.pptx');

  const quiet = () => {};
  const plan = organizeMapel({ apply: false, log: quiet });
  assert.deepEqual(plan.renamed.map(x => x.from).sort(), ['ADM', 'intel', 'reserse']);
  assert.equal(items.get('adm').name, 'ADM'); // dry run changes nothing

  const r = organizeMapel({ apply: true, log: quiet });
  const root = name => items.all().find(i => i.is_folder && !i.folder_id && i.name === name);
  const sub = (mapel, name) => items.all().find(i => i.is_folder && i.name === name && i.folder_id === root(mapel).id);

  // the Drive folders are reused under the subject name, no duplicates
  assert.equal(root('Administrasi Kepolisian').id, 'adm');
  assert.equal(root('Reserse').id, 'res');
  assert.equal(root('Intel').id, 'int');
  assert.equal(root('Polair').id, 'pol');
  assert.equal(root('Lantas').id, 'lan');
  assert.equal(items.all().filter(i => i.is_folder && !i.folder_id).length, 11);

  // files inside them land in Video / PPT; PDFs without a hint stay in the subject folder
  assert.equal(items.get('a1').folder_id, sub('Administrasi Kepolisian', 'PPT').id);
  assert.equal(items.get('v1').folder_id, sub('Administrasi Kepolisian', 'Video').id);
  assert.equal(items.get('r1').folder_id, sub('Reserse', 'PPT').id);
  assert.equal(items.get('r2').folder_id, 'res');
  assert.equal(items.get('i2').folder_id, sub('Intel', 'PPT').id);
  assert.equal(items.get('p1').folder_id, sub('Polair', 'PPT').id);

  // loose root files go to their subject
  assert.equal(items.get('l1').folder_id, sub('Polair', 'PPT').id);
  assert.equal(items.get('l2').folder_id, sub('Intel', 'PPT').id);
  assert.equal(items.get('l3').folder_id, sub('Binmas', 'PPT').id);
  assert.equal(items.get('l4').folder_id, 'res');
  assert.equal(items.get('l5').folder_id, sub('IELTS', 'PPT').id);
  assert.equal(items.get('l6').folder_id, null); // not recognised: stays where it is
  assert.ok(r.unmatched.includes('PPT HEATSTROKE.pptx'));

  // second run changes nothing
  const again = organizeMapel({ apply: true, log: quiet });
  assert.equal(again.moves + again.subMoves + again.renamed.length + again.created.length + again.subCreated.length, 0);
});
