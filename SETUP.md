# Pasang server Google Drive (gratis, ±5 menit)

> Ingin pakai **komputer sendiri** tanpa Google Drive? Lihat [server/PANDUAN.md](server/PANDUAN.md).

Web ini menyimpan materi di **Google Drive** milikmu (gratis 15 GB, tanpa batas download bulanan).
Daftar file & folder disimpan di **Google Sheet**. Penghubungnya adalah **Google Apps Script**.

Gunakan akun Google yang akan menjadi "pemilik" semua materi.

## 1. Buat Apps Script

1. Buka **https://script.google.com** → klik **New project** (Proyek baru).
2. Ganti nama proyek (kiri atas) menjadi `Materi AKPOL`.
3. Hapus semua isi `Code.gs`, lalu **salin-tempel seluruh isi file [`apps-script/Code.gs`](apps-script/Code.gs)** dari repo ini.
4. Klik ikon 💾 **Save**.

## 2. Jalankan setup sekali

1. Di toolbar atas, pilih fungsi **`setup`** di dropdown, lalu klik **▶ Run**.
2. Muncul "Authorization required" → **Review permissions** → pilih akun Google-mu.
3. Muncul "Google hasn't verified this app" → klik **Advanced** → **Go to Materi AKPOL (unsafe)** → **Allow**.
   (Ini normal: script ini buatanmu sendiri, bukan aplikasi publik.)
4. Setelah selesai, di Google Drive-mu akan ada folder **"Materi AKPOL (jangan dihapus)"** berisi sheet **"Materi AKPOL - Database"**.

## 3. Deploy sebagai Web App

1. Klik **Deploy** (kanan atas) → **New deployment**.
2. Klik ikon ⚙️ di samping "Select type" → pilih **Web app**.
3. Isi:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Klik **Deploy**, lalu **salin "Web app URL"** (diawali `https://script.google.com/macros/s/...` dan diakhiri `/exec`).

## 4. Sambungkan ke web

Buka `index.html`, cari baris ini:

```js
const DRIVE_API_URL = 'PASTE_URL_WEB_APP_DI_SINI';
```

Ganti dengan URL dari langkah 3, simpan, lalu upload/commit `index.html` seperti biasa. Selesai ✅

---

## Catatan

- **Mengubah `Code.gs` nanti:** setelah edit, klik **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. URL tetap sama.
- **Ukuran file:** tidak ada batas khusus; file besar dikirim per 8 MB. Video ratusan MB bisa, hanya lebih lama.
- **Video yang baru diupload** kadang perlu beberapa menit diproses Google sebelum bisa diputar.
- **Kuota Google gratis:** 15 GB dibagi dengan Gmail & Google Photos akun tersebut. Sebaiknya pakai akun Google khusus untuk web ini.
- **Siapa pun yang membuka web** bisa upload, pindah, dan hapus (sama seperti sebelumnya dengan Supabase). File yang dihapus masuk **Sampah** Google Drive selama 30 hari, jadi masih bisa dipulihkan.

## Memindahkan materi lama dari Supabase (opsional)

Bisa dilakukan setelah project Supabase bisa diakses lagi (misalnya setelah kuota bulanan reset):

1. Di editor Apps Script, pilih fungsi **`migrateFromSupabase`** → **▶ Run**.
2. Lihat **Execution log**. Jika muncul "klik Run lagi", jalankan lagi sampai selesai (aman diulang, file yang sudah pindah dilewati).
3. File di atas 50 MB tidak bisa dipindah otomatis — namanya ditampilkan di log; upload ulang lewat web.

## Update: fitur Video Pembelajaran (link YouTube)

Upload file video langsung bekerja tanpa perubahan apa pun. Untuk fitur **menambahkan video dari link YouTube**, server perlu diperbarui sekali:

1. Buka proyek di **script.google.com**, ganti seluruh isi `Code.gs` dengan versi terbaru dari [`apps-script/Code.gs`](apps-script/Code.gs), klik 💾.
2. **Deploy → Manage deployments → ✏️ (Edit) → Version: New version → Deploy**.
   URL Web App **tetap sama**, jadi `index.html` tidak perlu diubah.

## Update: upload cepat & video lancar (versi server 2)

Fitur baru:
- **Video dikompres otomatis di browser** menjadi MP4 720p + salinan 360p (seperti YouTube). File jadi 3–10× lebih kecil → upload jauh lebih cepat dan video diputar lancar, juga di HP/koneksi lambat.
- **Upload langsung ke Google Drive** dari browser (tidak lewat Apps Script lagi).
- **Pilihan kualitas** di pemutar (⚙️ → Kualitas: Otomatis / 720p / 360p). Mode Otomatis turun ke 360p sendiri jika video tersendat.

Agar semua fitur aktif, perbarui server sekali (URL tidak berubah):
1. Ganti seluruh isi `Code.gs` dengan versi terbaru dari [`apps-script/Code.gs`](apps-script/Code.gs), klik 💾.
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.

Sebelum diperbarui, web tetap berfungsi: video tetap dikompres (720p), hanya saja upload masih lewat jalur lama dan belum ada versi 360p.

Catatan: video yang diupload **sebelum** update ini tidak dikompres. Untuk hasil terbaik, hapus lalu upload ulang video besar.

## Update: upload video LANGSUNG lewat Google Drive (versi server 3)

Untuk video besar, upload lewat Google Drive jauh lebih stabil daripada lewat web (bisa dilanjutkan otomatis bila koneksi putus, dan bisa ditinggal).

**Perbarui server sekali** (URL tidak berubah):
1. Ganti seluruh isi `Code.gs` dengan versi terbaru dari [`apps-script/Code.gs`](apps-script/Code.gs), klik 💾.
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.

**Cara pakai:**
1. Di web, buka **Upload**, lalu buat/pilih folder kursus (mis. `Hukum Pidana`). Folder yang sama otomatis dibuat di Google Drive, di dalam folder **"Materi AKPOL (jangan dihapus)"**.
2. Klik **Buka folder "…" di Google Drive ↗**, lalu seret video ke folder itu (atau pakai aplikasi Google Drive di HP/laptop). Tunggu sampai upload selesai.
3. Kembali ke web, klik **🔄 Ambil file baru dari Drive**. Video langsung muncul di halaman **Kursus**. (Web juga memeriksa Drive otomatis setiap dibuka.)

Catatan:
- Subfolder baru yang dibuat langsung di Drive juga muncul sebagai folder kursus di web.
- Folder Drive hanya bisa dibuka akun Google pemilik web. Agar pengajar lain bisa upload lewat Drive, bagikan folder "Materi AKPOL (jangan dihapus)" ke akun mereka sebagai **Editor**.
- Video yang diupload lewat Drive disimpan dalam kualitas aslinya (tidak dikompres). Agar lancar ditonton di HP, sebaiknya rekam/ekspor video dalam 720p.
- Jangan ubah nama atau hapus file "Materi AKPOL - Database" di folder tersebut.
