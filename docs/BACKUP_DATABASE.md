# Backup Database MySQL

Project ini menyediakan skrip backup berbasis `mysqldump`.

## Prasyarat

- Jika memakai Docker: Docker + Docker Compose (service `mysql` harus sudah jalan).
- Jika tanpa Docker: `mysqldump` terpasang dan MySQL bisa diakses (host/port/user/pass).

## Backup (disarankan)

Dari root project:

```bash
scripts/backup_mysql.sh
```

Output default (latest-only): `backups/mysql/<DB_NAME>_latest.sql.gz`

Skrip akan membaca konfigurasi dari `.env` (jika ada), terutama:
- `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `MYSQL_PORT`

## Opsi

```bash
# simpan versi bertimestamp (tidak menimpa file latest)
scripts/backup_mysql.sh --timestamped

# paksa pakai docker compose exec
scripts/backup_mysql.sh --method docker

# paksa koneksi langsung ke host/port
scripts/backup_mysql.sh --method local

# simpan ke folder lain
scripts/backup_mysql.sh --out-dir /tmp/backup

# tanpa gzip
scripts/backup_mysql.sh --no-gzip

# bersihkan backup lain untuk DB yang sama (sisakan yang terbaru)
scripts/backup_mysql.sh --prune-old
```

## Restore (manual)

> Pastikan Anda restore ke DB yang benar.

```bash
# Jika file .sql
MYSQL_PWD=... mysql -h ... -P ... -u ... < file.sql

# Jika file .sql.gz
gunzip -c file.sql.gz | MYSQL_PWD=... mysql -h ... -P ... -u ...
```
