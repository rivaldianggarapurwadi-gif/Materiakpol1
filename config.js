// Backend switch. This copy (GitHub Pages) uses Google Drive via Apps Script.
// The self-hosted server answers /config.js itself with `window.AKPOL_SERVER = true;`.
window.AKPOL_SERVER = false;
// Alamat server kampus (jaringan AKPOL). Versi GitHub Pages menampilkan banner yang mengarah ke sini.
window.AKPOL_CAMPUS_URL = 'http://10.4.128.65/';
// Alamat internet server kampus (Tailscale Funnel). Pengunjung GitHub Pages / Railway otomatis
// diarahkan ke sini selama server menyala. Tambahkan ?drive=1 di alamat untuk tetap di versi Google Drive.
window.AKPOL_PUBLIC_URL = 'https://materi-akpol.taild091b7.ts.net/';
