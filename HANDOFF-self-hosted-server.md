# Handoff: Move Materi AKPOL to a self-hosted server

> **Ringkasan (ID):** Pemilik web ingin berhenti bergantung pada Google Drive dan memakai **server sendiri** (komputer disiapkan pemilik). Dokumen ini menjelaskan kondisi web saat ini, rancangan server sendiri, langkah kerja, dan hal yang masih harus ditanyakan ke pemilik sebelum mulai.

Status: **installed on a campus PC on 2026-11-26 and running; the library is still almost empty.** The owner answered the key questions in §7 on 2026-11-26. Phases 1–6 of §9 are implemented in `server/` (owner guide: `server/PANDUAN.md`). Remaining: move the material over from Google Drive (the owner postponed this on 2026-11-27), set up access from outside the campus network (§5; the owner cannot open the router's settings, so Tailscale Funnel is the suggested route), and confirm hardware video encoding on the real GPU.

## Current condition (2026-11-27)

> **Ringkasan (ID):** Web live (GitHub Pages) masih memakai Google Drive. Upload lewat web lambat dan sering terputus, jadi sekarang ada jalur **upload langsung lewat Google Drive** yang otomatis tersinkron ke web. Jalur ini butuh **Apps Script versi 3**; per 27 Nov server pemilik **masih menjalankan kode lama** (respon `list` tanpa `"version"`), jadi pemilik harus deploy ulang. Server sendiri (`server/`) sudah jadi dan teruji, tinggal dipasang di komputer pemilik.

**Live site (`main` → GitHub Pages), Google Drive mode**
- Redesign (Manggala Satya theme, pages Materi / Kursus / Upload, course cards with lesson lists) is merged with the server-mode code and the YouTube-blocked notice. Both modes pass their browser tests (Drive mode against a mocked Apps Script; server mode against a real local stack).
- **Uploading through the website is slow and often cancelled (owner report, 2026-11-27).** The root cause was never pinned down (no screenshot of the route label). The workaround is the new **Drive-direct path**:
  - Site folders are mirrored as Google Drive folders inside "Materi AKPOL (jangan dihapus)".
  - The owner uploads in Google Drive (web or app), which is resumable and keeps going in the background.
  - The `syncDrive` action registers new files and subfolders. It runs in the background on every page load (throttled to once a minute) and from the **🔄 Ambil file baru dari Drive** button on the Upload page.
  - Sync skips trashed files, Google Docs/Sheets, the database sheet, and in-progress website uploads (tagged `description = akpol-web-upload`).
  - It **reuses an existing Drive subfolder with the same name** instead of creating a duplicate course.
  - Moves and deletes on the site follow in Drive.
- **Blocker (owner action):** the deployed Apps Script is still the **original v1 code**. The owner's pasted `?action=list` response had no `version` field, and every folder had an empty `drive_id`. The owner must paste the current `apps-script/Code.gs`, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**, and confirm `"version":3` in the `list` response. If they made a *new* deployment instead, the URL changed and `DRIVE_API_URL` in `index.html` must be updated.
- **Data on the live site (from the owner's `list` output):** about 40 items, mostly PPT/PDF course material. Root folders: `reserse`, `intel`, `Polair`, `ADM`, `Lantas`. No videos registered yet.
- **Network facts:** YouTube is **blocked** on AKPOL Wi-Fi; **Google Drive is reachable** there (owner, 2026-11-26).
- **Verified only against mocks:** `syncDrive` and the other v3 Apps Script logic were tested with an in-memory DriveApp/SpreadsheetApp harness (folder mirroring, sync, de-duplication, skip rules, move, delete, finishUpload tree check). They have **not** been run on real Google. The harness was a throwaway script in the session scratchpad and is not in the repo.

**Self-hosted server (`server/`)**
- **Installed by the owner on 2026-11-26** with `install.sh`: a campus desktop PC, Ubuntu Server 26.04, one 512 GB SSD, connected over Wi-Fi with a DHCP address (no fixed IP, because the owner cannot open the router's settings; `PANDUAN.md` §6 covers this case).
- `install.sh` found an Intel GPU (`/dev/dri`) and enabled the VAAPI override. Whether the worker really picked a hardware encoder is **not confirmed**; check with `docker compose logs worker | grep Encoder`.
- The server's checkout is on the branch `claude/hopeful-archimedes-0llefc`. Frontend changes go live with `git pull` alone (Caddy serves `index.html`, `assets/` and `vendor/` straight from the checkout); changes under `server/` also need `docker compose up -d --build`.
- Content on 2026-11-27: two test videos. The owner wants one folder per subject (mapel): Binmas, Manajemen Bin Polri, Reserse, Administrasi Kepolisian, IELTS, Lantas, KB, Sabhara, TIK, Polair, Intel. `organize-mapel` (dry run unless `--apply`) creates them and sorts items by name.
- Fixed during the install: `install.sh` now creates the data folders before Compose starts (Docker used to create `data/media` as root, which crashed the app with EACCES), installs `docker-buildx`, and adds the installing user to the `docker` group.
- The server's Drive migration (`migrate.js`) reads the same Apps Script `list`. v3 adds `drive_folder` and Drive ids on folder rows. The migrator ignores folder `drive_id`s (folders are created from the list; only file rows are downloaded), so it stays compatible.

**User interface (redesigned 2026-11-27)**
- **Look:** a sticker theme built around the mascot **Kentung**. The owner's sticker sheet was cut into 27 transparent stickers (`assets/kentung/`, two sizes each; see its README for which pose is used where). Thick ink outlines, maroon and gold from the Manggala Satya crest. The crest stays in the header, the home hero, the footer, the watch page and the file viewer. The footer carries the credit "Run and managed by Tim IT MS 60".
- **Where the styling lives:** `assets/theme.css` (colour and shape tokens at the top), layered over the older base styles that are still inline in `index.html`.
- **Materi (home):** a greeting that follows the time of day, one card per root folder (mapel) with its video and document counts, "Lanjutkan belajar" for half-watched videos, and "Baru ditambahkan". Search looks in every folder at once. Opening a folder uses the History API (`?f=<id>`), so the browser's Back button and shared folder links work. Phones get a bottom tab bar instead of the header links.
- **Kursus:** course cards with progress. Watching a video to the end marks the lesson done; closing the player returns to where the viewer came from.
- **Upload (admin):** the upload box names its destination folder. Rename (server mode only), move through a folder picker (also works on phones) or by drag and drop, delete through a confirm dialog instead of the browser's `confirm()`.
- **States:** loading, empty folder, no search results, load error, upload in progress and "YouTube is blocked" each show a Kentung pose with a plain sentence.
- **Tests:** `npm run test:e2e` (server mode against a temporary in-process server and worker) and `npm run test:e2e:drive` (Drive mode: the static files at a sub-path with the Apps Script stubbed, including the v1 response shape that is still deployed). Both pass on the commit that introduced the redesign.
- **Deployment:** pushed to the work branch. The self-hosted server shows it after `git pull`; GitHub Pages shows it once the branch is merged into `main`.

**Next steps**
1. Owner redeploys Apps Script v3, then uploads a test video through Drive and checks it appears under **Kursus**.
2. If website uploads are still needed for small files, get a screenshot of the progress label (`langsung ke Drive` vs `via server (lambat)`) to diagnose the cancellations.
3. On the self-hosted server: `migrate-drive --dry-run`, then the real migration, then `organize-mapel`. Set up Tailscale Funnel (`PANDUAN.md` §6) if cadets need the site from outside the campus network.

### Implementation notes (2026-11-26)

- **Layout:** `server/src/` — `app.js` (Express API + tus at `/api/upload`), `worker.js` (job queue in SQLite), `media.js` (FFmpeg/LibreOffice), `migrate.js`, `cli.js`. Docker Compose runs `caddy`, `app`, `worker`; Intel/NVIDIA overrides are selected by `install.sh` through `COMPOSE_FILE` in `.env`.
- **API** keeps the §2.2 contract at `GET/POST /api` (POST now JSON, same-origin, admin cookie). New actions: `login`, `logout`, `me`, `rename`, `uploadedItem`, `retry`. Items gain `src`, `thumb`, `hls`, `preview`, `status`, `progress`, `duration`, `width`, `height`. `version` is 3.
- **Frontend** keeps both backends: `config.js` in the repo sets `AKPOL_SERVER = false` (GitHub Pages → Drive); Caddy/the app answer `/config.js` with `true`. hls.js, tus-js-client and pdf.js are vendored in `vendor/` so a LAN without internet works.
- **Video:** HLS (MPEG-TS, 4 s segments) with rungs ≤ the source's short side, so portrait phone videos get the right ladder. Hardware encoder auto-detected (NVENC → VAAPI → QSV), libx264 fallback, and a failed hardware encode retries on libx264. The original file plays while processing.
- **Deleting** moves originals to `data/trash/` (purged after `TRASH_DAYS`); generated media is removed.
- **Tests:** `npm test` (API, auth, uploads, real FFmpeg/LibreOffice processing, migration with a fake Drive) and `test/e2e-browser.cjs` (Playwright: login, uploads, pdf.js, HLS playback and the quality menu, phone layout). Both pass; the Docker stack was also tested end to end (Caddy headers, resumed tus upload, worker restart mid-transcode, backup/restore with `reprocess --missing`).
- **Not verified:** hardware encoders (no GPU in the test environment) and the real Drive migration (the test environment could not reach `script.google.com`); run `migrate-drive --dry-run` on the owner's server first.

---

## 1. Background

Materi AKPOL is a file-sharing site for police-academy cadets (taruna). It stores course material (PDF, Word, PPT, images, audio) and educational videos, organised in folders. Anyone with the link can browse, upload, move and delete.

Storage history:
1. **Supabase.** The free tier's 5 GB/month egress cap took the site down.
2. **Google Drive via Google Apps Script** (current). It is free and has 15 GB, but:
   - Uploads are slow. The direct browser→Drive route may be refused by Google, and then uploads fall back to base64 chunks through Apps Script. This is unconfirmed; we are waiting on a screenshot from the owner (see §8).
   - The owner wants independence from proprietary Google services.
   - Video playback depends on Drive streaming URLs, which are undocumented (see §2.3).
3. **Proposed: self-hosted server** on a computer the owner will provide. This is the subject of this handoff.

> **New constraint (owner, 2026-11-26): YouTube is blocked on the AKPOL campus Wi-Fi.** YouTube link items cannot be watched on campus, so course videos must be hosted by us. This strengthens the case for a server **on the campus LAN**. It is not yet known whether Google Drive is reachable or fast on AKPOL Wi-Fi (§7, question 8). The site now shows a clear "YouTube tidak bisa diputar di jaringan ini" message instead of a broken player.

Alternatives already discussed with the owner, and why they were set aside:
- **Jellyfin:** excellent player and real adaptive transcoding, but users can't upload, every viewer needs a login, and it doesn't replace the document library. It could still be the video layer later; see §4.6.
- **Cloudflare Tunnel (free):** its terms disallow serving video, so it is not usable for the video traffic.

## 2. Current system (what exists today)

Repo: `rivaldianggarapurwadi-gif/Materiakpol1`. The site is published from `main` via **GitHub Pages** (`https://rivaldianggarapurwadi-gif.github.io/Materiakpol1/`). The working branch is `claude/hopeful-archimedes-0llefc`.

| File | What it is |
|---|---|
| `index.html` | The entire frontend (about 2,000 lines): one HTML file with inline CSS and JS and no build step. |
| `apps-script/Code.gs` | Backend: a Google Apps Script web app (API version 3: Drive-folder mirroring and `syncDrive`). |
| `SETUP.md` | Owner-facing setup guide for the Apps Script backend (Indonesian). |

### 2.1 Data model

Each row is one item, stored in the Google Sheet `Materi AKPOL - Database`:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Random id (`Date.now().toString(36)+random`). |
| `name` | string | Display name (the original filename for files). |
| `is_folder` | bool | |
| `folder_id` | string \| null | Parent folder id; `null` means root. |
| `size` | number | Bytes. |
| `mime` | string | `video/youtube` marks a YouTube link item. |
| `drive_id` | string | Google Drive file id. **Must be replaced** by a server file key. |
| `created_at` | ISO string | |
| `url` | string | YouTube watch URL, for link items only. |
| `variants` | object | e.g. `{"360": "<driveId>"}`, the low-quality video copy. |

### 2.2 API contract (Apps Script web app, `API_URL` in `index.html`)

- `GET ?action=list` returns `{ ok, version: 3, drive_folder, items: Item[] }`. `drive_folder` is the id of "Materi AKPOL (jangan dihapus)". Folder rows carry the id of their mirrored Drive folder in `drive_id`.
- `POST` with a JSON body (sent as `text/plain` to avoid a CORS preflight):

| `action` | Body | Returns |
|---|---|---|
| `createFolder` | `name, folder_id` | `{ item }` |
| `startUpload` | `name, mime, size, origin?` | `{ session }`: a Drive resumable-upload URL |
| `uploadChunk` | `session, start, total, data(base64), register?` | `{ done, item? \| drive_id? }` |
| `finishUpload` | `drive_id, name, mime, folder_id, variants` | `{ item }` |
| `addLink` | `url, name, folder_id` | `{ item }` (YouTube) |
| `move` | `id, folder_id` | `{}` |
| `delete` | `id` | `{ deleted: id[] }` (recursive; trashes Drive files and the folder's Drive folder) |
| `syncDrive` | `force?` | `{ added, partial?, skipped? }`: registers files and subfolders added directly in Drive; throttled to once a minute unless `force` |

Errors come back as `{ ok: false, error: "message" }`. **Recommendation:** the new server should keep this exact contract where it can, so the frontend change stays small.

### 2.3 Places in `index.html` that are Drive-specific (must change)

Find them by name; line numbers drift.
- **API layer:** `apiReady()` (checks for a `script.google.com` URL), `apiCall`, `apiPost`, `dbSelect`.
- **Upload pipeline:**
  - `handleFiles`, `uploadBlob`, `directPut`, `xhrPut`.
  - Uses the Drive resumable protocol (`Content-Range`, `308`).
  - `compressVideo` / `convertTo`: in-browser transcoding to 720p + 360p with mediabunny/WebCodecs, loaded via the import map in `<head>`.

  With a real server, browser-side compression should be dropped or made optional (see §4.3).
- **File URLs:**
  - `previewUrl()`: Drive preview iframe, used for PDF/Office/audio.
  - `downloadUrl()`.
  - `videoThumb()`: Drive thumbnail endpoint.
  - The image viewer uses the Drive thumbnail at `sz=w2400`.
- **Video player:**
  - `driveStream()`: `drive.usercontent.google.com/download?...&confirm=t`.
  - `fallbackDrive()`.
  - The quality logic (`hasLow`, `pickQuality`, `switchQuality`, `onStall`) is built on two fixed MP4 files (`drive_id` plus `variants['360']`).
- **Office files:** these currently rely on Drive's preview to render Word/PPT/Excel. A self-hosted server needs its own answer (see §4.5).

Parts that are **backend-agnostic and should be kept as-is:**
- folder UI, breadcrumb, drag-to-move, search, tabs;
- the video gallery and the YouTube-style watch page (`openWatch` and its controls, keyboard shortcuts, up-next, autoplay, resume via `localStorage`, `#v=<id>` deep links);
- YouTube link items (`addLink`, `loadYT`);
- HTML escaping (`esc()`), and the mobile layout.

## 3. Goals for the self-hosted version

1. **No dependency on Google** for storage or streaming.
2. **Fast uploads.** Upload the original file as-is over plain HTTP, resumable, with no base64 and no in-browser compression required.
3. **YouTube-like playback.** The server transcodes each video to an **HLS adaptive ladder** (1080/720/480/360 as the source allows). The player switches quality automatically by bandwidth and also offers a manual quality menu.
4. **Same look and features** as today: folders, upload, preview, video tab, watch page, YouTube links.
5. **Admin control.** Viewing stays open (or behind a simple shared login, per the owner's answer). Upload, move and delete require a login, because today anyone can delete anything.
6. **Runs on one owner-provided computer**, survives reboots, and is easy to back up.

Non-goals for v1: multiple servers, a CDN, per-cadet accounts, comments or likes.

## 4. Proposed design

### 4.1 Architecture

```
Browser (index.html, same UI)
   │  HTTPS
   ▼
Reverse proxy (Caddy: automatic HTTPS, static files, range requests)
   ├── /            → index.html + assets (serve the site from the server itself)
   ├── /media/...   → files on disk (originals, HLS segments, thumbnails)
   └── /api/...     → app server (Node.js or Go)
                         ├── SQLite database (items table, same fields as §2.1)
                         ├── tus/resumable upload endpoint → /data/uploads
                         └── job queue → FFmpeg workers (transcode, thumbnails)
Disk: /data/originals, /data/hls/<id>/..., /data/thumbs, /data/db.sqlite
```

- **Serve the frontend from the server too.** If the site stays on github.io, every media URL must be HTTPS with a valid certificate (a mixed-content rule), and the API needs CORS. Serving everything from one origin avoids both problems. GitHub Pages can stay as a mirror or a redirect.
- **SQLite** is enough for this scale: single file, trivial to back up.
- **Language:** Node.js (Express or Fastify) is the suggested default because the frontend is already JS. Go is the alternative if a single static binary is preferred for ease of install.

### 4.2 API

Keep the §2.2 actions and shapes, swapping the Drive-specific ones:
- `GET /api/items` replaces `list`. Each item gains `src` (download URL), `thumb`, `hls` (master playlist URL, videos only), and `status` (`ready` | `processing` | `failed`).
- **Upload** uses the **tus protocol** (resumable, chunked, retries, a good JS client: `tus-js-client`). On completion: create the item, then enqueue transcoding if it's a video.
- `createFolder`, `move`, `delete`, `addLink` behave as today. `delete` removes files from disk, or moves them to a `/data/trash` with a 30-day purge to mirror Drive's trash.
- **Auth:** `POST /api/login` sets an HttpOnly session cookie. Write endpoints require an admin session.

### 4.3 Video pipeline (the "like YouTube" part)

- After upload, run FFmpeg to produce an HLS ladder, picking rungs at or below the source resolution:
  - 1080p ≈ 5 Mbps, 720p ≈ 2.8 Mbps, 480p ≈ 1.2 Mbps, 360p ≈ 0.7 Mbps
  - AAC 128k audio, 4–6 s segments, keyframes aligned (`-g`/`-keyint_min` = 2 × fps, `-sc_threshold 0`)
  - and a `master.m3u8`.
- **Hardware encoding:**
  - Intel Quick Sync: `-c:v h264_qsv`, or VAAPI on Linux.
  - NVIDIA: `h264_nvenc`.
  - Fallback: `libx264 -preset veryfast`.
- **Extras:** generate a poster/thumbnail (`thumb.jpg`, at about 10% of the duration) and store the duration.
- The item shows `processing` until done. The gallery can show a "Memproses…" ("processing") badge. The original file stays playable meanwhile (as progressive MP4, if the browser can decode it).
- **Player:**
  - Use **hls.js** (pin an exact version; cdnjs or jsdelivr) on Chrome/Firefox/Android, and native HLS on Safari/iOS.
  - Replace `driveStream`/`switchQuality`/`onStall` with hls.js levels. "Otomatis" (auto) maps to `hls.currentLevel = -1`; manual picks set the level.
  - Keep all existing controls.
- Browser-side compression (mediabunny) becomes unnecessary, since the server transcodes. Remove it, or keep it as an option for remote uploaders on slow links.

### 4.4 Thumbnails and images

- Images: serve the original and generate a ~400 px thumbnail (sharp or FFmpeg).
- Videos: poster frame from the pipeline.

### 4.5 Documents (PDF / Office)

- **PDF:** the browser's own viewer (an iframe of the file URL), or pdf.js.
- **Word/PPT/Excel:** convert to PDF on upload with **LibreOffice headless** (`soffice --headless --convert-to pdf`) and preview the PDF. Download always serves the original.
- **Text/code:** fetch and show in the existing `<pre>` viewer.

### 4.6 Optional: Jellyfin as the video layer

If the owner prefers off-the-shelf software, keep our app for documents and uploads, and let Jellyfin watch the same `/data/originals/videos` folder. Our video tab would then link into Jellyfin. The trade-off: viewers need Jellyfin logins and the UI is no longer unified. **Default plan: no Jellyfin** (our own HLS pipeline), unless the owner asks for it.

## 5. Hosting and network

The owner's answers in §7 decide which of these applies.

| Scenario | What to do |
|---|---|
| Viewers mostly on the **same LAN** (campus or dorm Wi-Fi) as the server | Simplest and fastest. Local hostname (e.g. `materi-akpol.local` via mDNS, or a DNS entry on the router). For HTTPS on the LAN, use Caddy's internal CA (install its root on devices) or a real domain with a DNS-01 Let's Encrypt cert. |
| Viewers **on the internet** | Needs a public IP or a tunnel. **Check for CGNAT first** (common on IndiHome and other Indonesian ISPs): compare the router's WAN IP with `curl ifconfig.me`. Options: ask the ISP for a public IP (sometimes paid) and port-forward 443; **Tailscale Funnel** (free, public HTTPS without a public IP, but bandwidth is limited, so fine for light use, not mass streaming); a cheap VPS as a WireGuard relay (costs money, which the owner wants to avoid). Do **not** use Cloudflare Tunnel's free plan for video (against its terms). |
| **Both** | Run on the LAN, plus a public route for off-site viewers. Optionally keep YouTube (unlisted) links for important videos as an off-site fallback, which the site already supports. |

**Capacity rule of thumb for internet viewers:** concurrent 720p viewers ≈ server upload Mbps ÷ 3. Adaptive HLS degrades gracefully (viewers drop to 480/360 instead of stalling), but it cannot exceed the uplink.

## 6. Server hardware and operations

- **Recommended hardware:**
  - CPU: Intel Core i3/i5, **7th gen or newer** (Quick Sync), or any CPU plus an NVIDIA GPU.
  - 8 GB RAM.
  - SSD for the OS and app; HDD 1–2 TB+ for media.
  - **Wired Ethernet.**
  - **UPS** (power cuts).
- **OS:** Ubuntu Server LTS is recommended. Windows also works; provide an installer script for both, or Docker Compose.
- **Install method:** `docker compose up -d` with services `caddy`, `app` and `worker`, all `restart: unless-stopped`. Provide a one-page Indonesian guide like `SETUP.md`.
- **Backups:**
  - Nightly SQLite backup (`.backup`) plus `rsync` of `/data/originals` to an external disk.
  - HLS output can be regenerated, so it needs no backup.
  - Document how to restore.
- **Updates:** unattended security updates on the OS; pin image versions.
- **Monitoring (minimal):** a health endpoint, a disk-space warning in the admin UI, and a transcode-failure list.

## 7. Open questions for the owner (answer before building)

**Answered 2026-11-26** (the remaining items are still open and do not block the build):

| # | Question | Answer |
|---|---|---|
| 1 | Where do cadets watch? | **Both**: campus/dorm Wi-Fi and home/mobile data. Run on the LAN plus a public route (§5 "Both"). |
| 3 | OS | **Ubuntu Server LTS**, installed with Docker Compose. Exact CPU/RAM/disk still unknown. |
| 4 | Who may upload and delete? | **Admins only.** Viewing stays open without a login. |
| 6 | Migration | **Move everything** from Google Drive (keep ids, folders and names). |
| 7 | Keep Drive as a mirror? | No. Drive is retired after migration (answer to 6 chose "move everything" over "keep as mirror"). |
| 2, 5 | ISP / public IP / CGNAT, domain | Still open. The build supports both a LAN-only address and a public domain; the owner picks in `.env`. |

Original questions:

1. **Where do cadets watch?** Campus Wi-Fi, home/mobile data, or both? (This is the main deciding factor.)
2. **Where will the server live?** On the campus network or at home? Which ISP? What upload speed (speedtest.net)? Is there a public IP or CGNAT?
3. **Computer specs:** CPU model, RAM, disks, OS preference (Ubuntu / Windows).
4. **Who may upload and delete?** Everyone (as today) or admins/instructors only? Should viewing need a login?
5. **Domain:** is there one (or can one be bought), or is a LAN-only name fine?
6. **Migration:** move everything currently in Google Drive (and the old Supabase data, if still reachable), or start fresh?
7. **Keep Google Drive as a fallback/mirror** for off-site viewing, or cut it off completely?
8. ~~**On AKPOL Wi-Fi, do Google Drive videos play smoothly?**~~ **Answered 2026-11-26: Google Drive is not blocked on campus.** (YouTube is blocked there; Drive may be blocked or throttled too.) Also: will **AKPOL IT** allow a server on the campus network, or whitelist the domain we use?

## 8. Known issues and unverified items in the current system

- **Upload through the website is slow and gets cancelled (owner report, 2026-11-27).** The progress text labels the route (`langsung ke Drive` = direct to Drive, vs `via server (lambat)` = via server, slow), but the owner never sent a screenshot, so the cause is still unknown. **Workaround shipped:** upload directly in Google Drive plus `syncDrive` (see "Current condition"). This becomes moot once the self-hosted server is installed.
- **Apps Script deployment is outdated** (as of 2026-11-27 the live `list` has no `version` field). The Drive-direct path, direct uploads and 360p variants all need the v3 deployment.
- **Not verified against real Google** (only against mocks in Playwright):
  - the direct PUT to the Drive session URL (CORS with the `Origin` header set by Apps Script);
  - streaming from `drive.usercontent.google.com` into `<video>` with range requests;
  - the `finishUpload` folder check.
- **The API is open:** anyone with the URL can upload, move or delete. This is a deliberate carry-over from the Supabase era; the self-hosted version should add admin auth (§3.5).
- Videos uploaded before the compression update were not compressed. The self-hosted migration will transcode everything anyway.

## 9. Suggested implementation plan

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Owner answers §7; hardware confirmed | Answers recorded in this file (done, except hardware and network details) |
| — | **Status 2026-11-26:** phases 1–6 below are implemented and tested; installation on the owner's hardware is next | |
| 1 | `server/` folder: Docker Compose (Caddy + app + worker), SQLite schema, `/api/items`, folders, move, delete, login | `docker compose up` on a clean Ubuntu VM serves the current UI against the new API with an empty library |
| 2 | tus uploads plus static file serving with range requests; image thumbs; PDF/Office preview via LibreOffice | Upload a 2 GB file over LAN; it resumes after the network is unplugged mid-upload; PDF/DOCX preview works |
| 3 | FFmpeg HLS pipeline (hardware encode with libx264 fallback), poster frames, processing status | A 1080p phone video becomes a 4-rung HLS ladder; the gallery shows a poster |
| 4 | Frontend: swap the Drive-specific functions (§2.3) for server URLs and hls.js; keep the watch page UI | Auto quality switches under Chrome DevTools throttling (Fast 3G → 360p, no stall loop); Safari plays via native HLS |
| 5 | Migration tool: copy items, folders and files from Google Drive (via the Apps Script `list` and file downloads), then queue transcodes | Every existing item appears with the same folders and names |
| 6 | Owner guide (Indonesian): install, backup/restore, adding an admin, network setup for the chosen scenario | Owner installs it on their machine following only the guide |

**Test approach:** Playwright against the local stack (the repo already uses Playwright-style manual checks in development); FFmpeg-generated test clips (`testsrc2` + `sine`), as used during Drive-era testing.

## 10. Key decisions so far (with reasons)

- **Drive over Supabase:** the free tier with no egress cap was the deciding factor. (Done.)
- **YouTube links are first-class video items:** best option for very large videos and off-site viewing. (Done.)
- **YouTube is not an option for course videos**, because it is blocked on AKPOL Wi-Fi. YouTube links stay supported for off-campus viewing only.
- **Self-hosting is approved and built** for independence from Google and faster LAN uploads. Remaining: install on the owner's hardware and settle the network route (§5).
- **Google Drive web/app is the recommended upload path while on Drive** (2026-11-27): Drive's own uploader is resumable and reliable, unlike uploads from the website through Apps Script.
- **Prefer our own app plus an HLS pipeline over Jellyfin:** this keeps upload, documents and video in one UI, and keeps viewing open without per-viewer accounts. Revisit if the owner prefers Jellyfin.
