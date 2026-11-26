// Media processing with FFmpeg and LibreOffice: probe, HLS adaptive ladder, thumbnails, Office → PDF.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';

const active = new Set();
// Stop running FFmpeg/LibreOffice processes (worker shutdown).
export function killAll() { for (const p of active) p.kill('SIGKILL'); }

// Run a command; resolves with stdout, rejects with the tail of stderr.
export function run(cmd, args, { onStdout, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(p);
    let out = '', err = '';
    const timer = timeoutMs ? setTimeout(() => p.kill('SIGKILL'), timeoutMs) : null;
    p.stdout.on('data', d => { const s = d.toString(); if (onStdout) onStdout(s); else out += s; });
    p.stderr.on('data', d => { err = (err + d.toString()).slice(-4000); });
    p.on('error', e => { active.delete(p); clearTimeout(timer); reject(e); });
    p.on('close', code => {
      active.delete(p);
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} keluar dengan kode ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

export async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 60000 });
  const j = JSON.parse(out);
  const v = (j.streams || []).find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (j.streams || []).find(s => s.codec_type === 'audio');
  let width = v ? v.width : 0, height = v ? v.height : 0;
  // Phone videos are often stored landscape with a rotation flag; FFmpeg auto-rotates when decoding.
  const rot = v ? Math.abs(Number((v.tags && v.tags.rotate) || (v.side_data_list || []).find(s => s.rotation !== undefined)?.rotation || 0)) : 0;
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  const [fn, fd] = String((v && (v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate)) || '30/1').split('/').map(Number);
  let fps = fd ? fn / fd : 30;
  if (!(fps > 1 && fps < 240)) fps = 30;
  return {
    hasVideo: !!v, hasAudio: !!a, width, height, fps,
    duration: Number(j.format && j.format.duration) || Number(v && v.duration) || 0,
  };
}

// ——— Encoder choice: hardware when it works, libx264 otherwise ———
let encoderPromise = null;
const testArgs = enc => [
  '-hide_banner', '-v', 'error',
  ...(enc === 'h264_vaapi' ? ['-vaapi_device', config.vaapiDevice] : []),
  ...(enc === 'h264_qsv' ? ['-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw'] : []),
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '1',
  '-vf', enc === 'h264_vaapi' ? 'format=nv12,hwupload' : enc === 'h264_qsv' ? 'format=nv12,hwupload=extra_hw_frames=64' : 'format=yuv420p',
  '-c:v', enc, '-f', 'null', '-',
];

export function pickEncoder() {
  if (encoderPromise) return encoderPromise;
  encoderPromise = (async () => {
    if (config.videoEncoder !== 'auto') return config.videoEncoder;
    const candidates = [];
    if (fs.existsSync('/dev/nvidia0')) candidates.push('h264_nvenc');
    if (fs.existsSync(config.vaapiDevice)) candidates.push('h264_vaapi', 'h264_qsv');
    for (const enc of candidates) {
      try { await run('ffmpeg', testArgs(enc), { timeoutMs: 30000 }); return enc; } catch { /* not available */ }
    }
    return 'libx264';
  })();
  return encoderPromise;
}

// YouTube-like ladder; rungs are the short side of the frame (works for portrait phone videos too).
const LADDER = [
  { h: 1080, vb: 5000 },
  { h: 720, vb: 2800 },
  { h: 480, vb: 1200 },
  { h: 360, vb: 700 },
];

export function ladderFor(info) {
  const short = Math.min(info.width, info.height);
  let rungs = LADDER.filter(r => r.h <= short * 1.05);
  if (!rungs.length) {
    const h = Math.max(2, Math.floor(short / 2) * 2);
    rungs = [{ h, vb: Math.max(250, Math.round(700 * (h / 360) ** 2)) }];
  }
  return rungs;
}

function encoderArgs(enc, i, rung) {
  const b = `${rung.vb}k`, max = `${Math.round(rung.vb * 1.07)}k`, buf = `${Math.round(rung.vb * 1.5)}k`;
  const common = [`-b:v:${i}`, b, `-maxrate:v:${i}`, max, `-bufsize:v:${i}`, buf];
  switch (enc) {
    case 'h264_nvenc': return [`-c:v:${i}`, 'h264_nvenc', `-preset:v:${i}`, 'p5', `-profile:v:${i}`, 'high', ...common];
    case 'h264_qsv': return [`-c:v:${i}`, 'h264_qsv', `-preset:v:${i}`, 'medium', `-profile:v:${i}`, 'high', ...common];
    case 'h264_vaapi': return [`-c:v:${i}`, 'h264_vaapi', `-profile:v:${i}`, 'high', ...common];
    default: return [`-c:v:${i}`, 'libx264', `-preset:v:${i}`, config.x264Preset, `-profile:v:${i}`, 'high', ...common];
  }
}

// Transcode to HLS: <outDir>/master.m3u8 plus one folder per rung (360p/, 720p/, ...).
export async function transcodeHls(input, outDir, info, { encoder, onProgress } = {}) {
  encoder = encoder || await pickEncoder();
  const rungs = ladderFor(info);
  const portrait = info.height > info.width;
  const gop = Math.max(12, Math.round(info.fps * 2));
  const hwUp = encoder === 'h264_vaapi' ? ',format=nv12,hwupload' : encoder === 'h264_qsv' ? ',format=nv12,hwupload=extra_hw_frames=64' : encoder === 'h264_nvenc' ? ',format=nv12' : ',format=yuv420p';

  const split = rungs.length > 1 ? `[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join('')};` : '';
  const chains = rungs.map((r, i) => {
    const src = rungs.length > 1 ? `[s${i}]` : '[0:v]';
    const scale = portrait ? `scale=${r.h}:-2` : `scale=-2:${r.h}`;
    return `${src}${scale}${hwUp}[v${i}]`;
  }).join(';');

  const args = [
    '-hide_banner', '-v', 'error', '-y',
    ...(encoder === 'h264_vaapi' ? ['-vaapi_device', config.vaapiDevice] : []),
    ...(encoder === 'h264_qsv' ? ['-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw'] : []),
    '-i', input,
    '-filter_complex', split + chains,
  ];
  rungs.forEach((r, i) => {
    args.push('-map', `[v${i}]`, ...encoderArgs(encoder, i, r));
    if (info.hasAudio) args.push('-map', '0:a:0');
  });
  if (info.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000');
  args.push(
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(outDir, '%v', 'seg_%05d.ts'),
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', rungs.map((r, i) => `v:${i}${info.hasAudio ? `,a:${i}` : ''},name:${r.h}p`).join(' '),
    '-progress', 'pipe:1', '-nostats',
    path.join(outDir, '%v', 'index.m3u8'),
  );

  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  let last = 0;
  await run('ffmpeg', args, {
    onStdout: s => {
      const m = s.match(/out_time_us=(\d+)/g);
      if (!m || !info.duration || !onProgress) return;
      const t = Number(m[m.length - 1].split('=')[1]) / 1e6;
      const pct = Math.max(0, Math.min(99, Math.floor(t / info.duration * 100)));
      if (pct !== last) { last = pct; onProgress(pct); }
    },
  });
  return { encoder, rungs: rungs.map(r => r.h) };
}

// Poster frame for videos, at ~10% of the duration (capped at 30 s), 640 px wide.
export async function videoThumb(input, out, info) {
  const t = info.duration ? Math.min(30, info.duration * 0.1) : 0;
  const tmp = out + '.tmp.jpg';
  const vf = info.height > info.width ? 'scale=-2:640' : 'scale=640:-2';
  try {
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', String(t), '-i', input, '-frames:v', '1', '-vf', vf, '-q:v', '4', tmp], { timeoutMs: 120000 });
  } catch {
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', vf, '-q:v', '4', tmp], { timeoutMs: 120000 });
  }
  await fsp.rename(tmp, out);
}

// Thumbnail for images: up to 800 px wide, JPEG.
export async function imageThumb(input, out) {
  const tmp = out + '.tmp.jpg';
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', input, '-frames:v', '1',
    '-vf', "scale='min(800,iw)':-2:flags=lanczos,format=yuvj420p", '-q:v', '4', tmp], { timeoutMs: 120000 });
  await fsp.rename(tmp, out);
}

// Office → PDF with LibreOffice (headless) for in-browser preview.
export async function officeToPdf(input, out) {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'akpol-lo-'));
  try {
    const ext = path.extname(input) || '.bin';
    const src = path.join(work, 'source' + ext);
    await fsp.copyFile(input, src);
    await run('soffice', [
      `-env:UserInstallation=file://${work}/profile`,
      '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', work, src,
    ], { timeoutMs: 5 * 60000 });
    await fsp.rename(path.join(work, 'source.pdf'), out).catch(async () => {
      await fsp.copyFile(path.join(work, 'source.pdf'), out);
    });
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}
