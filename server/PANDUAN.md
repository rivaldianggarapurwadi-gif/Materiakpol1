# Panduan Server Sendiri — Materi AKPOL

Panduan ini untuk memasang web Materi AKPOL di **komputer sendiri**, tanpa Google Drive.
Setelah terpasang:

- Taruna membuka web dari HP/laptop seperti biasa, **tanpa login**.
- Hanya **admin** yang bisa upload, membuat folder, memindahkan, dan menghapus.
- Upload jauh lebih cepat (file dikirim apa adanya) dan **bisa dilanjutkan** jika Wi‑Fi putus.
- Video otomatis dibuat versi **1080p / 720p / 480p / 360p**. Pemutar memilih kualitas sendiri sesuai kecepatan internet (seperti YouTube), dan penonton juga bisa memilih manual (⚙️ → Kualitas).
- Word, PowerPoint, Excel, dan PDF bisa dibaca langsung di web, termasuk di HP.

---

## 1. Yang dibutuhkan

| Komponen | Saran |
|---|---|
| Prosesor | Intel Core i3/i5 **generasi 7 ke atas** (punya Quick Sync untuk memproses video dengan cepat), atau prosesor apa pun + kartu grafis NVIDIA |
| RAM | 8 GB |
| Penyimpanan | SSD untuk sistem + harddisk **1–2 TB** untuk materi |
| Jaringan | **Kabel LAN** ke router (jangan Wi‑Fi) |
| Listrik | **UPS**, supaya tidak mati mendadak saat listrik padam |
| Sistem operasi | **Ubuntu Server 24.04 LTS** (gratis) |
| Cadangan | Harddisk eksternal (disarankan) |

Tanpa GPU tetap bisa jalan, hanya proses video lebih lama (video 10 menit ±10–20 menit diproses). Selama diproses, video sudah bisa ditonton dalam kualitas aslinya.

## 2. Pasang Ubuntu Server

1. Unduh **Ubuntu Server 24.04 LTS** dari ubuntu.com, tulis ke flashdisk (pakai balenaEtcher/Rufus), lalu instal di komputer server.
2. Saat instalasi, centang **Install OpenSSH server** agar bisa diatur dari laptop lain.
3. Jika materi akan disimpan di harddisk kedua, pasang (mount) harddisk itu, mis. ke `/mnt/materi`. Minta bantuan teknisi jika belum terbiasa.
4. Di **router**, buat *DHCP reservation* / IP tetap untuk server ini (mis. `192.168.1.10`), supaya alamatnya tidak berubah-ubah.

## 3. Pasang aplikasi

Masuk ke server (langsung atau lewat `ssh`), lalu jalankan:

```bash
git clone https://github.com/rivaldianggarapurwadi-gif/Materiakpol1.git
```

```bash
cd Materiakpol1/server
```

```bash
sudo ./install.sh
```

Pemasang akan bertanya:

- **Folder penyimpanan materi** — isi folder di harddisk besar, mis. `/mnt/materi/data`.
- **Domain** — kosongkan dulu jika belum punya (lihat bagian 5).
- **Nama dan kata sandi admin** — kata sandi minimal 8 karakter. Simpan baik-baik.

Pemasang juga otomatis: memasang Docker, mendeteksi GPU, menjalankan server, dan menjadwalkan cadangan setiap malam.
Server **otomatis menyala lagi** setelah komputer restart atau listrik padam.

Setelah selesai, buka **`http://<IP-server>/`** dari HP yang tersambung ke Wi‑Fi yang sama (mis. `http://192.168.1.10/`).
Klik ikon 🔒 **Masuk admin** di kanan atas untuk mulai upload.

## 4. Pindahkan materi dari Google Drive

Semua folder, file, dan link YouTube dipindah dengan nama, folder, dan tanggal yang sama. Link video yang pernah dibagikan (`#v=...`) tetap berfungsi.

1. Cek dulu berapa banyak yang akan dipindah (tidak mengubah apa pun):

   ```bash
   docker compose exec app node src/cli.js migrate-drive --dry-run
   ```

2. Mulai pindahkan:

   ```bash
   docker compose exec app node src/cli.js migrate-drive
   ```

   Jika berhenti di tengah jalan (internet putus, dll.), **jalankan perintah yang sama lagi** — file yang sudah pindah dilewati.
   Jika ada file gagal karena "kuota download habis", tunggu 24 jam lalu jalankan lagi.

3. Setelah semua file pindah, video diproses di latar belakang. Lihat kemajuannya:

   ```bash
   docker compose logs -f worker
   ```

   (tekan `Ctrl+C` untuk keluar dari tampilan log; server tetap jalan)

4. Setelah semua beres dan taruna sudah memakai alamat baru, Google Drive tidak dipakai lagi. File di Drive boleh dibiarkan sebagai arsip.

## 5. Agar bisa dibuka dari luar kampus

Di jaringan kampus/asrama, web langsung bisa dibuka lewat `http://<IP-server>/`. Agar taruna juga bisa membuka dari rumah / data seluler, pilih salah satu:

### Pilihan A — IP publik + domain (terbaik untuk banyak penonton)

1. **Cek apakah internet server punya IP publik.** Buka halaman status router dan catat "WAN IP". Lalu di server jalankan:

   ```bash
   curl -4 ifconfig.me
   ```

   Jika kedua angka **sama**, berarti punya IP publik. Jika **berbeda** (sering terjadi di IndiHome dan ISP lain — disebut *CGNAT*), minta IP publik ke ISP (kadang berbayar) atau pakai Pilihan B.
2. Beli domain (mis. di registrar lokal, ±Rp150 ribu/tahun) dan arahkan *A record* ke IP publik tersebut.
3. Di router, buat **port forwarding** port **80** dan **443** ke IP server.
4. Di server, edit file `.env`:

   ```bash
   nano .env
   ```

   ubah baris `SITE_ADDRESS` menjadi (ganti dengan domainmu):

   ```
   SITE_ADDRESS=materi.domainmu.id, :80
   ```

   lalu jalankan ulang:

   ```bash
   docker compose up -d
   ```

   Sertifikat HTTPS dibuat otomatis. Web bisa dibuka di `https://materi.domainmu.id/` dari mana saja, dan tetap bisa lewat `http://<IP-server>/` di jaringan lokal.

**Perkiraan kapasitas:** jumlah penonton 720p bersamaan dari luar ≈ kecepatan **upload** internet server (Mbps) ÷ 3. Contoh: upload 30 Mbps ≈ 10 penonton 720p sekaligus. Jika lebih banyak, pemutar otomatis turun ke 480p/360p agar tidak tersendat.

### Pilihan B — Tailscale Funnel (gratis, tanpa IP publik)

Cocok untuk pemakaian ringan. Kecepatannya terbatas, jadi tidak cocok untuk banyak orang menonton video sekaligus.

1. Daftar di tailscale.com, lalu di server:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```

   ```bash
   sudo tailscale up
   ```

   ```bash
   sudo tailscale funnel --bg 80
   ```

2. Alamat publik `https://<nama-server>.<nama-tailnet>.ts.net/` akan ditampilkan.

> Jangan memakai **Cloudflare Tunnel versi gratis** untuk web ini: aturannya melarang dipakai untuk streaming video.

### Pilihan C — Link YouTube untuk video penting

Untuk video yang sangat sering ditonton dari luar, upload ke YouTube (*unlisted*/tidak publik) lalu tambahkan lewat tombol **Video → Dari YouTube**. Tidak memakai internet server sama sekali.

## 6. Mengelola admin

Semua perintah dijalankan dari folder `Materiakpol1/server`.

| Tugas | Perintah |
|---|---|
| Tambah admin (mis. untuk pengajar) | `docker compose exec app node src/cli.js add-admin budi` |
| Ganti kata sandi admin | perintah yang sama dengan nama admin yang sudah ada |
| Hapus admin | `docker compose exec app node src/cli.js remove-admin budi` |
| Daftar admin | `docker compose exec app node src/cli.js list-admins` |

Mengganti kata sandi otomatis mengeluarkan admin itu dari semua perangkat.

## 7. Cadangan dan pemulihan

**Otomatis setiap malam pukul 02:30**: database disalin ke `<folder data>/backups/` (14 hari terakhir disimpan).

**Sangat disarankan: salin juga ke harddisk eksternal.**

1. Colok dan pasang harddisk eksternal, mis. di `/mnt/cadangan` (pastikan otomatis terpasang saat boot lewat `/etc/fstab`).
2. Tambahkan ke `.env`:

   ```
   BACKUP_DEST=/mnt/cadangan
   ```

Mulai malam itu, database **dan semua file asli** ikut disalin ke `/mnt/cadangan/materi-akpol/`. File yang dihapus di web tidak ikut terhapus dari cadangan.
Cadangan manual kapan saja:

```bash
sudo ./scripts/backup.sh
```

**File terhapus tidak sengaja?** File yang dihapus di web masuk ke `<folder data>/trash/` selama 30 hari. Hubungi teknisi untuk mengembalikannya.

**Memulihkan ke komputer baru:**

1. Pasang Ubuntu dan aplikasi seperti bagian 2–3 (folder data boleh kosong).
2. Hentikan server:

   ```bash
   docker compose down
   ```

3. Salin file asli dan database dari cadangan (ganti `/mnt/materi/data` dengan folder data, dan `TANGGAL` dengan cadangan terbaru):

   ```bash
   sudo rsync -a /mnt/cadangan/materi-akpol/files/ /mnt/materi/data/media/files/
   ```

   ```bash
   sudo cp /mnt/cadangan/materi-akpol/backups/akpol-TANGGAL.sqlite /mnt/materi/data/db/akpol.sqlite
   ```

   ```bash
   sudo rm -f /mnt/materi/data/db/akpol.sqlite-wal /mnt/materi/data/db/akpol.sqlite-shm
   ```

   ```bash
   sudo chown -R 1000:1000 /mnt/materi/data
   ```

4. Nyalakan lagi dan buat ulang versi video/thumbnail/pratinjau:

   ```bash
   docker compose up -d
   ```

   ```bash
   docker compose exec app node src/cli.js reprocess --missing
   ```

## 8. Perawatan rutin

| Tugas | Perintah |
|---|---|
| Ringkasan (jumlah materi, sisa disk) | `docker compose exec app node src/cli.js status` |
| Memperbarui aplikasi | `git pull` lalu `docker compose up -d --build` |
| Melihat log | `docker compose logs -f` |
| Restart server | `docker compose restart` |
| Proses ulang file yang gagal | `docker compose exec app node src/cli.js reprocess --failed` |
| Setelah memasang GPU baru | `sudo ./install.sh` lalu `docker compose exec app node src/cli.js reprocess --all-videos` |

Di web, admin akan melihat peringatan jika **disk hampir penuh** (sisa < 10 GB) atau ada **file gagal diproses** (tanda ⚠️; klik ikon ↻ untuk mencoba lagi).

Ubuntu memasang pembaruan keamanan otomatis. Sesekali (mis. sebulan sekali) jalankan `sudo apt update && sudo apt upgrade` lalu restart komputer.

## 9. Masalah umum

| Gejala | Penyebab / solusi |
|---|---|
| Web tidak bisa dibuka dari HP | Pastikan HP di Wi‑Fi yang sama, alamat diketik `http://` (bukan `https://`) untuk IP lokal, dan server menyala: `docker compose ps` |
| Video "sedang diproses" lama sekali | Normal tanpa GPU untuk video panjang. Lihat kemajuan: `docker compose logs -f worker` |
| Upload terhenti "Koneksi terputus" | Akan dilanjutkan otomatis saat koneksi kembali. Jika halaman tertutup, pilih file yang sama lagi di folder yang sama — upload melanjutkan dari posisi terakhir |
| Lupa kata sandi admin | `docker compose exec app node src/cli.js add-admin <nama>` untuk membuat kata sandi baru |
| "Terlalu banyak percobaan" saat login | Tunggu 15 menit |
| HTTPS domain tidak jalan | Cek port forwarding 80 & 443 di router dan A record domain. Log: `docker compose logs caddy` |
| Disk penuh | Hapus materi yang tidak dipakai, kosongkan sampah lebih cepat: `docker compose exec app node src/cli.js purge-trash 0`, atau pindah ke harddisk lebih besar |

---

*Catatan teknis untuk pengembang ada di `HANDOFF-self-hosted-server.md` dan kode di folder `server/`.*
