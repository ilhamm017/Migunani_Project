# Aturan & Guard Alur Order (End-to-End)

Dokumen ini merangkum aturan bisnis (rules) + guard (validasi/kontraint) yang saat ini terimplementasi di backend (dan sebagian tercermin di frontend) untuk alur:
`Order -> Allocation -> Invoice -> Gudang (checking + handover) -> Pengiriman -> Pembayaran/Terminalisasi -> Retur`.

Tujuan:
1) Memudahkan audit aturan yang sudah ada.
2) Menjadi checklist guardrail saat meminta AI/engineer mengubah modul order supaya aturan tidak “hilang”/terlanggar.

> Catatan penting: beberapa aturan bersifat “cross-cutting” (inventory reservation, jurnal akuntansi, idempotency, backorder) dan bisa mempengaruhi hasil walaupun hanya mengubah 1 endpoint.

---

## 1) Terminologi & Entitas Data

Entitas inti:
- **Order**: pesanan customer. Kolom penting: `status`, `customer_id`, `courier_id`, `parent_order_id`, `goods_out_posted_at`.
- **OrderItem**: item per produk di order. Kolom penting: `qty`, `ordered_qty_original`, `qty_canceled_backorder`, `qty_canceled_manual`.
- **OrderAllocation**: alokasi/reservasi qty per `order_id` + `product_id`. Kolom penting: `allocated_qty`, `status` (`pending|picked|shipped`).
- **Backorder**: shortage/pending qty per `order_item_id`. Kolom penting: `qty_pending`, `status` (`waiting_stock|ready|fulfilled|canceled`).
- **Invoice**: dokumen tagihan/pengiriman. Kolom penting: `payment_method`, `payment_status`, `shipment_status`, `courier_id`, timestamps shipped/delivered.
- **InvoiceItem**: qty per `order_item_id` pada invoice.
- **DeliveryHandover** + **DeliveryHandoverItem**: snapshot checking gudang dan bukti (header & per-item).
- **Retur**: tiket retur (customer_request/delivery_refusal/delivery_damage) dengan status flow sendiri.
- **ReturHandover** + item: serah-terima retur ke gudang/kasir.
- **InventoryBatchReservation** / **InventoryBatchConsumption**: jejak reservasi & konsumsi batch inventory (dipakai untuk goods-out/COGS dan picklist).
- **Journals** / **JournalLines**: jurnal akuntansi (immutable: tidak bisa update/destroy; harus reversal).

File referensi cepat:
- Status order & transition map: `back_end/src/utils/orderTransitions.ts`
- Allocation (alokasi/top-up/backorder/cancel shortage): `back_end/src/controllers/allocation/mutation.ts`
- Invoice list/detail/picklist: `back_end/src/controllers/InvoiceController.ts`
- Issue invoice / verify payment / COD settle: `back_end/src/controllers/finance/invoice.ts`, `back_end/src/controllers/finance/payment.ts`, `back_end/src/controllers/finance/cod.ts`
- Gudang checking & handover driver: `back_end/src/controllers/DeliveryHandoverController.ts`
- Driver complete delivery: `back_end/src/controllers/driver/delivery.ts`
- Driver COD payment record: `back_end/src/controllers/driver/payment.ts`
- Retur (customer/admin): `back_end/src/services/ReturService.ts`, `back_end/src/controllers/ReturController.ts`
- Retur handover (gudang/kasir): `back_end/src/controllers/ReturHandoverController.ts`
- Driver retur tasks + serah-terima: `back_end/src/controllers/driver/retur.ts`
- Goods-out posting + shipped allocations: `back_end/src/services/AccountingPostingService.ts`
- Reservasi: `back_end/src/services/InventoryReservationService.ts`
- Terminalisasi (release reservasi): `back_end/src/services/OrderTerminalizationService.ts`

---

## 2) Status Order (State Machine)

Status order yang dipakai di sistem (subset besar):
`pending`, `waiting_invoice`, `ready_to_ship`, `checked`, `shipped`, `delivered`, `completed`,
`partially_fulfilled`, `hold`, `waiting_admin_verification`, `canceled`, `expired` (+ legacy alias).

Legacy alias:
- `waiting_payment` diperlakukan sebagai `ready_to_ship` (untuk query/compat). Lihat: `back_end/src/utils/orderTransitions.ts`.

Transition yang diizinkan (ringkasan dari `ALLOWED_ORDER_TRANSITIONS`):
- `pending` -> `waiting_invoice|waiting_admin_verification|hold|canceled`
- `waiting_invoice` -> `ready_to_ship|waiting_admin_verification|hold|canceled`
- `ready_to_ship` -> `checked|shipped|completed|partially_fulfilled|waiting_admin_verification|hold|canceled`
- `checked` -> `shipped|hold|canceled`
- `shipped` -> `delivered|completed|partially_fulfilled|hold|canceled`
- `delivered` -> `completed|hold|canceled`
- `partially_fulfilled` -> `waiting_invoice|completed|hold|canceled`
- `hold` -> `waiting_invoice|ready_to_ship|waiting_admin_verification|shipped|canceled`
- `waiting_admin_verification` -> `ready_to_ship|completed|hold|canceled`
- `completed` -> `waiting_invoice` (re-open flow untuk backorder top-up/cycle baru)
- `canceled/expired` terminal

Guard umum:
- Hampir semua endpoint yang mengubah status memanggil `isOrderTransitionAllowed(from,to)` dan menolak jika tidak valid.

---

## 3) Status Invoice

Shipment status invoice (yang disupport di query customer invoice list):
- `ready_to_ship`, `checked`, `shipped`, `delivered`, `canceled`  
Lihat filter allowed: `back_end/src/controllers/InvoiceController.ts` (shipmentStatusAllowed).

Payment status invoice (umum):
- `draft`, `unpaid`, `paid`, `cod_pending` (dan flow COD/verify punya aturan khusus).

Poin penting:
- Banyak logika “gating” backorder top-up bergantung pada apakah invoice untuk order tersebut sudah “passed warehouse” (shipment_status shipped/delivered/canceled).
- Beberapa alur multi-invoice membuat order tetap berada di “delivery lane” (`shipped`) sampai semua invoice selesai.

---

## 4) Alur Normal (Happy Path)

Ringkasan alur tipikal:
1) Customer checkout -> order `pending`.
2) Admin alokasi barang -> status order naik ke `waiting_invoice` (alokasi tersimpan di `order_allocations` + update stok/reservasi).
3) Kasir issue invoice -> order `ready_to_ship` (invoice dibuat dari qty yang dialokasikan; invoice items disimpan).
4) Gudang checking invoice -> order jadi `checked` (atau `hold` bila fail/mismatch).
5) Gudang handover -> invoice `shipped`, order `shipped`, goods-out diposting (COGS + shipped allocations).
6) Driver delivery selesai -> invoice `delivered`; order jadi `delivered/completed/partially_fulfilled` tergantung backorder & pembayaran.
7) Pembayaran:
   - Non-COD: finance verify bisa menutup order tertentu.
   - COD: driver record payment / finance verify driver COD.
8) Jika semua selesai & tidak ada backorder: order `completed` + reservasi dirilis.

---

## 5) Aturan Alokasi (Allocation) & Backorder

Endpoint utama:
- `POST /allocation/:id` -> `allocateOrder` (`back_end/src/controllers/allocation/mutation.ts`).

Aturan utama:
1) **Editable/reallocatable order status**:
   - Editable: `pending|waiting_invoice|allocated|hold|partially_fulfilled` (lihat `back_end/src/controllers/allocation/utils.ts`).
   - Ada pengecualian: top-up backorder boleh pada kondisi tertentu walau status `ready_to_ship|shipped|completed` jika ada backorder aktif (lihat guard di `allocation/mutation.ts`).

2) **Qty allocation tidak boleh melebihi demand order**:
   - Demand dihitung dari `ordered_qty_original` (fallback `qty`) dikurangi `qty_canceled_backorder` dan `qty_canceled_manual`.
   - Request allocation per produk harus `<= orderedQty(demand)` (validasi awal).

3) **Stock check + update stok**:
   - Ketika qty allocation dinaikkan, sistem mengurangi `products.stock_quantity` dan menambah `products.allocated_quantity`.
   - Ketika qty allocation diturunkan, sistem mengembalikan `stock_quantity` dan mengurangi `allocated_quantity`.

4) **Allocation bertipe “cumulative per product”, tapi backorder dihitung per item**:
   - `order_allocations` tersimpan per `order_id + product_id`.
   - Untuk menghitung shortage per order_item, sistem mendistribusikan allocation product-level ke item rows (FIFO by id) dan menghitung `shortage_qty`.

5) **Backorder record sinkron dengan shortage**:
   - Untuk setiap `OrderItem`, sistem `findOrCreate` `Backorder` dan update:
     - jika shortage > 0: `qty_pending=shortage`, status `waiting_stock`
     - jika shortage <= 0: `qty_pending=0`, status `fulfilled` (kecuali sudah `canceled`)
   - Event `backorder_opened/backorder_reallocated` dicatat saat shortage berubah.

6) **Backorder fill lock berbasis invoice yang belum lewat gudang**:
   - Jika order punya backorder aktif, dan ada invoice order itu yang belum “passed warehouse” (shipment_status bukan shipped/delivered/canceled),
     maka top-up backorder ditolak jika invoice tertua sudah lebih dari 24 jam (ada grace window 24 jam).
   - Tujuan: mencegah “top-up alokasi” sambil invoice lama masih menggantung sebelum gudang/driver.

7) **(Guard baru) shipped allocations tidak boleh “di-unallocate”**:
   - Jika suatu produk sudah memiliki qty `OrderAllocation.status='shipped'`, request alokasi total untuk produk tsb tidak boleh < shipped qty.
   - Update stok/reservasi hanya berlaku untuk “open allocations” (`pending|picked`).
   - Jika semua allocation yang ada sudah shipped dan perlu top-up, sistem membuat row allocation baru status `pending`.
   - Implementasi: `back_end/src/controllers/allocation/mutation.ts` bagian update per-product.

---

## 6) Aturan Issue Invoice (Kasir)

Endpoint:
- `POST /finance/orders/:id/issue-invoice` & batch/items (lihat `back_end/src/controllers/finance/invoice.ts`).

Aturan utama:
1) Role: hanya `kasir` / `super_admin`.
2) Order harus `waiting_invoice`.
3) Semua order dalam combined invoice harus satu customer.
4) Invoice item qty didasarkan pada alokasi yang ada (dan “remaining” terhadap invoice-item historis).
5) Metode pembayaran combined invoice diselaraskan (order-level payment_method bisa di-sync).
6) Idempotency untuk mencegah issue invoice duplikat pada batch/items.

---

## 7) Aturan Gudang: Checking & Handover

### 7.1 Checking Invoice (Checker Gudang)
Endpoint:
- `POST /delivery-handover/check` (`back_end/src/controllers/DeliveryHandoverController.ts`).

Aturan:
1) Invoice tidak boleh sudah `shipped/delivered/canceled`.
2) `checked` tidak boleh diulang.
3) Sistem membentuk snapshot expected qty dari `InvoiceItem` (per product) dan membandingkan dengan input (atau auto-fill).
4) Jika mismatch atau dipaksa fail:
   - order(s) dapat berpindah ke `hold` (dan record event).
5) Jika pass:
   - order status biasanya -> `checked`, kecuali order sudah dalam lane pengiriman (misal sudah `shipped/delivered/...`) maka tidak ditarik mundur.
6) Allocation `pending` pada order(s) diubah menjadi `picked`.
7) Invoice diubah menjadi `shipment_status='checked'`.

### 7.2 Handover ke Driver
Endpoint:
- `POST /delivery-handover/:id/handover`.

Aturan:
1) Invoice harus dalam status yang valid untuk handover (umumnya `checked`).
2) Order status berubah ke `shipped` (dengan guard transition).
3) Goods-out diposting via `AccountingPostingService.postGoodsOutForOrder` untuk setiap order terkait invoice:
   - Mengubah `OrderAllocation` open (`pending|picked`) menjadi `shipped`.
   - Mengurangi `products.allocated_quantity` sesuai shipped qty.
   - Menandai `orders.goods_out_posted_at/by` (idempotent: kalau sudah ada, skip).
4) Invoice `shipment_status='shipped'`, `shipped_at` terisi, `courier_id` diset.

---

## 8) Aturan Driver: Complete Delivery & Pembayaran COD

### 8.1 Complete Delivery (Proof Delivery)
Endpoint:
- `POST /driver/orders/:id/complete` dan batch (`back_end/src/controllers/driver/delivery.ts`).

Aturan:
1) Invoice harus ditugaskan ke driver; invoice yang sudah delivered tidak bisa diproses ulang.
2) Untuk COD unpaid, driver wajib catat pembayaran sebelum complete delivery (kecuali invoice net total 0 / full return).
3) Bukti foto delivery wajib diupload kecuali kasus full return.
4) Next status order saat invoice delivered:
   - default: `delivered` atau `completed` (tergantung metode/status pembayaran)
   - jika masih ada backorder terbuka (`Backorder.qty_pending>0` dan status bukan fulfilled/canceled): order jadi `partially_fulfilled`
   - jika masih ada invoice lain yang belum terminal (multi-invoice): order dipertahankan `shipped` (tidak diterminalisasi dulu).
5) COD flow: saat complete delivery COD, sistem bisa melakukan goods-out posting jika belum (idempotent).
6) Release reservasi hanya saat benar-benar `completed` dan tidak ada invoice lain yang masih open.

### 8.2 Driver Record Payment (COD)
Endpoint:
- `POST /driver/orders/:id/payment` dan batch (`back_end/src/controllers/driver/payment.ts`).

Aturan:
1) Idempotency key untuk mencegah double post pembayaran.
2) Hanya invoice COD yang `unpaid/draft` yang diproses; jika sudah `cod_pending`, dianggap sudah pernah dicatat.
3) Setelah pembayaran tercatat, invoice menjadi `cod_pending` (atau `paid` tergantung flow) dan order `delivered` bisa ditutup menjadi `completed` (dengan guard & release reservasi).

---

## 9) Aturan Finance: Verify Payment

Endpoint:
- `PATCH /finance/orders/:id/verify` (`back_end/src/controllers/finance/payment.ts`).

Aturan:
1) Role: `admin_finance` / `super_admin`.
2) Action: approve/reject.
3) Approve:
   - Jika order status `waiting_admin_verification` -> kembali ke `ready_to_ship` (finance tidak boleh melompati flow gudang).
   - Jika order status `delivered` dan tidak ada backorder terbuka -> bisa menjadi `completed` + release reservasi.
4) Reject:
   - Order bisa di-hold untuk mencegah masuk gudang.

---

## 10) Aturan Retur

### 10.1 Customer Request Retur
Entry point:
- `POST /retur/request` -> `ReturService.requestRetur` (`back_end/src/services/ReturService.ts`).

Aturan:
1) Order harus milik customer dan berstatus `delivered|completed`.
2) Retur untuk produk yang sama tidak boleh duplikat (selama status bukan `rejected`).
3) Qty retur <= qty yang dibeli (sum `OrderItem.qty` untuk product tersebut).
4) Retur dibuat status awal `pending`, dan event status retur diemits.
5) Invoice untuk retur dipilih lewat `ensureSingleInvoiceOrRequireInvoiceId` (wajib jelas untuk order multi-invoice).

### 10.2 Admin Update Retur Status
Entry point:
- `PUT /retur/:id/status` -> `ReturService.updateReturStatus`.

Aturan transisi (ringkas):
- `pending` -> `approved|rejected`
- `approved` -> `pickup_assigned` (wajib `courier_id` driver)
- `picked_up` (driver) -> `handed_to_warehouse`
- `handed_to_warehouse` -> `received` (gudang/kasir) (untuk delivery retur, `qty_received` wajib valid)
- `received` -> `completed` (opsional restock via `is_back_to_stock`)

### 10.3 Retur Handover (Driver -> Gudang/Kasir)
- Driver bisa membuat tiket serah-terima retur per invoice (`back_end/src/controllers/driver/retur.ts`).
- Gudang/kasir menerima handover (`back_end/src/controllers/ReturHandoverController.ts`):
  - Handover hanya sekali (`status` harus `submitted`).
  - Jika retur masih `picked_up` (legacy), otomatis dipindah dulu ke `handed_to_warehouse`.
  - Lalu sistem menjalankan `handed_to_warehouse -> received -> completed` untuk tiap retur dan bisa restock.
  - Setelah handover diterima, driver COD exposure/debt dihitung ulang.

---

## 11) Inventory Reservation & Goods-Out (Cross-cutting)

1) Sebelum handover/goods-out, sistem sering memanggil `InventoryReservationService.syncReservationsForOrder` untuk memastikan reservation rows exist.
2) Goods-out posting (`AccountingPostingService.postGoodsOutForOrder`):
   - idempotent: jika `orders.goods_out_posted_at` sudah ada, tidak mempost ulang.
   - memutakhirkan `OrderAllocation` open menjadi shipped dan mengurangi `products.allocated_quantity`.
3) Terminalisasi (`OrderTerminalizationService.releaseReservationsForOrders`) dipanggil saat order benar-benar selesai dan tidak butuh reservation lagi.

Jurnal:
- `journals` immutable (tidak bisa update/delete). Jika perlu koreksi, buat reversal entry (lihat hook di model `back_end/src/models/Journal.ts`).

---

## 12) Checklist Guardrail untuk Perubahan Kode (khusus AI / refactor)

Jika mengubah salah satu modul di bawah, pastikan aturan ini tetap benar:
1) **Status machine**: jangan ubah allowed transitions tanpa audit seluruh endpoint yang memanggilnya (`isOrderTransitionAllowed`).
2) **Shipped allocation invariant**: qty shipped tidak boleh bisa “ditarik mundur” oleh endpoint alokasi.
3) **Backorder = shortage**: `Backorder.qty_pending` harus selalu sinkron dengan shortage hasil distribusi allocation (bukan dari invoice).
4) **Invoice & gudang gating**: top-up backorder harus tetap mempertimbangkan invoice yang belum lewat gudang (grace window).
5) **Goods-out idempotent**: `postGoodsOutForOrder` tidak boleh double-post (jurnal & inventory).
6) **Multi-invoice**: penyelesaian driver tidak boleh menutup order jika masih ada invoice lain yang open.
7) **COD rules**: complete delivery COD unpaid harus blocked; pembayaran COD harus idempotent.
8) **Retur constraints**: customer hanya bisa retur pada `delivered|completed`; qty <= purchased; transisi status retur sesuai flow.
9) **Akuntansi**: jurnal tidak boleh dihapus/update; semua koreksi via reversal/adjustment.
10) **Eventing**: perubahan status penting harus record `order_events`/`order_status_changed` + emit socket refresh badges bila relevan.

Saran praktik saat refactor:
- Setiap perubahan yang menyentuh `allocation/mutation.ts`, `AccountingPostingService`, `DeliveryHandoverController`, atau driver delivery/payment:
  - jalankan regression scripts yang relevan di `back_end/src/scripts/` (mis. `reconcile_shipped_allocations.ts`, `regression_driver_orders_multi_invoice.ts` bila ada).

