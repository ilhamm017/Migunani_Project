# Risk Ledger and Patch Backlog Full System

Dokumen ini mencatat titik rentan yang terlihat dari scan route, middleware, state transition, dan controller kritikal.

## P0 - Segera

| Issue | Observed in module/flow | Operational impact | Severity | Recommended patch | Dependency / prerequisite |
|---|---|---|---|---|---|
| Allocation masih mengizinkan edit pada `partially_fulfilled` dan `debt_pending` | allocation utils/mutation | histori fulfillment bisa berubah setelah pengiriman parsial/COD berjalan | P0 | kunci editable status hanya pada fase sebelum pengiriman/finance; audit semua caller allocation | review bisnis parsial/backorder |
| Kebijakan upload belum seragam | finance expense, retur, beberapa upload multer custom | file abuse, orphan file, validasi MIME/size tidak konsisten | P0 | satukan ke upload policy terpusat dengan MIME whitelist, size, sanitasi filename, error mapping | inventaris semua endpoint multipart |
| Retry/idempotency belum jelas merata di endpoint finansial lain | issue invoice, verify payment, void, retur refund, stock mutation | double-post jurnal/status/uang pada retry jaringan | P0 | perluas idempotency ke semua endpoint side-effect uang/status | tabel `idempotency_keys` aktif |
| Split-brain pasca-commit | upload file + transaksi bisnis + emit event | file, event, dan status bisa tidak sinkron saat kegagalan parsial | P0 | tambahkan cleanup/outbox/reconciliation job untuk artefak non-DB | desain outbox/event retry |
| Legacy status alias masih ada | `waiting_payment` dinormalisasi ke `ready_to_ship` | bug lifecycle tersembunyi, query status bisa salah | P0 | migrasi data dan hentikan alias di layer runtime bertahap | audit DB + frontend status mapping |
| Issue driver dibungkus jadi 500 generik saat error tertentu | `driver/issues.ts` | admin dan driver kehilangan sinyal error bisnis yang benar | P0 | pertahankan `CustomError` pada branch known business failure | refactor error handling lokal |
| Void/finance reversal sangat sensitif terhadap referensi invoice-order | finance payment/void | laporan keuangan bisa salah jika order terkait tidak lengkap | P0 | tambah validasi pre-void, audit trail lengkap, dry-run check sebelum posting reversal | uji jurnal dan referensi invoice |
| Customer banning dapat membatalkan order terbuka secara massal | customer status update | bila salah pakai, order aktif hilang dan stok dilepas | P0 | tambah preview/confirmation path dan audit log spesifik sebelum halt open orders | kebutuhan produk/admin UX |

## P1 - Tinggi

| Issue | Observed in module/flow | Operational impact | Severity | Recommended patch | Dependency / prerequisite |
|---|---|---|---|---|---|
| Finance routes masih memakai multer custom tanpa validasi file type ketat | expense attachments | lampiran non-bisnis bisa lolos | P1 | reuse upload policy khusus dokumen finance dengan MIME whitelist eksplisit | daftar MIME dokumen yang diizinkan |
| Receive PO menyebut manual allocation policy tetapi tetap memanggil auto allocate helper | inventory purchase order receive | operator bisa salah paham soal perilaku restock vs allocation | P1 | luruskan perilaku atau komentar; jika manual penuh, hapus auto helper yang misleading | keputusan bisnis restock |
| Multi-order invoice batch rawan kombinasi status/metode/customer | finance invoice batch | tagihan gabungan salah grouping | P1 | central validator batch invoiceability dengan error detail per order | test fixture invoice batch |
| Tidak semua route upload melaporkan error user-friendly yang sama | order, driver, retur, finance, chat | operator bingung membedakan MIME invalid vs size invalid | P1 | standardize middleware response code/message | util error multipart |
| Event/notifikasi belum dijaga dengan outbox | order, retur, COD, chat badge | UI badge/list bisa terlambat atau hilang saat proses gagal setelah commit | P1 | gunakan outbox table atau retry emitter | desain event delivery |
| Akses via fallback invoice ID/order ID perlu audit ownership menyeluruh | order detail, driver issue/delivery/payment | potensi akses silang bila resolver tidak konsisten | P1 | audit semua `findOrderByIdOrInvoiceId` callsite + tambah integration test ownership | test fixture invoice-order explosion |
| Customer master data menggabungkan operasional dan finansial | customer detail/search/status | perubahan status/tier berdampak luas | P1 | pisahkan audit log dan guard approval pada perubahan tier/status | audit log framework |
| Import-from-path berbahaya bila allowlist longgar | inventory import | baca file lokal yang tidak semestinya | P1 | default disable, validasi allowlist ketat, log path usage | env production policy |

## P2 - Menengah

| Issue | Observed in module/flow | Operational impact | Severity | Recommended patch | Dependency / prerequisite |
|---|---|---|---|---|---|
| Function inventory frontend `PAGE_LIST` tertinggal dari realitas route | dokumentasi frontend | onboarding QA lambat, coverage mudah bolong | P2 | regenerate page inventory otomatis dari `front_end/app` | script doc generation |
| Blind spot realtime socket belum punya matriks delivery guarantee | chat/order badge | issue UI sinkronisasi sulit di-triage | P2 | tambah observability untuk socket event emit/listen | logging dashboard |
| Scenario docs lama masih fokus order customer tunggal | `ORDER_SCENARIO_CUSTOMER1.md` | tim bisa memakai referensi yang terlalu sempit | P2 | tautkan ke docs full-system baru dan tandai dokumen lama sebagai subset | cleanup dokumen |

## Prioritas Eksekusi Patch

1. Konsolidasikan upload policy seluruh endpoint multipart.
2. Lock down allocation editability setelah fase pengiriman/finance.
3. Perluas idempotency ke endpoint finansial dan retur yang rawan retry.
4. Hapus ketergantungan berkepanjangan pada alias status legacy.
5. Tambahkan outbox/reconciliation untuk event dan artefak pasca-commit.
6. Audit resolver fallback invoice/order ownership.
7. Perjelas perilaku restock vs auto-allocation setelah PO receive.

## Regression Focus Setelah Patch

- checkout tidak membuat order ganda
- verify transfer / verify COD / refund / void tidak double-post
- order assigned driver tidak salah tampil `partially_fulfilled`
- upload invalid selalu ditolak dengan alasan yang konsisten
- order/customer ownership tetap tertutup walau pakai fallback invoice ID
- restock PO tidak mengubah shortage queue di luar aturan bisnis yang dipilih
