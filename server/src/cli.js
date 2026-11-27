// Admin command-line tool. In Docker: docker compose exec app node src/cli.js <command>
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { config } from './config.js';
import { db, items, enqueue } from './db.js';
import { admins } from './auth.js';
import { kindOf, purgeTrash, diskFree } from './storage.js';

const HELP = `Materi AKPOL — perintah admin

  add-admin <nama>          Buat admin baru (atau ganti kata sandi admin yang sudah ada)
  remove-admin <nama>       Hapus admin
  list-admins               Daftar admin
  backup [file]             Salin database ke file (bawaan: data/backups/akpol-<tanggal>.sqlite)
  reprocess <id|--failed|--missing|--all-videos>
                            Proses ulang file (gagal / hasil proses hilang setelah pemulihan / semua video)
  migrate-drive [URL]       Pindahkan semua materi dari Google Drive (URL Web App Apps Script)
  organize-mapel [--apply]  Rapikan materi ke satu folder per mapel + subfolder Video/PPT/Tentir
                            (tanpa --apply: hanya rencana)
  loadtest [URL] [--max N]  Uji beban: berapa orang bisa menonton bersamaan (hanya membaca)
  purge-trash [hari]        Hapus permanen isi sampah yang lebih lama dari [hari] (bawaan ${config.trashDays})
  status                    Ringkasan: jumlah materi, antrean proses, sisa disk
`;

function askHidden(question) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) {
      // Non-interactive: read the password from the first line of stdin.
      let buf = '';
      process.stdin.on('data', d => { buf += d; });
      process.stdin.on('end', () => resolve(buf.split('\n')[0].trim()));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, a => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const fmt = b => b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : (b / 1024 ** 2).toFixed(0) + ' MB';

async function main([cmd, ...args]) {
  switch (cmd) {
    case 'add-admin': {
      const name = args[0];
      if (!name) throw new Error('Pakai: add-admin <nama>');
      let pw = process.env.ADMIN_PASSWORD;
      if (!pw) {
        pw = await askHidden(`Kata sandi untuk "${name}" (min. 8 karakter): `);
        if (process.stdin.isTTY) {
          const again = await askHidden('Ulangi kata sandi: ');
          if (again !== pw) throw new Error('Kata sandi tidak sama');
        }
      }
      const created = admins.set(name, pw);
      console.log(created ? `Admin "${name}" dibuat.` : `Kata sandi admin "${name}" diganti (sesi lama dikeluarkan).`);
      break;
    }
    case 'remove-admin':
      if (!args[0]) throw new Error('Pakai: remove-admin <nama>');
      console.log(admins.remove(args[0]) ? `Admin "${args[0]}" dihapus.` : `Admin "${args[0]}" tidak ada.`);
      break;
    case 'list-admins': {
      const list = admins.list();
      console.log(list.length ? list.map(a => `${a.username}  (dibuat ${a.created_at.slice(0, 10)})`).join('\n') : 'Belum ada admin.');
      break;
    }
    case 'backup': {
      const date = new Date().toISOString().slice(0, 10);
      const dest = path.resolve(args[0] || path.join(config.backupDir, `akpol-${date}.sqlite`));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.rmSync(dest, { force: true });
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); // consistent copy while the server keeps running
      console.log('Database disalin ke ' + dest);
      // keep the newest 14 automatic backups
      if (!args[0]) {
        const old = fs.readdirSync(config.backupDir).filter(f => /^akpol-\d{4}-\d\d-\d\d\.sqlite$/.test(f)).sort().slice(0, -14);
        for (const f of old) fs.rmSync(path.join(config.backupDir, f));
      }
      break;
    }
    case 'reprocess': {
      const sel = args[0];
      let list;
      if (sel === '--failed') list = db.prepare("SELECT * FROM items WHERE status = 'failed'").all();
      else if (sel === '--all-videos') list = items.all().filter(i => !i.is_folder && i.file && kindOf(i.name, i.mime) === 'video');
      else if (sel === '--missing') {
        // after restoring a backup: generated media (HLS, thumbnails, previews) isn't backed up
        const gone = rel => !rel || !fs.existsSync(path.join(config.mediaDir, rel));
        list = items.all().filter(i => {
          const kind = !i.is_folder && i.file && kindOf(i.name, i.mime);
          if (!kind || i.status === 'processing') return false;
          if (kind === 'video') return gone(i.hls);
          if (kind === 'office') return gone(i.preview);
          return gone(i.thumb);
        });
        for (const i of list) items.update(i.id, { hls: null, thumb: null, preview: null });
      }
      else if (sel) list = [items.get(sel)].filter(Boolean);
      else throw new Error('Pakai: reprocess <id|--failed|--missing|--all-videos>');
      let n = 0;
      for (const it of list) {
        const kind = it.file && kindOf(it.name, it.mime);
        if (!kind) continue;
        items.update(it.id, { status: 'processing', progress: 0, error: null });
        enqueue(it.id, kind === 'video' ? 10 : 0);
        n++;
      }
      console.log(`${n} file masuk antrean proses.`);
      break;
    }
    case 'migrate-drive': {
      const { migrateFromDrive } = await import('./migrate.js');
      await migrateFromDrive(args[0]);
      break;
    }
    case 'organize-mapel': {
      const { organizeMapel } = await import('./organize.js');
      organizeMapel({ apply: args.includes('--apply') });
      break;
    }
    case 'loadtest': {
      const { loadTest } = await import('./loadtest.js');
      const opt = k => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : undefined; };
      // inside Docker the app reaches the site through the caddy container
      const url = args.find(a => /^https?:/.test(a)) || (process.env.SERVE_STATIC === '0' ? 'http://caddy/' : `http://127.0.0.1:${config.port}/`);
      await loadTest(url, { max: opt('--max') ?? 200, stepSeconds: opt('--step-seconds') ?? 15 });
      break;
    }
    case 'purge-trash':
      console.log(`${await purgeTrash(args[0] !== undefined ? Number(args[0]) : config.trashDays)} item sampah dihapus permanen.`);
      break;
    case 'status': {
      const all = items.all();
      const files = all.filter(i => !i.is_folder);
      const by = s => files.filter(i => i.status === s).length;
      const disk = await diskFree();
      console.log(`Folder: ${all.length - files.length}  File: ${files.length}  (siap ${by('ready')}, diproses ${by('processing')}, gagal ${by('failed')})`);
      console.log(`Total ukuran file asli: ${fmt(files.reduce((a, f) => a + (f.size || 0), 0))}`);
      if (disk) console.log(`Disk: sisa ${fmt(disk.free)} dari ${fmt(disk.total)}`);
      console.log(`Admin: ${admins.count()}`);
      break;
    }
    default:
      console.log(HELP);
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch(e => { console.error('Gagal: ' + e.message); process.exit(1); });
