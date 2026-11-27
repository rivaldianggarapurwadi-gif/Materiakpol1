// Load test: how many people can use the site at once?
// Read-only: opens the page, the material list and video segments like real viewers. Changes nothing.
//   docker compose exec app node src/cli.js loadtest            (from the server itself, through Caddy)
//   node src/loadtest.js http://10.4.128.65                      (from a laptop with Node, tests the Wi-Fi too)
// Options: --max <users> (default 200), --step-seconds <s> (default 15)

const STEPS = [5, 10, 25, 50, 100, 150, 200, 300, 500];
const VIDEO_720P_MBPS = 2.8;   // HLS ladder bitrate (media.js); 360p is 0.7
const LIMIT_P95_MS = 2000;     // slower than this per request and video starts to stutter

const fmt = n => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

async function discover(base) {
  const r = await fetch(new URL('api?action=list', base));
  if (!r.ok) throw new Error(`Server tidak menjawab ${base} (HTTP ${r.status})`);
  const { items } = await r.json();
  const videos = items.filter(i => i.hls);
  const segments = [];
  for (const v of videos.slice(0, 5)) {
    // pick the 720p (or highest available ≤720p) variant and list its segments
    const master = await (await fetch(new URL(v.hls, base))).text();
    const variants = master.split('\n').filter(l => l.endsWith('index.m3u8'));
    const pick = variants.find(l => l.startsWith('720p')) || variants[variants.length - 1];
    if (!pick) continue;
    const vurl = new URL(pick, new URL(v.hls, base));
    const list = await (await fetch(vurl)).text();
    for (const l of list.split('\n')) if (l.endsWith('.ts')) segments.push(new URL(l, vurl).href);
  }
  const docs = items.filter(i => !i.is_folder && i.src && !i.hls).map(i => new URL(i.src, base).href);
  return { items: items.length, videos: videos.length, segments, docs };
}

async function timed(url, stats) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const buf = await r.arrayBuffer();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    stats.lat.push(performance.now() - t0);
    stats.bytes += buf.byteLength;
    stats.ok++;
  } catch { stats.err++; }
}

// One simulated person: opens the page and list now and then, otherwise streams video segments back to back.
async function user(base, target, stats, until) {
  let n = Math.floor(Math.random() * 1000);
  while (performance.now() < until) {
    const r = n++ % 12;
    if (r === 0) await timed(new URL('./', base).href, stats);
    else if (r === 1) await timed(new URL('api?action=list', base).href, stats);
    else if (r === 2 && target.docs.length) await timed(target.docs[n % target.docs.length], stats);
    else if (target.segments.length) await timed(target.segments[n % target.segments.length], stats);
    else await timed(new URL('api?action=list', base).href, stats);
  }
}

export async function loadTest(baseArg, { max = 200, stepSeconds = 15, log = console.log } = {}) {
  const base = new URL(baseArg.endsWith('/') ? baseArg : baseArg + '/');
  log(`Uji beban ${base.href}  (hanya membaca, tidak mengubah apa pun)`);
  const target = await discover(base);
  log(`Materi: ${target.items} item, ${target.videos} video siap HLS, ${target.segments.length} potongan video 720p untuk diuji.`);
  if (!target.segments.length) log('⚠️  Belum ada video yang selesai diproses — uji hanya memakai halaman dan daftar materi.');
  log(`\nPengguna  Permintaan/dtk   Data MB/dtk   Respons p50 / p95    Gagal`);

  const results = [];
  for (const users of STEPS.filter(s => s <= max)) {
    const stats = { lat: [], bytes: 0, ok: 0, err: 0 };
    const t0 = performance.now(), until = t0 + stepSeconds * 1000;
    await Promise.all(Array.from({ length: users }, () => user(base, target, stats, until)));
    const secs = (performance.now() - t0) / 1000;
    const row = { users, rps: stats.ok / secs, mbps: stats.bytes / secs / 1e6, p50: pct(stats.lat, 0.5), p95: pct(stats.lat, 0.95), errRate: stats.err / Math.max(1, stats.ok + stats.err) };
    results.push(row);
    log(`${String(users).padStart(8)}  ${fmt(row.rps).padStart(14)}  ${fmt(row.mbps).padStart(12)}   ${(fmt(row.p50) + ' / ' + fmt(row.p95) + ' ms').padStart(18)}  ${(fmt(row.errRate * 100) + '%').padStart(7)}`);
    if (row.errRate > 0.05 || row.p95 > LIMIT_P95_MS * 2) { log('(berhenti: server sudah kewalahan)'); break; }
  }

  const good = results.filter(r => r.errRate <= 0.01 && r.p95 <= LIMIT_P95_MS);
  const peak = results.reduce((a, r) => (r.mbps > a.mbps ? r : a), results[0]);
  const viewers720 = Math.floor(peak.mbps * 8 / VIDEO_720P_MBPS);
  log('\nRingkasan:');
  log(`• Kecepatan kirim tertinggi: ${fmt(peak.mbps)} MB/dtk (${fmt(peak.mbps * 8)} Mbps) pada ${peak.users} pengguna.`);
  log(`• Kira-kira ${viewers720} orang bisa menonton video 720p bersamaan, atau sekitar ${viewers720 * 4} orang di 360p.`);
  log(good.length
    ? `• Tetap lancar (gagal ≤1%, respons p95 ≤ ${LIMIT_P95_MS / 1000} dtk) sampai ${good[good.length - 1].users} pengguna aktif bersamaan.`
    : '• Bahkan pada beban terkecil respons sudah lambat — periksa jaringan atau server.');
  log('• Catatan: jika diuji dari server sendiri, hasil ini batas server; dari laptop lewat Wi-Fi, batasnya biasanya Wi-Fi.');
  return { target, results, viewers720 };
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : undefined; };
  const url = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1/';
  loadTest(url, { max: opt('--max') ?? 200, stepSeconds: opt('--step-seconds') ?? 15 })
    .catch(e => { console.error('Gagal: ' + e.message); process.exit(1); });
}
