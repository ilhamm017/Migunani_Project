# Transaction Assurance Runbook

Dokumen ini menjadi runbook eksekusi pengecekan menyeluruh alur transaksi dari awal sampai akar penyebab.

## Tujuan
- memastikan flow transaksi tidak hanya `200`, tetapi juga benar pada status, jurnal, stok, dan ownership
- memaksa setiap fail punya akar penyebab yang jelas
- mengurangi false confidence sebelum release

## Gelombang Eksekusi

### Gelombang 1: Gate Kritis
- auth/access
- checkout `transfer_manual` dan `cod`
- allocation penuh/parsial
- ship/driver complete
- verify payment / verify COD
- retur / refund

### Gelombang 2: Integrity and Replay
- duplicate checkout
- duplicate verify payment / COD / refund / adjustment
- upload invalid MIME/size
- ownership invalid
- false `500` pada invalid state

### Gelombang 3: Upstream / Downstream
- stock mutation lalu checkout
- PO create / receive lalu allocate
- supplier / product / category update path
- import preview / commit invalid path
- stock opname invalid path

### Gelombang 4: Release Confirmation
- rerun regression pada isolated backend
- smoke UI customer / driver / finance / order / invoice
- freeze evidence ke execution matrix dan readiness summary

## Perintah Audit

Jalankan backend isolated lebih dulu, lalu:

```bash
cd back_end
API_BASE_URL=http://127.0.0.1:5105/api/v1 npm run test:transaction-assurance
```

Atau per fase:

```bash
npm run test:action-matrix
npm run test:ownership-matrix
npm run test:finance-replay
npm run test:notification-softfail
```

## Aturan Evidence
- setiap skenario wajib punya `response`, `status before/after`, dan `side effect`
- skenario finance wajib punya `journal count/reference before/after`
- skenario access wajib punya `role`, `resource`, dan hasil `200/403/404`
- skenario replay wajib membedakan:
  - replay-safe
  - second-action reject cleanly
  - contract limitation

## Aturan Root Cause
- jangan berhenti di symptom UI atau HTTP code
- klasifikasikan akar masalah ke salah satu:
  - auth/guard
  - state transition
  - transaction boundary
  - replay/idempotency
  - upload policy
  - async notification
  - SOP/wording mismatch

## Artefak Wajib
- `TRANSACTION_CONTRACT_MAP.md`
- `TRANSACTION_EXECUTION_MATRIX.md`
- `TRANSACTION_REPLAY_MATRIX.md`
- `TRANSACTION_ROOT_CAUSE_LEDGER.md`
- `SYSTEM_TEST_EXECUTION_REPORT_2026-03-10.md`
- `SYSTEM_READINESS_SUMMARY.md`
