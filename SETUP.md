# Pasang server Google Drive (gratis, ±5 menit)

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
const API_URL = 'PASTE_URL_WEB_APP_DI_SINI';
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
