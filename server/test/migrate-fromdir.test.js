// migrate-drive --from-dir: the server imports what another computer downloaded (for networks that block Google).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akpol-fromdir-'));
process.env.DATA_DIR = path.join(tmp, 'data');
const dir = path.join(tmp, 'import');
fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
fs.writeFileSync(path.join(dir, 'list.json'), JSON.stringify({ ok: true, version: 3, items: [
  { id: 'fPol', name: 'Polair', is_folder: true, folder_id: null, created_at: '2026-11-01T00:00:00Z' },
  { id: 'p1', name: 'POLAIR pertemuan 6.pptx', is_folder: false, folder_id: 'fPol', size: 5, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', drive_id: 'DRV_p1', created_at: '2026-11-20T00:00:00Z' },
  { id: 'p2', name: 'Modul.pdf', is_folder: false, folder_id: null, size: 4, mime: 'application/pdf', drive_id: 'DRV_p2', created_at: '2026-11-21T00:00:00Z' },
] }));

test('lists missing ids, imports downloaded files, and reports the rest', async () => {
  const { migrateFromDrive } = await import('../src/migrate.js');
  const { items } = await import('../src/db.js');
  const quiet = () => {};

  // --missing-ids prints every Drive id still to fetch
  const out = [];
  const orig = console.log;
  console.log = m => out.push(m);
  try { await migrateFromDrive(undefined, { fromDir: dir, missingIds: true, dryRun: false, log: quiet }); }
  finally { console.log = orig; }
  assert.deepEqual(out.sort(), ['DRV_p1', 'DRV_p2']);

  // only one file has been downloaded so far
  fs.writeFileSync(path.join(dir, 'files', 'DRV_p1'), 'pptx!');
  const r1 = await migrateFromDrive(undefined, { fromDir: dir, dryRun: false, log: quiet });
  assert.equal(r1.done, 1);
  assert.equal(r1.failed.length, 1);
  assert.match(r1.failed[0].error, /belum diunduh/);
  process.exitCode = 0;
  assert.equal(items.get('p1').folder_id, 'fPol');
  assert.equal(items.get('p1').source, 'drive:DRV_p1');

  // after the rest arrives, a second run imports only what is missing
  fs.writeFileSync(path.join(dir, 'files', 'DRV_p2'), 'pdf!');
  const r2 = await migrateFromDrive(undefined, { fromDir: dir, dryRun: false, log: quiet });
  assert.equal(r2.done, 1);
  assert.equal(r2.failed.length, 0);
  assert.equal(items.all().length, 3);
});
