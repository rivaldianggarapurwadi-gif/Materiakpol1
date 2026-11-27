// Sort the library into one top-level folder per subject (mapel), matching item names against keywords,
// then give every mapel the subfolders Video / PPT / Tentir and sort its loose files into them.
// Default is a dry run that only prints the plan; pass apply: true to move things.
//   node src/cli.js organize-mapel           (lihat rencana)
//   node src/cli.js organize-mapel --apply   (jalankan)
import { items, uid } from './db.js';

// Folder names, in display order, with the words that identify each subject.
// Add words here if files are left unsorted (lowercase; whole words only).
export const MAPEL = [
  { name: 'Binmas', words: ['binmas', 'bimbingan masyarakat', 'polmas', 'pemolisian masyarakat', 'perpolisian masyarakat', 'pokdar'] },
  { name: 'Manajemen Bin Polri', words: ['manajemen bin polri', 'manajemen bin', 'manajemen pembinaan', 'bin polri', 'mbp', 'manbin'] },
  { name: 'Reserse', words: ['reserse', 'reskrim', 'serse', 'penyidikan', 'penyelidikan', 'krimum', 'krimsus', 'narkoba', 'forensik', 'lp model', 'tkp'] },
  { name: 'Administrasi Kepolisian', words: ['administrasi kepolisian', 'adm kepolisian', 'adm pol', 'admpol', 'adminpol', 'administrasi polri', 'adm', 'administrasi'] },
  { name: 'IELTS', words: ['ielts', 'english', 'bahasa inggris', 'toefl', 'listening', 'speaking'] },
  { name: 'Lantas', words: ['lantas', 'lalu lintas', 'lalin', 'laka', 'kecelakaan lalu lintas', 'sim'] },
  { name: 'KB', words: ['kb'] },
  { name: 'Sabhara', words: ['sabhara', 'samapta', 'dalmas', 'turjawali'] },
  { name: 'TIK', words: ['tik', 'teknologi informasi', 'komputer', 'informatika'] },
  { name: 'Polair', words: ['polair', 'polairud', 'polisi air', 'perairan', 'kepolisian perairan'] },
  { name: 'Intel', words: ['intel', 'intelijen', 'intelkam', 'baintelkam'] },
];

// Subfolders inside every mapel folder, in display order.
export const SUBFOLDERS = ['Video', 'PPT', 'Tentir'];
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|ogv|wmv|flv|mpg|mpeg|ts|mts)$/i;
const SLIDE_EXT = /\.(ppt|pptx|pps|ppsx|pptm|odp|key)$/i;
const TENTIR_WORDS = ['tentir', 'rangkuman', 'ringkasan', 'resume', 'kisi kisi', 'soal', 'latihan soal', 'bank soal', 'catatan'];

// Which subfolder a file belongs in: 'Video' | 'PPT' | 'Tentir' | null (stays in the mapel folder)
export function subfolderFor(item) {
  if (item.is_folder) return null;
  if (String(item.mime).startsWith('video/') || VIDEO_EXT.test(item.name)) return 'Video'; // also YouTube links
  const n = norm(item.name);
  if (TENTIR_WORDS.some(w => n.includes(' ' + w + ' '))) return 'Tentir';
  if (SLIDE_EXT.test(item.name)) return 'PPT';
  return null;
}

// "Modul_Lalu-Lintas (2025).pdf" → " modul lalu lintas 2025 pdf "
const norm = s => ' ' + String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

// The subject an item name belongs to, or null (no match) / 'ambiguous' (names more than one subject).
export function matchMapel(name) {
  const n = norm(name);
  const hits = MAPEL.filter(m => m.words.some(w => n.includes(' ' + w + ' ')));
  if (!hits.length) return null;
  return hits.length > 1 ? 'ambiguous' : hits[0].name;
}

export function organizeMapel({ apply = false, log = console.log } = {}) {
  const all = items.all();
  const byParent = new Map();
  for (const it of all) {
    const k = it.folder_id || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(it);
  }
  const children = id => byParent.get(id) || [];
  const byId = new Map(all.map(i => [i.id, i]));
  const pathOf = it => {
    const parts = [];
    for (let p = it.folder_id && byId.get(it.folder_id); p; p = p.folder_id && byId.get(p.folder_id)) parts.unshift(p.name);
    return parts.length ? parts.join(' › ') : 'Semua Materi';
  };

  // 1) One root folder per subject. Reuse a root folder with the same name, or one named with one of the
  //    subject's words (e.g. "ADM", "intel"), renamed to the subject name; otherwise create it.
  const target = {};
  const created = [];
  const renamed = [];
  const used = new Set();
  const isAlias = (name, m) => { const n = norm(name).trim(); return n === norm(m.name).trim() || m.words.includes(n); };
  for (const m of MAPEL) {
    const roots = children(null).filter(i => i.is_folder && !used.has(i.id));
    const existing = roots.find(i => norm(i.name) === norm(m.name)) || roots.find(i => isAlias(i.name, m));
    if (existing) {
      target[m.name] = existing.id;
      used.add(existing.id);
      if (existing.name !== m.name) {
        renamed.push({ from: existing.name, to: m.name });
        if (apply) items.update(existing.id, { name: m.name });
      }
    } else {
      created.push(m.name);
      target[m.name] = apply ? items.insert({ id: uid(), name: m.name, is_folder: true, folder_id: null }).id : `(baru) ${m.name}`;
    }
  }
  const mapelFolderIds = new Set(Object.values(target));

  // 2) Walk everything outside the subject folders. A matching folder moves as a whole (its structure is kept);
  //    a non-matching folder is searched inside for matching items.
  const moves = [], ambiguous = [], unmatched = [];
  const walk = parentId => {
    for (const it of children(parentId)) {
      if (mapelFolderIds.has(it.id)) continue;
      const m = matchMapel(it.name);
      if (m && m !== 'ambiguous') {
        if ((it.folder_id || null) !== target[m]) moves.push({ it, mapel: m, from: pathOf(it) });
        continue;
      }
      if (m === 'ambiguous') ambiguous.push(it);
      if (it.is_folder) walk(it.id);
      else if (m !== 'ambiguous') unmatched.push(it);
    }
  };
  walk(null);

  // 3) Subfolders Video / PPT / Tentir in every mapel folder; loose files in a mapel folder are sorted into them.
  //    Files already in any folder below the mapel (e.g. "Pertemuan 1") are left where they are.
  const willSit = new Map(); // file id → mapel name it will sit directly in
  for (const m of MAPEL) for (const it of children(target[m.name])) if (!it.is_folder) willSit.set(it.id, { it, mapel: m.name });
  for (const x of moves) if (!x.it.is_folder) willSit.set(x.it.id, { it: x.it, mapel: x.mapel });
  const subMoves = [], stays = [];
  for (const { it, mapel } of willSit.values()) {
    const sub = subfolderFor(it);
    if (sub) subMoves.push({ it, mapel, sub }); else stays.push({ it, mapel });
  }
  const subCreated = [];
  const subTarget = {}; // `${mapel}/${sub}` → folder id
  for (const m of MAPEL) {
    for (const sub of SUBFOLDERS) {
      const existing = children(target[m.name]).find(i => i.is_folder && norm(i.name) === norm(sub));
      if (existing) { subTarget[m.name + '/' + sub] = existing.id; continue; }
      subCreated.push(`${m.name}/${sub}`);
      if (apply) subTarget[m.name + '/' + sub] = items.insert({ id: uid(), name: sub, is_folder: true, folder_id: target[m.name] }).id;
    }
  }

  // 4) Report (and apply)
  if (renamed.length) log(`Folder ${apply ? 'diganti nama' : 'akan diganti nama'}: ${renamed.map(x => `"${x.from}" → "${x.to}"`).join(', ')}`);
  if (created.length) log(`Folder mapel ${apply ? 'dibuat' : 'akan dibuat'}: ${created.join(', ')}`);
  if (subCreated.length) log(`Subfolder ${SUBFOLDERS.join(' / ')} ${apply ? 'dibuat' : 'akan dibuat'}: ${subCreated.length} folder di ${new Set(subCreated.map(x => x.split('/')[0])).size} mapel`);
  for (const m of MAPEL) {
    const mine = moves.filter(x => x.mapel === m.name);
    if (!mine.length) continue;
    log(`\n📁 ${m.name} ← ${mine.length} item`);
    for (const x of mine) log(`   ${x.it.is_folder ? '📁' : '•'} ${x.it.name}   (dari: ${x.from})`);
  }
  if (apply) for (const x of moves) items.move(x.it.id, target[x.mapel]);
  if (subMoves.length) {
    log(`\n🗂️  Ke subfolder (${subMoves.length}):`);
    for (const x of subMoves) log(`   • ${x.it.name}   → ${x.mapel} › ${x.sub}`);
  }
  if (apply) for (const x of subMoves) items.move(x.it.id, subTarget[x.mapel + '/' + x.sub]);
  if (stays.length) {
    log(`\n📄 Tetap di folder mapel, bukan video/PPT/tentir — pindahkan sendiri bila perlu (${stays.length}):`);
    for (const x of stays.slice(0, 200)) log(`   • ${x.it.name}   (${x.mapel})`);
  }
  if (ambiguous.length) {
    log(`\n❓ Cocok ke lebih dari satu mapel — tidak dipindah (${ambiguous.length}):`);
    for (const it of ambiguous) log(`   ${it.is_folder ? '📁' : '•'} ${it.name}   (di: ${pathOf(it)})`);
  }
  if (unmatched.length) {
    log(`\n⚪ Tidak dikenali — tetap di tempatnya (${unmatched.length}):`);
    for (const it of unmatched.slice(0, 200)) log(`   • ${it.name}   (di: ${pathOf(it)})`);
    if (unmatched.length > 200) log(`   … dan ${unmatched.length - 200} lainnya`);
  }
  const movedCount = new Set([...moves, ...subMoves].map(x => x.it.id)).size; // a file can move twice (into the mapel, then its subfolder)
  log(`\n${apply ? 'Selesai' : 'Rencana'}: ${movedCount} item ${apply ? 'dipindahkan' : 'akan dipindahkan'}, ${created.length} folder mapel dan ${subCreated.length} subfolder ${apply ? 'dibuat' : 'baru'}, ${ambiguous.length + unmatched.length} dibiarkan.`);
  if (!apply) log('Belum ada yang diubah. Jalankan dengan --apply untuk memindahkan.');
  return { moves: moves.length, subMoves: subMoves.length, created, renamed, subCreated, ambiguous: ambiguous.map(i => i.name), unmatched: unmatched.map(i => i.name), stays: stays.map(x => x.it.name) };
}
