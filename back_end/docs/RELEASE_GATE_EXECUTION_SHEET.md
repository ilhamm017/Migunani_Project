# Release Gate Execution Sheet

Dokumen ini adalah lembar eksekusi final sebelum release. Isi berdasarkan rerun aktual, bukan asumsi.

## Current Gate Verdict

- Current decision: `GO WITH RESTRICTIONS`
- Backend transaction gate: `PASS`
- Frontend lint gate: `PASS`
- Remaining restrictions:
  - contract COD/SOP harus dipahami tim operasional
  - coverage automation belum 100% seluruh endpoint side-effect di seluruh sistem

## Mandatory Gate Checks

| Check | Command / Evidence | Owner | Status | Notes |
|---|---|---|---|---|
| Backend compile | `cd back_end && ./node_modules/.bin/tsc --noEmit --pretty false` | backend | `PASS` | compile clean |
| Frontend lint | `cd front_end && npm run lint` | frontend | `PASS` | lint clean |
| Full transaction assurance | `cd back_end && API_BASE_URL=http://127.0.0.1:5111/api/v1 npm run test:transaction-assurance` | backend | `PASS` | includes contract, actions, ownership, finance replay, notification, boundary-read, upload-policy |
| Transfer manual flow | `ST-001` | backend/QA | `PASS` | final status `completed` |
| COD flow + settlement | `ST-002` | backend/QA | `PASS WITH NOTE` | COD contract note remains |
| Partial fulfillment/backorder | `ST-008` | backend/QA | `PASS` | `partially_fulfilled` only after delivery |
| Retur end-to-end | `ST-013` | backend/QA | `PASS` | refund complete |
| Ownership regression | `npm run test:ownership-matrix` | backend | `PASS` | no cross-ownership leak in core paths |
| Finance replay regression | `npm run test:finance-replay` | backend | `PASS` | no duplicate journal in covered flows |
| Notification soft-fail | `npm run test:notification-softfail` | backend | `PASS` | WA degraded path non-blocking |
| Boundary read regression | `npm run test:boundary-read` | backend | `PASS` | no false `500` on covered read boundary paths |
| Upload policy regression | `npm run test:upload-policy` | backend | `PASS` | MIME/size rejection stable on covered multipart paths |
| UI smoke `/driver` | manual smoke checklist | QA | `PENDING MANUAL` | run before release |
| UI smoke `/driver/orders/[id]` | manual smoke checklist | QA | `PENDING MANUAL` | run before release |
| UI smoke `/admin/finance/cod` | manual smoke checklist | QA | `PENDING MANUAL` | run before release |
| UI smoke `/orders/[id]` | manual smoke checklist | QA | `PENDING MANUAL` | run before release |
| UI smoke `/invoices/[invoiceId]` | manual smoke checklist | QA | `PENDING MANUAL` | run before release |

## Release Rule

- `GO`
  - all mandatory automated gates pass
  - manual smoke pass
  - no new P0 fail
- `GO WITH RESTRICTIONS`
  - all automated gates pass
  - manual smoke pending or pass
  - only documented contract/coverage notes remain
- `NO-GO`
  - any fail in money, stock, auth, ownership, order integrity, or finance replay

## Operator Notes

- COD current contract:
  - COD invoice can already be `cod_pending` at invoice issuance
  - `driver recordPayment` is not mandatory in every COD flow
- `partially_fulfilled`:
  - should only appear after delivery on orders that still have active backorder
- Notification reliability:
  - socket transaction events are now outbox-backed for core flows
  - async WA transaction notification core path is retry-backed
  - OTP and interactive chat remain synchronous by contract
