#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<'EOF'
Backup database MySQL ke file .sql (opsional .gz).

Pemakaian:
  scripts/backup_mysql.sh [--method auto|docker|local] [--out-dir DIR] [--no-gzip] [--timestamped] [--prune-old]

Sumber konfigurasi:
  - akan membaca file .env di root project (jika ada)
  - env yang dipakai: DB_HOST, DB_USER, DB_PASS, DB_NAME, MYSQL_PORT

Contoh:
  scripts/backup_mysql.sh
  scripts/backup_mysql.sh --timestamped
  scripts/backup_mysql.sh --out-dir /tmp/backup
  scripts/backup_mysql.sh --method docker
  scripts/backup_mysql.sh --method local --no-gzip
EOF
}

METHOD="auto"
OUT_DIR=""
GZIP="1"
LATEST_ONLY="1"
PRUNE_OLD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --method) METHOD="${2:-}"; shift 2 ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 ;;
    --no-gzip) GZIP="0"; shift ;;
    --timestamped) LATEST_ONLY="0"; shift ;;
    --latest-only) LATEST_ONLY="1"; shift ;;
    --prune-old) PRUNE_OLD="1"; shift ;;
    *)
      echo "Argumen tidak dikenal: $1" >&2
      echo "Coba: scripts/backup_mysql.sh --help" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

# Load .env (jika ada)
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.env"
  set +a
fi

DB_NAME="${DB_NAME:-migunani_motor_db}"
DB_USER="${DB_USER:-migunani}"
DB_PASS="${DB_PASS:-password}"
DB_HOST="${DB_HOST:-mysql}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

if [[ -z "${OUT_DIR}" ]]; then
  OUT_DIR="${ROOT_DIR}/backups/mysql"
fi

mkdir -p "${OUT_DIR}"

# File output (timestamp Asia/Jakarta biar konsisten dengan stack).
if [[ "${LATEST_ONLY}" == "1" ]]; then
  BASE_NAME="${DB_NAME}_latest.sql"
else
  TS="$(TZ="${TZ_OVERRIDE:-Asia/Jakarta}" date +%Y%m%d_%H%M%S)"
  BASE_NAME="${DB_NAME}_${TS}.sql"
fi
OUT_FILE="${OUT_DIR}/${BASE_NAME}"
if [[ "${GZIP}" == "1" ]] && command -v gzip >/dev/null 2>&1; then
  OUT_FILE="${OUT_FILE}.gz"
fi

umask 077

TMP_FILE="$(mktemp "${OUT_DIR}/.${DB_NAME}.XXXXXX.tmp")"
cleanup_tmp() {
  rm -f "${TMP_FILE}" >/dev/null 2>&1 || true
}
trap cleanup_tmp EXIT

have_docker_compose() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

have_docker_compose_v1() {
  command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1
}

dump_via_docker() {
  local -a compose_cmd
  if have_docker_compose; then
    compose_cmd=(docker compose)
  elif have_docker_compose_v1; then
    compose_cmd=(docker-compose)
  else
    echo "Docker Compose tidak ditemukan." >&2
    return 1
  fi

  if ! "${compose_cmd[@]}" ps mysql >/dev/null 2>&1; then
    echo "Service 'mysql' belum jalan. Jalankan dulu: docker compose up -d mysql" >&2
    return 1
  fi

  # Dump dari dalam container mysql (host 127.0.0.1 agar TCP, bukan socket).
  if [[ "${GZIP}" == "1" ]] && command -v gzip >/dev/null 2>&1; then
    "${compose_cmd[@]}" exec -T mysql sh -lc \
      "MYSQL_PWD=\"${DB_PASS}\" mysqldump --protocol=tcp -h 127.0.0.1 -P 3306 -u\"${DB_USER}\" --databases \"${DB_NAME}\" --single-transaction --routines --events --triggers --hex-blob --default-character-set=utf8mb4 --no-tablespaces" \
      | gzip -c > "${TMP_FILE}"
  else
    "${compose_cmd[@]}" exec -T mysql sh -lc \
      "MYSQL_PWD=\"${DB_PASS}\" mysqldump --protocol=tcp -h 127.0.0.1 -P 3306 -u\"${DB_USER}\" --databases \"${DB_NAME}\" --single-transaction --routines --events --triggers --hex-blob --default-character-set=utf8mb4 --no-tablespaces" \
      > "${TMP_FILE}"
  fi
}

dump_via_local() {
  if ! command -v mysqldump >/dev/null 2>&1; then
    echo "mysqldump tidak ditemukan di mesin ini." >&2
    return 1
  fi

  export MYSQL_PWD="${DB_PASS}"
  if [[ "${GZIP}" == "1" ]] && command -v gzip >/dev/null 2>&1; then
    mysqldump --protocol=tcp -h "${DB_HOST}" -P "${MYSQL_PORT}" -u "${DB_USER}" \
      --databases "${DB_NAME}" \
      --single-transaction --routines --events --triggers --hex-blob --default-character-set=utf8mb4 --no-tablespaces \
      | gzip -c > "${TMP_FILE}"
  else
    mysqldump --protocol=tcp -h "${DB_HOST}" -P "${MYSQL_PORT}" -u "${DB_USER}" \
      --databases "${DB_NAME}" \
      --single-transaction --routines --events --triggers --hex-blob --default-character-set=utf8mb4 --no-tablespaces \
      > "${TMP_FILE}"
  fi
}

case "${METHOD}" in
  docker) dump_via_docker ;;
  local) dump_via_local ;;
  auto)
    if dump_via_docker 2>/dev/null; then
      :
    else
      dump_via_local
    fi
    ;;
  *)
    echo "Nilai --method tidak valid: ${METHOD} (pakai auto|docker|local)" >&2
    exit 2
    ;;
esac

mv -f "${TMP_FILE}" "${OUT_FILE}"

if [[ -z "${PRUNE_OLD}" ]] && [[ "${LATEST_ONLY}" == "1" ]]; then
  PRUNE_OLD="1"
fi

if [[ "${PRUNE_OLD}" == "1" ]]; then
  OUT_BASENAME="$(basename -- "${OUT_FILE}")"
  # Hapus backup lain untuk DB yang sama di folder ini, sisakan yang terbaru.
  # Pola: <DB_NAME>_*.sql atau <DB_NAME>_*.sql.gz
  find "${OUT_DIR}" -maxdepth 1 -type f \
    \( -name "${DB_NAME}_*.sql" -o -name "${DB_NAME}_*.sql.gz" \) \
    ! -name "${OUT_BASENAME}" \
    -exec rm -f {} + >/dev/null 2>&1 || true
fi

echo "Backup selesai: ${OUT_FILE}"
