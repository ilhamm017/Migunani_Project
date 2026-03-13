# Transaction Execution Matrix

Dokumen ini menggabungkan skenario runtime utama, evidence, dan verdict audit transaksi.

| Scenario Family | Scenario IDs | Current Verdict | Evidence Source | Root-Cause Status | Patch Owner |
|---|---|---|---|---|---|
| Auth / access | `ST-003`, `ST-005`, `ST-014`, `ST-015`, `ST-016`, `ST-021`, `ST-023`, `ST-024`, `ST-026`, `ST-030`, `ST-033` | `PASS` / `PATCHED AND RETESTED` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | inti sudah tertutup; boundary read inti kini ikut diautomasi | backend |
| Checkout transfer/COD | `ST-001`, `ST-002`, `ST-011`, `ST-019` | `PASS WITH NOTE` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | contract COD masih perlu dijaga | backend + ops |
| Allocation / backorder | `ST-008`, `ST-010` | `PASS` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | tidak ada fail terbuka | backend |
| Warehouse / driver | `ST-006`, `ST-007` | `PASS` / `PASS AFTER PATCH` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | invalid-state fixed | backend |
| Payment proof lifecycle | `ST-004`, `ST-009`, `ST-027`, `ST-034` | `PASS` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | upload + async notify terkendali; MIME/oversize kini punya regression runtime | backend |
| Finance replay | `ST-012`, `ST-017`, `ST-018`, `ST-020`, `ST-025` | `PASS` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | replay inti tertutup | backend |
| Retur / refund | `ST-013`, `ST-016`, `ST-020` | `PASS` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | inti aman | backend |
| Notification resilience | `ST-027`, `ST-029`, `ST-032` | `PASS` / `PATCHED AND RETESTED` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | degraded path sudah failed-soft, socket event inti via outbox, dan async WA transaction notification utama sudah retry-backed | backend |
| Boundary read validation | `ST-030`, `ST-033` | `PASS` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | invalid boundary input inti kini tidak jatuh ke false `500` | backend |
| Upload policy regression | `ST-004`, `ST-034` | `PASS` | `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md` | invalid MIME/oversize pada jalur multipart inti tervalidasi runtime | backend |
| Transaction assurance gate | action + ownership + finance replay + notification + boundary-read + upload-policy | `PASS` | `test:transaction-assurance` pada isolated backend | runner end-to-end lulus penuh setelah fixture replay distabilkan, outbox aktif, dan runner boundary/upload ditambahkan | backend |

## Pending Expansion

| Family | Status | Reason |
|---|---|---|
| Full scenario matrix `SCN-*` | `PARTIAL` | belum semua skenario lapangan dieksekusi runtime |
| Full UI smoke | `PARTIAL` | masih mengandalkan smoke checklist manual |
| Non-core controller catch audit | `PARTIAL` | sebagian controller belum dipukul runtime fail-path |
