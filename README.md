# Materiakpol1

Pusat materi taruna AKPOL: folder materi, pratinjau dokumen, dan video pembelajaran.

Web ini bisa berjalan dengan dua cara:

| | Server sendiri (baru) | Google Drive (lama) |
|---|---|---|
| Panduan | [server/PANDUAN.md](server/PANDUAN.md) | [SETUP.md](SETUP.md) |
| Penyimpanan | Harddisk komputer sendiri | Google Drive (15 GB) |
| Upload / hapus | Hanya admin (login) | Semua orang |
| Video | 1080p–360p otomatis, kualitas menyesuaikan internet | Satu file (+360p jika dikompres) |
| Alamat | `http://<IP-server>/` atau domain sendiri | GitHub Pages |

`index.html` yang sama dipakai keduanya: server sendiri menjawab `/config.js` dengan `AKPOL_SERVER = true`,
sedangkan GitHub Pages memakai [`config.js`](config.js) di repo ini (mode Google Drive).

Catatan teknis dan rencana: [HANDOFF-self-hosted-server.md](HANDOFF-self-hosted-server.md).
