# System Test Execution Report - 2026-03-10

## Environment
- Backend: local dev server on `127.0.0.1:5000`
- Database: seeded local MySQL data via project seeder
- Frontend UI: not used for these runs; scenario execution was API-driven because an existing Next dev instance already held the `.next/dev/lock`

## Executed Scenarios

### ST-001 Transfer Manual Happy Flow
- Result: `PASS`
- Flow:
  - customer checkout `transfer_manual`
  - kasir allocate
  - kasir issue invoice
  - customer upload payment proof
  - finance approve payment
  - admin gudang ship with active driver
  - driver complete delivery
- Evidence:
  - order final status: `completed`
  - invoice payment status: `paid`
  - customer order detail timeline populated

### ST-002 COD Flow With Finance Verification
- Result: `PASS WITH NOTE`
- Flow:
  - customer checkout `cod`
  - kasir allocate
  - kasir issue invoice
  - admin gudang ship
  - driver complete delivery
  - finance verify COD settlement
- Evidence:
  - status after ship: `shipped`
  - final order status: `completed`
  - final invoice payment status: `paid`
- Note:
  - driver `recordPayment` returned `409` because invoice was already `cod_pending` immediately after invoice issuance
  - this is current behavior, not necessarily a defect, but it differs from the operational assumption that driver must always record COD collection first

### ST-003 Customer Ownership Isolation
- Result: `PASS`
- Flow:
  - customer1 created order
  - customer2 requested customer1 order detail
- Evidence:
  - response HTTP: `404`
  - body: `Order details not found`

### ST-004 Upload Payment Proof Invalid MIME
- Result: `PASS`
- Flow:
  - customer uploaded `text/plain` file to `/orders/:id/proof`
- Evidence:
  - response HTTP: `400`
  - body: `File harus berupa JPG, PNG, atau WEBP`

### ST-005 Auth Revalidation After User Banned
- Result: `PASS`
- Flow:
  - customer login and obtain token
  - user status updated in DB to `banned`
  - same token reused on protected endpoint
- Evidence:
  - response HTTP: `403`
  - body: `Account is inactive or banned`
- Impact:
  - confirms `authMiddleware` revalidates DB user status and does not trust JWT payload alone

### ST-006 Driver Issue Happy Path
- Result: `PASS`
- Flow:
  - customer checkout
  - kasir allocate
  - kasir issue invoice
  - admin gudang set `shipped` with active driver
  - driver reports issue through `/driver/orders/:id/issue`
- Evidence:
  - status after ship: `shipped`
  - issue response HTTP: `200`
  - final order status: `hold`
  - `courier_id`: `null`

### ST-007 Driver Issue Invalid State
- Result: `PASS AFTER PATCH`
- Flow:
  - driver reports issue on an order still owned by the same driver, but status already `delivered`
- Evidence:
  - response HTTP: `409`
  - body: `Laporan kekurangan hanya bisa dibuat pada order yang masih aktif dikirim.`
- Patch applied:
  - `src/controllers/driver/issues.ts` now uses safe rollback and preserves `CustomError`

### ST-008 Partial Fulfillment / Backorder Flow
- Result: `PASS`
- Flow:
  - customer checkout with one available item and one out-of-stock item
  - kasir allocate available item only
  - kasir issue partial invoice
  - admin gudang ship
  - driver complete delivery
- Evidence:
  - allocation result: `partially_allocated`
  - status after allocate: `waiting_invoice`
  - status after invoice: `ready_to_ship`
  - status after ship: `shipped`
  - final status after delivery: `partially_fulfilled`
  - item summary shows one line with `backorder_open_qty: 1`

### ST-009 Payment Proof Reject Then Re-upload
- Result: `PASS`
- Flow:
  - customer upload valid transfer proof
  - finance rejects payment
  - customer re-uploads proof
  - finance approves payment
- Evidence:
  - status after reject: `hold`
  - invoice proof URL cleared after reject
  - second upload accepted
  - status after approve: `ready_to_ship`

### ST-010 Cancel Backorder Without Cancel Full Order
- Result: `PASS`
- Flow:
  - customer checkout with one allocatable item and one out-of-stock item
  - kasir allocates partial stock
  - kasir cancels backorder shortage only
- Evidence:
  - response message: `Backorder / pre-order berhasil dibatalkan.`
  - final order status: `waiting_invoice`
  - item summary shows `backorder_open_qty: 0` and `backorder_canceled_qty: 1` on shortage line

### ST-011 Checkout Idempotency Replay
- Result: `PASS`
- Flow:
  - send two checkout requests with same `Idempotency-Key`
- Evidence:
  - both responses return the same `order_id`
  - second request replays committed payload instead of creating a second order

### ST-012 Verify Driver COD Idempotency Replay
- Result: `PASS`
- Flow:
  - complete COD order flow to finance settlement stage
  - send two `verifyDriverCod` requests with same `Idempotency-Key`
- Evidence:
  - second response replays settlement payload
  - order remains `completed`
  - no duplicate financial effect observed in the API response path

### ST-013 Retur End-to-End
- Result: `PASS`
- Flow:
  - completed transfer order
  - customer submits retur
  - kasir approves
  - kasir assigns pickup driver with refund amount
  - driver picks up and hands to warehouse
  - kasir receives and completes
  - finance disburses refund
- Evidence:
  - retur reaches `completed`
  - `refund_disbursed_at` filled
  - customer order stays `completed`

### ST-014 Illegal Customer Access Cross-Ownership
- Result: `PASS`
- Flow:
  - customer2 requests order detail belonging to customer1
- Evidence:
  - response HTTP: `404`
  - body: `Order details not found`

### ST-015 Invoice Detail Access Hardening
- Result: `PATCHED AND RETESTED`
- Flow:
  - customer owner requests own invoice
  - customer lain requests invoice milik orang lain
  - driver non-owner requests invoice yang bukan tugasnya
  - driver assigned requests invoice miliknya sendiri
- Evidence:
  - customer owner: `200`
  - other customer: `403`
  - unrelated driver: `403`
  - assigned driver: `200`
- Patch applied:
  - `src/controllers/InvoiceController.ts` now restricts invoice access by role and ownership instead of allowing any authenticated non-customer

### ST-016 Driver Retur Detail/Update Access Hardening
- Result: `PATCHED AND RETESTED`
- Flow:
  - assigned driver requests assigned retur detail
  - driver lain requests/pushes status on retur yang bukan tugasnya
- Evidence:
  - assigned driver detail: `200`
  - unassigned driver detail: `404`
  - unassigned driver status update: `404`
- Patch applied:
  - `src/controllers/driver/retur.ts` now preserves `CustomError` instead of masking ownership rejection as `500`

### ST-017 Verify Payment Anti Double-Post
- Result: `PASS`
- Flow:
  - verify transfer payment once
  - repeat approve on same invoice
- Evidence:
  - journal count `payment_verify` before: `0`
  - after first approve: `1`
  - second approve: `409`
  - journal count after second approve remains `1`

### ST-018 Verify Driver COD Anti Double-Post
- Result: `PASS`
- Flow:
  - verify COD settlement with `Idempotency-Key`
  - replay same request with the same key
- Evidence:
  - `cod_settlements` count before: `2`
  - after first verify: `3`
  - after replay: still `3`
  - `cod_settlement` journal count before: `2`
  - after first verify: `3`
  - after replay: still `3`

### ST-019 Driver Record Payment Operational Contract
- Result: `PASS WITH NOTE`
- Flow:
  - create COD order
  - issue invoice
  - ship order to driver
  - attempt `driver recordPayment`
- Evidence:
  - invoice before driver action already `cod_pending`
  - `CodCollection` count before: `0`
  - first `recordPayment`: `409 Pembayaran COD sudah dicatat sebelumnya.`
  - replay with same key: same `409`
  - invoice state and `CodCollection` count remain unchanged

### ST-020 Retur Refund Anti Double-Post
- Result: `PASS`
- Flow:
  - retry disburse on retur that already has `refund_disbursed_at`
- Evidence:
  - journal count `retur_refund` before: `1`
  - replay response: `400 Dana retur ini sudah dicairkan sebelumnya`
  - journal count after replay remains `1`

### ST-021 AR Detail Missing-ID Error Handling
- Result: `PATCHED AND RETESTED`
- Flow:
  - admin finance requests AR detail with nonexistent ID
- Evidence:
  - sebelum patch: `500 Error fetching AR detail`
  - sesudah patch: `404 Data piutang tidak ditemukan`
- Patch applied:
  - `src/controllers/finance/receivable.ts` now preserves `CustomError` in AR detail handler

### ST-022 Finance Report Validation Error Handling
- Result: `PATCHED AND RETESTED`
- Flow:
  - request finance reports without mandatory date parameters
- Evidence:
  - sebelum patch: `500`
  - sesudah patch: `400`
  - affected endpoints: `reports/pnl`, `reports/cash-flow`, `reports/tax-summary`
- Patch applied:
  - `src/controllers/ReportController.ts` now preserves validation-style business errors instead of masking them as generic `500`

### ST-023 Finance and Non-Finance Extended Access Matrix
- Result: `PASS`
- Flow:
  - runtime access audit on core finance detail endpoints and selected non-finance admin actions
- Evidence:
  - `GET /admin/finance/ar`: finance/admin `200`, other roles `403`
  - `GET /admin/finance/ar/:id`: finance/admin `200` on valid ID, `404` on missing ID, other roles `403`
  - `GET /admin/finance/journals`: finance/admin `200`, other roles `403`
  - `GET /admin/finance/driver-cod`: finance/admin `200`, other roles `403`
  - selected non-finance admin actions now return `400/404` for valid roles and `403` for unauthorized roles

### ST-024 Non-Finance Action Endpoint Matrix
- Result: `PASS`
- Flow:
  - automated role/action regression against invalid payload or missing-resource paths for non-finance admin endpoints
- Evidence:
  - runtime script: `API_BASE_URL=http://127.0.0.1:5103/api/v1 npm run test:action-matrix`
  - total checks passed: `228`
  - covered endpoints include customer OTP/create/status/tier, shipping methods, vouchers, staff, accounts create-update-delete, allocation allocate/cancel-backorder invalid paths, category update-delete-tier, supplier update-delete, product update-tier, stock mutation, PO receive, import preview/commit/import-from-path invalid paths, and stock opname invalid action paths
- Patch applied:
  - non-finance controllers now preserve `CustomError` and reject invalid payloads as `400/404` instead of false `500`

### ST-026 Ownership Regression Automation
- Result: `PASS`
- Flow:
  - run ownership regression on isolated backend server using seeded `customer1`, `customer2`, `driver1`, `driver2`, `kasir`, `admin_gudang`, and `admin_finance`
- Evidence:
  - runtime script: `API_BASE_URL=http://127.0.0.1:5103/api/v1 npm run test:ownership-matrix`
  - `customer2` cannot access `customer1` order detail: `404`
  - invoice detail access remains bounded: owner customer `200`, unrelated customer `403`, assigned driver `200`, unrelated driver `403`
  - retur assignment access remains bounded: assigned driver `200`, unrelated driver detail/update `404`
  - finance list endpoints remain blocked for unrelated customer/driver: `403`
  - `admin/accounts`, `admin/finance/expenses`, and `expense-labels` stay blocked for unrelated customer/driver: `403`
  - `whatsapp/status` remains `200` only for `super_admin` / `kasir`, and `403` for `admin_finance`
  - `allocation/pending` remains `200` for `kasir` and `403` for unrelated customer / finance role
- Notes:
  - run used isolated backend on `127.0.0.1:5103` to avoid contamination from existing long-lived dev processes on the default port

### ST-025 Finance Replay Regression Automation
- Result: `PASS`
- Flow:
  - run issue-invoice replay, issue-invoice-by-items replay, transfer verify replay, COD settlement replay, retur refund replay, expense approve/pay replay, expense-label mutation replay, adjustment journal replay, period close replay, credit note post replay, invoice void replay, and supplier invoice pay replay on isolated backend server using seeded accounts
- Evidence:
  - runtime script: `API_BASE_URL=http://127.0.0.1:5107/api/v1 npm run test:finance-replay`
  - issue-invoice replay: invoice count for the same order stayed `0 -> 1 -> 1` and replay returned the same `invoice_id`
  - issue-invoice-by-items replay: invoice count for the same order stayed `0 -> 1 -> 1` and replay returned the same `invoice_id`
  - transfer verify replay: `payment_verify` journals stayed `0 -> 1 -> 1`
  - COD verify replay: `cod_settlement` journals stayed `9 -> 10 -> 10`
  - retur refund replay: `retur_refund` journals stayed `0 -> 1 -> 1`
  - expense pay replay: `expense` journals stayed `0 -> 1 -> 1`
  - expense-label mutation replay: duplicate create/update rejected cleanly and repeat delete ended `404` without duplicate side effect
  - adjustment journal replay: marker journal count stayed `0 -> 1 -> 1` on repeated request with the same `Idempotency-Key`
  - period close replay: first close succeeded and second close returned clean business rejection without duplicate side effect
  - credit note post replay: `credit_note` journals stayed `0 -> 1 -> 1`
  - invoice void replay: `order_reversal` journals stayed `0 -> 2 -> 2` and same-key replay returned the committed payload instead of reposting reversal
  - supplier invoice pay replay: `supplier_payment` journals stayed `1 -> 2 -> 2`
  - replay did not create duplicate journal side effects
- Notes:
  - run used isolated backend on `127.0.0.1:5107` to avoid contamination from existing long-lived dev processes on the default port

### ST-027 WhatsApp Notification Soft-Fail Regression
- Result: `PASS`
- Flow:
  - force WhatsApp client to remain non-`READY`
  - trigger customer OTP send
  - trigger transfer payment-proof upload flow with async finance/customer notification
  - trigger chat thread reply on WhatsApp channel
- Evidence:
  - runtime script: `API_BASE_URL=http://127.0.0.1:5104/api/v1 npm run test:notification-softfail`
  - OTP send returned clean business `409` with `WhatsApp bot belum terhubung`
  - payment-proof upload still returned `200` and order moved to `waiting_admin_verification`
  - chat WhatsApp send returned clean business `409` with `WhatsApp belum terhubung`
  - structured `[WA_SEND]` logs now show `skipped_not_ready` instead of uncaught runtime exceptions when client status is `STOPPED`
- Patch applied:
  - `src/services/WhatsappSendService.ts` centralizes WA send with structured result `sent | skipped_not_ready | skipped_no_target | failed_soft`
  - order/customer/chat notification paths now consume that wrapper and preserve business status codes instead of leaking false `500`

### ST-028 Transaction Assurance Full Gate
- Result: `PASS`
- Flow:
  - run `test:transaction-assurance` against isolated backend instance
  - gate covers baseline system status, action matrix, ownership matrix, finance replay, and notification soft-fail
- Evidence:
  - runtime command: `API_BASE_URL=http://127.0.0.1:5106/api/v1 npm run test:transaction-assurance`
  - summary result:
    - `PASS contract`
    - `PASS actions`
    - `PASS ownership`
    - `PASS finance-replay`
    - `PASS notification`
- Patch applied:
  - finance replay `period close` now uses a dynamic fixture instead of a fixed global period
  - allocation editability is now locked to pre-finance/pre-shipping statuses
  - finance void/reversal validates existing reversal and status-transition eligibility before posting reversal journals
  - upload orphan cleanup now runs on error path via centralized middleware
  - customer ban flow now requires explicit confirmation before halting open orders in bulk

### ST-029 Notification Outbox Worker
- Result: `PATCHED AND RETESTED`
- Flow:
  - replace direct socket emit helper for order/retur/COD/admin badge notifications with persistent outbox enqueue
  - move outbox enqueue for critical order/retur/finance/COD flows into the same transaction boundary before commit
  - start internal outbox worker on backend boot
  - rerun replay and full transaction assurance on isolated backend
- Evidence:
  - `test:finance-replay`: `PASS`
  - `test:transaction-assurance`: `PASS`
  - runtime server log now shows `[NOTIF_OUTBOX] ... status: 'delivered'` during critical transaction flows
- Patch applied:
  - `src/models/NotificationOutbox.ts`
  - `src/services/TransactionNotificationOutboxService.ts`
  - `src/utils/orderNotification.ts`
  - `src/server.ts`
  - critical callsites now await enqueue inside transaction:
    - `src/controllers/order/checkout.ts`
    - `src/controllers/order/customer.ts`
    - `src/controllers/order/admin.ts`
    - `src/controllers/allocation/mutation.ts`
    - `src/controllers/finance/payment.ts`
    - `src/controllers/finance/invoice.ts`
    - `src/controllers/finance/cod.ts`
    - `src/services/ReturService.ts`

### ST-030 False-500 Hardening for Edge Read Paths
- Result: `PATCHED AND RETESTED`
- Flow:
  - preserve business `4xx` on non-core read paths that previously risked being wrapped as generic `500`
  - rerun full `test:transaction-assurance` on isolated backend after patch
- Evidence:
  - runtime command: `API_BASE_URL=http://127.0.0.1:5107/api/v1 npm run test:transaction-assurance`
  - summary result:
    - `PASS contract`
    - `PASS actions`
    - `PASS ownership`
    - `PASS finance-replay`
    - `PASS notification`
- Patch applied:
  - `src/controllers/CatalogController.ts`
  - `src/controllers/customer/query.ts`
  - `src/controllers/driver/orders.ts`
  - `src/controllers/driver/wallet.ts`
  - `src/controllers/ReturController.ts`
- Notes:
  - batch ini menutup pola catch generic di jalur public/catalog, query customer admin, wallet driver, assigned order list, dan retur controller utama
  - targetnya adalah mencegah error validasi/ownership yang sudah diketahui jatuh menjadi `500` generik pada jalur pinggiran

### ST-031 Legacy Order Status Alias Hardening
- Result: `PATCHED AND RETESTED`
- Flow:
  - remove silent legacy alias normalization from runtime transition guard
  - keep `waiting_payment -> ready_to_ship` only as explicit backward-compat shim on query boundary and legacy-record upgrade path
  - rerun compile and regression gate on isolated backend
- Evidence:
  - `back_end` `tsc --noEmit`: `PASS`
  - `API_BASE_URL=http://127.0.0.1:5107/api/v1 npm run test:action-matrix`: `PASS`
  - `API_BASE_URL=http://127.0.0.1:5107/api/v1 npm run test:ownership-matrix`: `PASS`
  - `API_BASE_URL=http://127.0.0.1:5107/api/v1 npm run test:finance-replay`: `PASS`
- Patch applied:
  - `src/utils/orderTransitions.ts`
  - `src/controllers/order/customer.ts`
  - `src/controllers/order/admin.ts`
- Notes:
  - `isOrderTransitionAllowed` sekarang hanya menerima status kanonik
  - alias `waiting_payment` tidak lagi menjadi normalizer diam-diam di transition engine
  - compatibility shim tetap tersedia untuk query boundary dan upgrade record legacy yang masih tersisa
  - satu run `test:transaction-assurance` sempat gagal karena `action-matrix` mengalami `fetch failed`; rerun `action-matrix` langsung lulus penuh sehingga gejala diklasifikasikan sebagai transient harness/network issue, bukan regresi logika

### ST-032 WhatsApp Async Notification Outbox Retry
- Result: `PATCHED AND RETESTED`
- Flow:
  - route async transaction notifications through persistent outbox with retry, while keeping OTP/chat interactive sends synchronous
  - rerun notification soft-fail regression and full transaction-assurance on isolated backend
- Evidence:
  - `API_BASE_URL=http://127.0.0.1:5107/api/v1 npm run test:notification-softfail`: `PASS`
  - `API_BASE_URL=http://127.0.0.1:5107/api/v1 npm run test:transaction-assurance`: `PASS`
- Patch applied:
  - `src/models/NotificationOutbox.ts`
  - `src/services/TransactionNotificationOutboxService.ts`
  - `src/controllers/order/customer.ts`
- Notes:
  - channel `whatsapp` sekarang memakai outbox row dan retry worker untuk notifikasi async pasca-commit seperti upload bukti pembayaran
  - OTP dan chat WhatsApp interaktif tetap memakai `sendWhatsappSafe` sinkron agar response bisnis tetap jujur (`409` saat bot belum `READY`)
  - satu run `test:notification-softfail` sempat gagal dengan `fetch failed`; rerun tunggal lulus penuh sehingga gejala diklasifikasikan sebagai transient harness/network issue

### ST-033 Boundary Read Regression Expansion
- Result: `PATCHED AND RETESTED`
- Flow:
  - add runtime regression for public/admin read paths that were still only partially covered
  - verify invalid boundary inputs return stable `200/400/403/404`, not false `500`
- Evidence:
  - runtime command: `API_BASE_URL=http://127.0.0.1:5111/api/v1 npm run test:boundary-read`
  - catalog invalid category: `400`
  - catalog missing product: `404`
  - customer search invalid status fallback: `200`
  - customer detail invalid id: `404`
  - customer orders invalid id: `404`
  - driver wallet finance access: `200`
  - driver wallet customer access: `403`
  - driver orders invalid date fallback: `200`
- Patch applied:
  - `src/scripts/regression_boundary_read.ts`
  - `src/controllers/driver/orders.ts`
- Notes:
  - batch ini menemukan bug nyata: `GET /driver/orders?startDate=not-a-date` sempat jatuh ke `500` karena `Invalid Date` dipakai langsung pada `setHours`
  - controller driver orders sekarang mengabaikan boundary date yang tidak valid dan fallback aman ke query default

### ST-034 Upload Policy Regression Expansion
- Result: `PASS`
- Flow:
  - add runtime regression for upload validation on key multipart paths
  - verify invalid MIME and oversize rejection stay stable `400`
- Evidence:
  - runtime command: `API_BASE_URL=http://127.0.0.1:5111/api/v1 npm run test:upload-policy`
  - order proof invalid mime: `400`
  - order proof oversize: `400`
  - expense attachment invalid mime: `400`
  - product image invalid mime: `400`
  - chat attachment invalid mime: `400`
- Patch applied:
  - `src/scripts/regression_upload_policy.ts`
- Notes:
  - batch ini memperluas coverage upload policy dari dokumentasi/manual evidence menjadi runtime regression yang repeatable

## Access Matrix Summary
- Invoice detail:
  - owner customer: `200`
  - other customer: `403`
  - assigned driver: `200`
  - unrelated driver: `403`
- Order detail:
  - owner customer: `200`
  - other customer: `404`
- Driver retur detail/update:
  - assigned driver: `200`
  - unrelated driver: `404`
- Finance detail endpoints:
  - `admin_finance`, `super_admin`: `200`
  - unauthorized roles: `403`

## Action Matrix Summary
- Finance actions:
  - `issue-invoice`: authorized roles `404` on missing ID, unauthorized roles `403`
  - `verify payment`: authorized roles `404` on missing ID, unauthorized roles `403`
  - `verify driver COD`: authorized roles `400` on invalid payload, unauthorized roles `403`
  - `tax update`: authorized roles `400` on empty payload, unauthorized roles `403`
  - `period close`: authorized roles `400` on invalid payload, unauthorized roles `403`
  - `journal adjustment`: authorized roles `400` on invalid lines, unauthorized roles `403`
- Non-finance actions:
  - customer OTP/create/status/tier, accounts, allocation invalid paths, shipping methods, vouchers, staff, PO, suppliers, products, import preview/path, and stock-opname actions now return business `400/403/404` for valid roles
  - unauthorized roles remain blocked with `403`

## Operational Contract Notes
- COD current contract:
  - invoice COD normal can already be `cod_pending` immediately after invoice issuance
  - `driver recordPayment` is only relevant if a COD invoice is still `unpaid`
  - on normal current flow, `recordPayment` can legitimately return `409` without indicating a crash bug
- Notification side-effect current contract:
  - when WhatsApp client status is not `READY`, the wrapper now degrades gracefully as `skipped_not_ready` instead of calling `waClient.sendMessage`
  - OTP and chat WhatsApp send paths now fail as clean business responses (`409`)
  - async order/payment notification paths remain non-blocking and the main transaction still commits successfully
  - order/retur/COD/admin-badge socket notifications now pass through a persistent outbox worker with retry instead of direct best-effort emit only
- `partially_fulfilled` current contract:
  - status appears after delivery is completed on an order that still has open backorder lines
  - assign driver or ship alone does not move order into `partially_fulfilled`
- Driver issue current contract:
  - issue can only be reported while an order is still actively being delivered
  - invalid-state issue creation must return `409`, not `500`

## Final Patch Backlog

### Patch Now
- kosong
- tidak ada P0 baru yang terbukti terbuka setelah patch dan retest terakhir

### Hardening Next
- perluas automation replay/idempotency ke endpoint side-effect lain di luar baseline transfer verify, COD settlement, retur refund, expense pay, expense-label mutation, adjustment journal, period close, credit note post, invoice void, dan supplier invoice pay
- audit domain admin lain yang memang sengaja belum dimasukkan ke regression matrix bila scope operasional bertambah
- audit controller lain yang masih berpotensi menimpa `CustomError` menjadi `500`
- konsolidasikan upload policy yang tersisa, idempotency coverage, dan legacy status alias sesuai risk ledger

### Ops / SOP Alignment
- briefing tim operasional bahwa COD normal bisa sudah `cod_pending` sejak invoice diterbitkan
- samakan pemahaman status `partially_fulfilled` sebagai pengiriman parsial pasca-delivery, bukan sekadar assign driver
- gunakan vocabulary `settlement` / `pending settlement` secara konsisten di driver dan finance
