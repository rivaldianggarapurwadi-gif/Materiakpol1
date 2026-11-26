#!/usr/bin/env bash
# Pemasang Materi AKPOL untuk Ubuntu Server (22.04 / 24.04).
# Jalankan dari folder server/:   sudo ./install.sh
# Aman dijalankan ulang (mis. setelah mengganti harddisk atau memasang GPU).
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
HERE="$PWD"

if [ "$(id -u)" -ne 0 ]; then echo "Jalankan dengan sudo:  sudo ./install.sh"; exit 1; fi
say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
setenv() { # setenv KEY VALUE  → tulis/ganti di .env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

say "1/6 Memasang Docker, Git, rsync"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 git rsync unattended-upgrades
systemctl enable --now docker

say "2/6 Pengaturan"
FIRST=0
if [ ! -f .env ]; then cp .env.example .env; FIRST=1; fi
if [ "$FIRST" = 1 ]; then
  read -rp "Folder penyimpanan materi (sebaiknya di harddisk besar) [$HERE/data]: " DATA
  DATA="${DATA:-$HERE/data}"
  setenv DATA_DIR "$DATA"
  echo
  echo "Alamat web. Kosongkan jika hanya dipakai di jaringan lokal (kampus/asrama)."
  echo "Jika punya domain yang sudah diarahkan ke IP publik server ini, isi domainnya (mis. materi.akpol-taruna.id)."
  read -rp "Domain (opsional): " DOMAIN
  if [ -n "$DOMAIN" ]; then setenv SITE_ADDRESS "$DOMAIN, :80"; else setenv SITE_ADDRESS ":80"; fi
fi
DATA_DIR=$(grep '^DATA_DIR=' .env | cut -d= -f2-)
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$HERE/${DATA_DIR#./}";; esac
mkdir -p "$DATA_DIR"
chown 1000:1000 "$DATA_DIR"   # pengguna "node" (uid 1000) di dalam container

say "3/6 Mendeteksi GPU untuk mempercepat proses video"
FILES="docker-compose.yml"
if [ -e /dev/dri/renderD128 ]; then
  FILES="$FILES:docker-compose.intel.yml"
  setenv RENDER_GID "$(stat -c %g /dev/dri/renderD128)"
  echo "GPU Intel/AMD ditemukan (/dev/dri) — dipakai untuk encode video."
fi
if command -v nvidia-smi >/dev/null 2>&1 && command -v nvidia-ctk >/dev/null 2>&1; then
  FILES="$FILES:docker-compose.nvidia.yml"
  echo "GPU NVIDIA ditemukan — dipakai untuk encode video."
fi
[ "$FILES" = "docker-compose.yml" ] && echo "Tidak ada GPU — video diproses dengan CPU (tetap jalan, hanya lebih lambat)."
setenv COMPOSE_FILE "$FILES"

say "4/6 Membangun dan menjalankan server (pertama kali bisa 5–15 menit)"
docker compose up -d --build
for i in $(seq 1 30); do
  docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null && break
  sleep 2
done

say "5/6 Admin"
HAS_ADMIN=$(docker compose exec -T app node --disable-warning=ExperimentalWarning src/cli.js list-admins | grep -vc 'Belum ada admin' || true)
if [ "$HAS_ADMIN" = "0" ]; then
  read -rp "Nama admin [admin]: " ADMIN; ADMIN="${ADMIN:-admin}"
  while true; do
    read -rsp "Kata sandi admin (min. 8 karakter): " P1; echo
    read -rsp "Ulangi kata sandi: " P2; echo
    [ "$P1" = "$P2" ] && [ ${#P1} -ge 8 ] && break
    echo "Kata sandi tidak sama atau kurang dari 8 karakter. Coba lagi."
  done
  printf '%s\n' "$P1" | docker compose exec -T app node --disable-warning=ExperimentalWarning src/cli.js add-admin "$ADMIN"
  unset P1 P2
else
  echo "Admin sudah ada:"; docker compose exec -T app node --disable-warning=ExperimentalWarning src/cli.js list-admins
fi

say "6/6 Cadangan otomatis setiap malam (02:30)"
chmod +x scripts/backup.sh
cat > /etc/cron.d/materi-akpol <<EOF
# Cadangan database Materi AKPOL (+ salinan file ke BACKUP_DEST jika diisi di .env)
30 2 * * * root $HERE/scripts/backup.sh >> /var/log/materi-akpol-backup.log 2>&1
EOF
echo "Terjadwal. Log: /var/log/materi-akpol-backup.log"

IP=$(hostname -I | awk '{print $1}')
SITE=$(grep '^SITE_ADDRESS=' .env | cut -d= -f2-)
say "Selesai!"
echo "Buka di jaringan lokal:  http://$IP/"
case "$SITE" in *.*) echo "Alamat publik:           https://${SITE%%,*}/";; esac
echo
echo "Langkah berikutnya (lihat PANDUAN.md):"
echo "  • Atur IP tetap untuk server ini di router (DHCP reservation)."
echo "  • Pindahkan materi dari Google Drive:  docker compose exec app node src/cli.js migrate-drive"
