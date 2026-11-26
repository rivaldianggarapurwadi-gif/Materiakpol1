#!/usr/bin/env bash
# Cadangan Materi AKPOL. Dijalankan otomatis tiap malam oleh cron (dipasang install.sh).
#  1. Salin database ke DATA_DIR/backups/akpol-<tanggal>.sqlite (14 terakhir disimpan).
#  2. Jika BACKUP_DEST diisi di .env (mis. harddisk eksternal /mnt/cadangan), salin juga
#     database + semua file asli ke sana. File yang dihapus di web TIDAK ikut dihapus dari cadangan.
#     Versi video 1080p–360p, thumbnail, dan pratinjau tidak dicadangkan (bisa dibuat ulang).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
HERE="$PWD"

get() { grep "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
DATA_DIR=$(get DATA_DIR); DATA_DIR=${DATA_DIR:-./data}
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$HERE/${DATA_DIR#./}";; esac
DEST=$(get BACKUP_DEST)

echo "== $(date '+%F %T') cadangan dimulai"
docker compose exec -T app node --disable-warning=ExperimentalWarning src/cli.js backup

if [ -n "$DEST" ]; then
  # Folder kosong yang bukan mount point = harddisk cadangan belum terpasang; jangan isi disk utama.
  if [ ! -d "$DEST" ] || { ! mountpoint -q "$DEST" && [ -z "$(ls -A "$DEST")" ]; }; then
    echo "!! BACKUP_DEST=$DEST tidak ditemukan atau harddisk belum terpasang — hanya database yang dicadangkan"
    exit 1
  fi
  mkdir -p "$DEST/materi-akpol"
  rsync -a "$DATA_DIR/backups/" "$DEST/materi-akpol/backups/"
  rsync -a "$DATA_DIR/media/files/" "$DEST/materi-akpol/files/"
  cp "$HERE/.env" "$DEST/materi-akpol/env-backup"
  echo "Disalin ke $DEST/materi-akpol ($(du -sh "$DEST/materi-akpol" | cut -f1))"
fi
echo "== $(date '+%F %T') selesai"
