#!/bin/bash
# Pindahkan SEMUA materi dari Google Drive ke server kampus, lalu rapikan per mapel (Video / PPT / Tentir).
# Dijalankan dari Mac/laptop yang tersambung ke jaringan yang sama dengan server:
#   git -C ~/akpol/Materiakpol1 pull && bash ~/akpol/Materiakpol1/server/scripts/migrate-via-mac.sh
# Jika server tidak bisa menjangkau Google (diblokir jaringan), Mac yang mengunduh file lalu mengirimnya ke server.
# Aman dijalankan ulang: file yang sudah pindah dilewati.
set -u
SERVER="${SERVER:-kentung@10.4.128.65}"
REMOTE="${REMOTE:-/home/kentung/Materiakpol1}"
REPO="${REPO:-$HOME/akpol/Materiakpol1}"
API="${API:-https://script.google.com/macros/s/AKfycbyJ1hvlyX0vDeKo_Bf6-tdVnMm2nBfnbAypTVBgTvO-3hx0Fch2K4iksJ80vRTkc8gf/exec}"
WORK="${WORK:-/tmp/akpol-drive}"

srv() { ssh "$SERVER" "cd $REMOTE/server && $1"; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
fail() { printf '\n\033[31mGAGAL: %s\033[0m\n' "$1"; exit 1; }

step "1/5 Memperbarui server ke versi terbaru"
git -C "$REPO" pull --ff-only || fail "git pull di Mac gagal"
git -C "$REPO" bundle create /tmp/akpol.bundle main >/dev/null 2>&1 || fail "bundle gagal"
scp -q /tmp/akpol.bundle "$SERVER:/tmp/" || fail "tidak bisa mengirim ke server (cek WiFi / ssh)"
ssh "$SERVER" "cd $REMOTE && git pull --ff-only -q /tmp/akpol.bundle main && cd server && docker compose up -d --build && docker compose restart caddy" \
  || fail "update server gagal"

step "2/5 Memeriksa apakah server bisa menjangkau Google"
if srv "docker compose exec -T app node -e 'fetch(\"https://script.google.com\",{signal:AbortSignal.timeout(15000)}).then(()=>process.exit(0),()=>process.exit(1))'"; then
  step "3/5 Server mengunduh langsung dari Google Drive"
  srv "docker compose exec -T app node src/cli.js migrate-drive" || echo "(ada file yang gagal — jalankan skrip ini lagi untuk mencoba ulang)"
else
  echo "Server tidak bisa menjangkau Google → Mac yang mengunduh, lalu mengirim ke server."
  step "3/5 Mengunduh lewat Mac"
  rm -rf "$WORK" && mkdir -p "$WORK/files"
  curl -sfL "$API?action=list" -o "$WORK/list.json" || fail "tidak bisa mengambil daftar dari Apps Script"
  grep -q '"ok":true' "$WORK/list.json" || fail "respon Apps Script tidak valid: $(head -c 200 "$WORK/list.json")"
  srv "docker compose exec -T app sh -c 'rm -rf /data/import && mkdir -p /data/import/files && cat > /data/import/list.json'" < "$WORK/list.json" \
    || fail "tidak bisa mengirim daftar ke server"
  IDS=$(srv "docker compose exec -T app node src/cli.js migrate-drive --from-dir /data/import --missing-ids") || fail "server tidak bisa membaca daftar"
  TOTAL=$(printf '%s\n' $IDS | grep -c . || true)
  echo "$TOTAL file perlu diunduh."
  N=0; BAD=0
  for id in $IDS; do
    N=$((N + 1))
    ct=$(curl -sfL -w '%{content_type}' -o "$WORK/files/$id" "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t") || ct="error"
    if [ "$ct" = "error" ] || printf '%s' "$ct" | grep -qi 'text/html'; then
      rm -f "$WORK/files/$id"; BAD=$((BAD + 1)); echo "  [$N/$TOTAL] ✗ $id (akses ditolak / kuota download habis — coba lagi nanti)"
    else
      echo "  [$N/$TOTAL] ✓ $id ($(du -h "$WORK/files/$id" | cut -f1))"
    fi
  done
  step "4/5 Mengirim file ke server"
  tar -C "$WORK/files" -cf - . | srv "docker compose exec -T app tar -C /data/import/files -xf -" || fail "pengiriman ke server gagal"
  srv "docker compose exec -T app node src/cli.js migrate-drive --from-dir /data/import" || echo "(ada file yang gagal — jalankan skrip ini lagi untuk mencoba ulang)"
  srv "docker compose exec -T app rm -rf /data/import" || true
  rm -rf "$WORK"
  [ "$BAD" -gt 0 ] && echo "$BAD file belum bisa diunduh dari Drive — jalankan skrip ini lagi nanti."
fi

step "5/5 Merapikan per mapel (Video / PPT / Tentir)"
srv "docker compose exec -T app node src/cli.js organize-mapel" || fail "rencana merapikan gagal"
printf '\nJalankan rencana di atas sekarang? Ketik y lalu Enter (selain itu = batal): '
read -r ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  srv "docker compose exec -T app node src/cli.js organize-mapel --apply" || fail "merapikan gagal"
  printf '\n\033[32mSelesai! Buka http://10.4.128.65/ lalu tekan Cmd+Shift+R.\033[0m\n'
else
  echo "Dibatalkan — materi sudah pindah, tetapi belum dirapikan. Jalankan skrip ini lagi kapan saja."
fi
