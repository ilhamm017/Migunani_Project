# Full System Scenario Matrix

Dokumen ini menyusun skenario uji lapangan berdasarkan implementasi backend dan halaman frontend aktif saat ini.
Semua skenario memakai format yang sama:
- `Scenario ID`
- `Module`
- `Actor`
- `Precondition`
- `Trigger / Step-by-step`
- `Expected API / UI result`
- `Expected DB/status side effect`
- `Negative path / edge case`
- `Risk if failed`
- `Priority`

## 1. Customer

### SCN-CUST-001
- Module: Auth & Access
- Actor: Customer
- Precondition: akun customer belum terdaftar.
- Trigger / Step-by-step: register dari `/auth/register`, lalu login dari `/auth/login`.
- Expected API / UI result: registrasi sukses, login mengembalikan token valid, halaman customer terbuka.
- Expected DB/status side effect: user baru role `customer` terbentuk dengan status aktif.
- Negative path / edge case: email/nomor ganda, payload kurang lengkap.
- Risk if failed: customer gagal onboarding.
- Priority: P1

### SCN-CUST-002
- Module: Catalog / Cart
- Actor: Customer
- Precondition: produk aktif tersedia.
- Trigger / Step-by-step: browse `/catalog`, buka detail `/catalog/[id]`, tambah ke cart, ubah qty, hapus item.
- Expected API / UI result: data katalog dan cart sinkron, qty tidak negatif, stok habis menahan pembelian.
- Expected DB/status side effect: `Cart` dan `CartItem` berubah sesuai aksi.
- Negative path / edge case: add-to-cart saat token expired, qty 0/negatif, produk tidak ada.
- Risk if failed: order quantity salah sejak awal.
- Priority: P1

### SCN-CUST-003
- Module: Checkout transfer manual
- Actor: Customer
- Precondition: cart terisi, alamat ada, shipping method aktif.
- Trigger / Step-by-step: checkout dengan `payment_method=transfer_manual`, sumber `web`, tanpa promo.
- Expected API / UI result: order baru terbentuk dan muncul di `/orders`.
- Expected DB/status side effect: order `pending`, `stock_released=false`, invoice belum ada sampai proses kasir.
- Negative path / edge case: cart kosong, shipping method invalid.
- Risk if failed: transaksi awal gagal atau order terbentuk tidak valid.
- Priority: P0

### SCN-CUST-004
- Module: Checkout COD
- Actor: Customer
- Precondition: produk checkout valid.
- Trigger / Step-by-step: checkout dengan `payment_method=cod`.
- Expected API / UI result: order baru terbentuk, detail metode bayar COD tampil.
- Expected DB/status side effect: order `pending`.
- Negative path / edge case: COD dipilih untuk alamat/jenis kirim yang tidak sesuai aturan operasional.
- Risk if failed: order COD tak bisa diproses di driver/finance.
- Priority: P0

### SCN-CUST-005
- Module: Promo validation
- Actor: Customer
- Precondition: tersedia voucher aktif terikat produk tertentu.
- Trigger / Step-by-step: checkout memakai promo valid.
- Expected API / UI result: total diskon benar dan order berhasil.
- Expected DB/status side effect: usage counter voucher bertambah satu kali.
- Negative path / edge case: promo invalid, expired, belum aktif, kuota habis, produk tidak eligible.
- Risk if failed: over-discount atau customer merasa promo “hilang”.
- Priority: P0

### SCN-CUST-006
- Module: Retry / Idempotency checkout
- Actor: Customer
- Precondition: request checkout dapat dikirim ulang dengan `Idempotency-Key` sama.
- Trigger / Step-by-step: kirim dua POST checkout identik hampir bersamaan.
- Expected API / UI result: request kedua replay atau conflict, bukan membuat order ganda.
- Expected DB/status side effect: hanya satu order baru tercipta.
- Negative path / edge case: key sama tapi payload beda, key kosong.
- Risk if failed: order dobel, tagihan dobel, stok/alokasi rusak.
- Priority: P0

### SCN-CUST-007
- Module: Customer blocked
- Actor: Customer
- Precondition: user pernah login, lalu status diubah jadi `banned`.
- Trigger / Step-by-step: coba checkout ulang atau buka endpoint protected.
- Expected API / UI result: ditolak 403.
- Expected DB/status side effect: tidak ada order baru; order terbuka dapat dibatalkan saat proses blokir customer.
- Negative path / edge case: token lama masih dipakai.
- Risk if failed: akun banned masih bisa transaksi.
- Priority: P0

### SCN-CUST-008
- Module: Upload payment proof
- Actor: Customer
- Precondition: order memiliki invoice transfer yang belum paid dan belum punya proof.
- Trigger / Step-by-step: upload bukti via `/orders/[id]/upload-proof`.
- Expected API / UI result: upload sukses dan status order/invoice menunggu verifikasi admin.
- Expected DB/status side effect: invoice menyimpan `payment_proof_url`, order menuju `waiting_admin_verification`.
- Negative path / edge case: file kosong, MIME salah, file > 5MB, proof diunggah dua kali, invoice sudah paid.
- Risk if failed: finance verifikasi data salah atau file abuse.
- Priority: P0

### SCN-CUST-009
- Module: My orders / order detail
- Actor: Customer
- Precondition: customer punya order campuran status.
- Trigger / Step-by-step: buka `/orders`, filter status, buka `/orders/[id]`.
- Expected API / UI result: label status sesuai, `shipped_qty` dan `indent_qty` masuk akal, timeline tampil.
- Expected DB/status side effect: read-only.
- Negative path / edge case: akses order milik customer lain, pakai invoice ID sebagai fallback detail.
- Risk if failed: customer melihat data orang lain atau salah membaca status.
- Priority: P0

### SCN-CUST-010
- Module: Customer retur
- Actor: Customer
- Precondition: order/item eligible retur.
- Trigger / Step-by-step: ajukan retur dengan alasan dan evidence.
- Expected API / UI result: retur baru tercatat dan muncul di `/retur`.
- Expected DB/status side effect: record retur `pending`.
- Negative path / edge case: qty retur melebihi pembelian, order tidak eligible, evidence tidak ada/invalid.
- Risk if failed: retur fraud atau customer tak bisa klaim barang rusak.
- Priority: P0

## 2. Kasir

### SCN-KAS-001
- Module: Allocation penuh
- Actor: Kasir
- Precondition: order `pending`, stok cukup.
- Trigger / Step-by-step: buka allocation pending, alokasikan semua item.
- Expected API / UI result: alokasi sukses, order maju ke tahap invoiceable.
- Expected DB/status side effect: `OrderAllocation` terbentuk, stok produk turun, `allocated_quantity` naik, order menuju `waiting_invoice`.
- Negative path / edge case: qty alokasi melebihi qty order atau stok.
- Risk if failed: invoice diterbitkan tanpa stok nyata.
- Priority: P0

### SCN-KAS-002
- Module: Allocation parsial / backorder
- Actor: Kasir
- Precondition: order `pending`, stok hanya cukup sebagian.
- Trigger / Step-by-step: alokasikan qty sebagian.
- Expected API / UI result: shortage summary terlihat jelas.
- Expected DB/status side effect: backorder terbuka untuk sisa qty, status tetap dapat lanjut parsial.
- Negative path / edge case: produk sebagian dialokasi di beberapa row item order.
- Risk if failed: status parsial salah atau shortage tidak terlacak.
- Priority: P0

### SCN-KAS-003
- Module: Cancel backorder
- Actor: Kasir
- Precondition: order memiliki backorder aktif.
- Trigger / Step-by-step: lakukan `cancel-backorder`.
- Expected API / UI result: qty order berkurang tanpa cancel seluruh order.
- Expected DB/status side effect: `qty_canceled_backorder` bertambah, total order berubah, sisa invoiceable sinkron.
- Negative path / edge case: cancel melebihi open backorder, order sudah terminal.
- Risk if failed: total order rusak atau histori fulfillment tidak konsisten.
- Priority: P0

### SCN-KAS-004
- Module: Issue invoice per order
- Actor: Kasir
- Precondition: order `waiting_invoice`, punya qty invoiceable.
- Trigger / Step-by-step: issue invoice dari satu order.
- Expected API / UI result: invoice number terbentuk, order siap kirim.
- Expected DB/status side effect: invoice + invoice items tercatat, order `ready_to_ship`, payment status tergantung metode bayar.
- Negative path / edge case: order belum dialokasi, order campur item non-invoiceable.
- Risk if failed: pengiriman berjalan tanpa tagihan sah.
- Priority: P0

### SCN-KAS-005
- Module: Issue invoice batch multi-order
- Actor: Kasir
- Precondition: beberapa order milik customer sama dan payment method sama.
- Trigger / Step-by-step: issue batch invoice.
- Expected API / UI result: satu invoice mencakup beberapa order yang valid.
- Expected DB/status side effect: relasi invoice ke order-item/order konsisten.
- Negative path / edge case: customer berbeda, metode bayar beda, status order campuran.
- Risk if failed: tagihan salah customer atau pembayaran tidak bisa direkonsiliasi.
- Priority: P0

### SCN-KAS-006
- Module: Issue invoice by items
- Actor: Kasir
- Precondition: order parsial dengan item tertentu siap ditagihkan.
- Trigger / Step-by-step: pilih item tertentu dan issue invoice parsial.
- Expected API / UI result: invoice hanya berisi qty/item yang invoiceable.
- Expected DB/status side effect: `InvoiceItem.qty` sinkron dengan item_summaries order.
- Negative path / edge case: qty invoice melebihi qty allocated atau sudah pernah di-invoice.
- Risk if failed: double billing.
- Priority: P0

### SCN-KAS-007
- Module: Customer admin create + OTP
- Actor: Kasir
- Precondition: data customer baru tersedia.
- Trigger / Step-by-step: kirim OTP lalu create customer dari admin sales.
- Expected API / UI result: customer baru terbentuk dan dapat dipakai untuk order admin-created.
- Expected DB/status side effect: user customer + profile tersimpan.
- Negative path / edge case: nomor/email duplikat, OTP flow gagal.
- Risk if failed: onboarding offline customer terhambat.
- Priority: P1

## 3. Admin Gudang

### SCN-GDG-001
- Module: Assign courier + ship
- Actor: Admin Gudang
- Precondition: order `ready_to_ship`, courier aktif tersedia.
- Trigger / Step-by-step: assign driver lalu ubah status ke `shipped`.
- Expected API / UI result: order masuk daftar tugas driver.
- Expected DB/status side effect: `courier_id` terisi, order `shipped`.
- Negative path / edge case: status bukan `ready_to_ship`, courier tidak ada/tidak aktif, follow-up hold tidak diisi saat kirim ulang dari `hold`.
- Risk if failed: driver dapat order yang belum siap atau order tak punya owner.
- Priority: P0

### SCN-GDG-002
- Module: Hold order operasional
- Actor: Admin Gudang
- Precondition: order aktif punya masalah.
- Trigger / Step-by-step: ubah status ke `hold` dengan `issue_type` dan note.
- Expected API / UI result: order muncul di daftar issue.
- Expected DB/status side effect: issue terbuka tercatat, event status terpancar.
- Negative path / edge case: hold tanpa alasan yang valid.
- Risk if failed: kasus lapangan tidak tereskalasi.
- Priority: P0

### SCN-GDG-003
- Module: Re-ship from hold
- Actor: Admin Gudang
- Precondition: order `hold` sudah ditindaklanjuti.
- Trigger / Step-by-step: kirim ulang ke `shipped`.
- Expected API / UI result: sistem mewajibkan resolution note/follow-up.
- Expected DB/status side effect: order kembali `shipped`, histori issue tetap ada.
- Negative path / edge case: follow-up note kosong.
- Risk if failed: order hold hilang konteks investigasinya.
- Priority: P0

### SCN-GDG-004
- Module: Cancel order terbuka
- Actor: Admin Gudang / Kasir / Super Admin
- Precondition: order belum terminal.
- Trigger / Step-by-step: cancel order dari admin.
- Expected API / UI result: status jadi `canceled`.
- Expected DB/status side effect: stok alokasi dilepas bila `stock_released=false`, order tidak lagi invoiceable/shippable.
- Negative path / edge case: cancel saat sudah delivered/completed.
- Risk if failed: stok terkunci atau order terminal dibuka secara ilegal.
- Priority: P0

### SCN-GDG-005
- Module: Warehouse list consistency
- Actor: Admin Gudang
- Precondition: order baru assign driver tetapi driver belum beraksi.
- Trigger / Step-by-step: buka `/admin/warehouse/pesanan` dan `/orders` customer.
- Expected API / UI result: order yang baru diassign belum tampil `partially_fulfilled`.
- Expected DB/status side effect: status tetap `shipped` atau `ready_to_ship` sesuai aksi terakhir, bukan parsial.
- Negative path / edge case: ada backorder aktif tetapi delivery belum dilakukan.
- Risk if failed: customer dan gudang membaca progres palsu.
- Priority: P0

### SCN-GDG-006
- Module: Driver issue handling
- Actor: Admin Gudang
- Precondition: driver sudah melaporkan issue shortage.
- Trigger / Step-by-step: buka daftar issue, telaah order terkait.
- Expected API / UI result: order berada di `hold`, issue terbuka terlihat.
- Expected DB/status side effect: `courier_id` sudah null, butuh reassign bila mau dikirim ulang.
- Negative path / edge case: issue dilaporkan saat order bukan `ready_to_ship`/`shipped`.
- Risk if failed: order bermasalah tetap lanjut terkirim.
- Priority: P0

## 4. Driver

### SCN-DRV-001
- Module: Assigned order visibility
- Actor: Driver
- Precondition: order sudah `shipped` dan `courier_id` mengarah ke driver.
- Trigger / Step-by-step: buka `/driver`, `/driver/precheck`.
- Expected API / UI result: order tampil hanya untuk driver pemilik.
- Expected DB/status side effect: read-only.
- Negative path / edge case: driver lain mencoba akses order by ID.
- Risk if failed: data delivery bocor lintas driver.
- Priority: P0

### SCN-DRV-002
- Module: Complete delivery transfer paid
- Actor: Driver
- Precondition: order `shipped`, invoice transfer sudah `paid`.
- Trigger / Step-by-step: upload proof delivery lalu complete.
- Expected API / UI result: delivery sukses, customer melihat selesai.
- Expected DB/status side effect: order `completed`, invoice `shipment_status=delivered`.
- Negative path / edge case: bukti pengiriman tidak ada.
- Risk if failed: order paid tetap menggantung.
- Priority: P0

### SCN-DRV-003
- Module: Complete delivery transfer unpaid
- Actor: Driver
- Precondition: order `shipped`, invoice transfer masih `unpaid`.
- Trigger / Step-by-step: complete delivery.
- Expected API / UI result: ditandai terkirim namun belum selesai.
- Expected DB/status side effect: order `delivered`.
- Negative path / edge case: finance approve datang setelah status `delivered`.
- Risk if failed: order dianggap lunas padahal belum ada pembayaran.
- Priority: P0

### SCN-DRV-004
- Module: Complete delivery dengan backorder aktif
- Actor: Driver
- Precondition: order `shipped`, masih ada backorder `qty_pending > 0`.
- Trigger / Step-by-step: complete delivery.
- Expected API / UI result: order tampil `partially_fulfilled`.
- Expected DB/status side effect: order `partially_fulfilled`, event notifikasi ke customer/kasir/gudang/finance.
- Negative path / edge case: order tidak boleh parsial sebelum complete delivery benar-benar dipost.
- Risk if failed: status parsial prematur atau backorder tak terlacak.
- Priority: P0

### SCN-DRV-005
- Module: Record COD before complete
- Actor: Driver
- Precondition: order COD `shipped`.
- Trigger / Step-by-step: record payment COD lebih dulu, lalu complete delivery.
- Expected API / UI result: kedua urutan diterima.
- Expected DB/status side effect: invoice `cod_pending`, debt driver bertambah, order akhirnya `completed` atau `partially_fulfilled`.
- Negative path / edge case: idempotency key sama dipakai retry.
- Risk if failed: debt/collection dobel.
- Priority: P0

### SCN-DRV-006
- Module: Complete delivery before record COD
- Actor: Driver
- Precondition: order COD `shipped`.
- Trigger / Step-by-step: complete delivery dulu, lalu record payment.
- Expected API / UI result: urutan terbalik tetap konsisten.
- Expected DB/status side effect: invoice tetap bisa masuk `cod_pending`, order tidak jadi status liar.
- Negative path / edge case: order sudah `completed` saat payment diinput ulang.
- Risk if failed: COD tak bisa direkonsiliasi.
- Priority: P0

### SCN-DRV-007
- Module: Change payment method in field
- Actor: Driver
- Precondition: order milik driver sendiri dan masih dalam status yang diizinkan.
- Trigger / Step-by-step: ubah payment method dari halaman driver.
- Expected API / UI result: hanya owner yang diizinkan; role lain ditolak.
- Expected DB/status side effect: invoice/order method berubah konsisten bila rule mengizinkan.
- Negative path / edge case: driver non-owner mencoba akses, order sudah terminal.
- Risk if failed: manipulasi metode bayar.
- Priority: P0

### SCN-DRV-008
- Module: Report issue shortage
- Actor: Driver
- Precondition: order `ready_to_ship` atau `shipped`.
- Trigger / Step-by-step: kirim note issue, checklist snapshot, evidence.
- Expected API / UI result: laporan diterima dan admin gudang ter-notify.
- Expected DB/status side effect: issue `open`, due date +24h, order `hold`, `courier_id=null`.
- Negative path / edge case: note < 5 char, status order tidak valid, issue duplicate update.
- Risk if failed: shortage lapangan tidak tertangkap.
- Priority: P0

## 5. Admin Finance

### SCN-FIN-001
- Module: Approve transfer sebelum ship
- Actor: Admin Finance
- Precondition: invoice transfer punya proof, order belum dikirim.
- Trigger / Step-by-step: approve bukti transfer.
- Expected API / UI result: verifikasi sukses dan order siap dikirim.
- Expected DB/status side effect: invoice `paid`, jurnal pembayaran tercatat, order `ready_to_ship`.
- Negative path / edge case: proof belum ada, invoice sudah paid.
- Risk if failed: barang terkirim tanpa pembayaran tervalidasi.
- Priority: P0

### SCN-FIN-002
- Module: Approve transfer setelah delivered
- Actor: Admin Finance
- Precondition: order transfer sudah `delivered`, invoice punya proof.
- Trigger / Step-by-step: approve verifikasi.
- Expected API / UI result: order selesai.
- Expected DB/status side effect: order `completed`, invoice `paid`, jurnal payment verify masuk.
- Negative path / edge case: current status illegal untuk completion.
- Risk if failed: order selesai tidak pernah menutup.
- Priority: P0

### SCN-FIN-003
- Module: Reject transfer
- Actor: Admin Finance
- Precondition: proof sudah diunggah.
- Trigger / Step-by-step: reject verifikasi.
- Expected API / UI result: customer diminta tindak lanjut.
- Expected DB/status side effect: proof dibersihkan, invoice kembali `unpaid`, order `hold` jika belum shipped/delivered.
- Negative path / edge case: order sudah shipped/delivered/completed.
- Risk if failed: order tetap lanjut walau pembayaran invalid.
- Priority: P0

### SCN-FIN-004
- Module: Void paid invoice
- Actor: Admin Finance
- Precondition: invoice `paid`.
- Trigger / Step-by-step: lakukan void.
- Expected API / UI result: void berhasil dengan reversal jurnal.
- Expected DB/status side effect: jurnal reversal tercatat, state invoice/order mengikuti rule void yang berlaku.
- Negative path / edge case: invoice bukan `paid`, order terkait tidak ditemukan.
- Risk if failed: laporan keuangan salah.
- Priority: P0

### SCN-FIN-005
- Module: Verify driver COD selected orders
- Actor: Admin Finance
- Precondition: driver punya debt / cod_pending invoice.
- Trigger / Step-by-step: pilih driver, pilih order, input amount received, verify.
- Expected API / UI result: settlement berhasil.
- Expected DB/status side effect: collection/settlement tercatat, debt driver berkurang, invoice `paid`, order `completed` bila eligible.
- Negative path / edge case: order bukan milik driver, amount invalid, selected orders kosong.
- Risk if failed: uang COD tidak balance.
- Priority: P0

### SCN-FIN-006
- Module: Retry verify driver COD
- Actor: Admin Finance
- Precondition: request dikirim dua kali dengan `Idempotency-Key` sama.
- Trigger / Step-by-step: resend verify COD.
- Expected API / UI result: replay/conflict tanpa double-post.
- Expected DB/status side effect: settlement satu kali, jurnal satu kali.
- Negative path / edge case: payload berbeda dengan key sama.
- Risk if failed: debt dan jurnal dobel.
- Priority: P0

### SCN-FIN-007
- Module: Accounts receivable read
- Actor: Admin Finance
- Precondition: ada invoice unpaid dan paid.
- Trigger / Step-by-step: buka daftar AR dan detail invoice.
- Expected API / UI result: data piutang benar, filter bekerja.
- Expected DB/status side effect: read-only.
- Negative path / edge case: invoice ID invalid.
- Risk if failed: keputusan penagihan salah.
- Priority: P1

### SCN-FIN-008
- Module: Refund disbursement
- Actor: Admin Finance
- Precondition: retur sudah mencapai status refundable.
- Trigger / Step-by-step: disburse refund dengan note.
- Expected API / UI result: pencairan sukses.
- Expected DB/status side effect: retur update status, expense/refund entry tercatat.
- Negative path / edge case: role salah, retur tidak ditemukan/tidak eligible.
- Risk if failed: refund customer tidak tercatat atau tercatat dua kali.
- Priority: P0

## 6. Super Admin / Master Data

### SCN-SADM-001
- Module: Customer status change with halt open orders
- Actor: Super Admin / Kasir
- Precondition: customer punya order terbuka.
- Trigger / Step-by-step: ubah status customer ke `banned`.
- Expected API / UI result: customer terblokir.
- Expected DB/status side effect: order terbuka dibatalkan, alokasi stok dilepas bila perlu, daftar halted orders kembali.
- Negative path / edge case: `halt_open_orders=false`.
- Risk if failed: customer bermasalah tetap punya order aktif.
- Priority: P0

### SCN-SADM-002
- Module: Staff CRUD
- Actor: Super Admin
- Precondition: akun staff target ada/tidak ada.
- Trigger / Step-by-step: create, update, deactivate staff.
- Expected API / UI result: data staff berubah sesuai aksi.
- Expected DB/status side effect: user staff aktif/nonaktif.
- Negative path / edge case: role invalid, deactivate user yang masih dipakai aktif di operasi.
- Risk if failed: akses tidak terkontrol.
- Priority: P1

### SCN-SADM-003
- Module: Shipping method / voucher master
- Actor: Super Admin / Kasir
- Precondition: data master tersedia.
- Trigger / Step-by-step: create, update, delete shipping method dan voucher.
- Expected API / UI result: master data berubah dan dipakai checkout berikutnya.
- Expected DB/status side effect: setting/master tersimpan.
- Negative path / edge case: hapus master yang sedang dipakai order aktif.
- Risk if failed: checkout dan invoice salah hitung.
- Priority: P1

### SCN-SADM-004
- Module: Chart of accounts
- Actor: Super Admin / Admin Finance
- Precondition: kebutuhan akun baru/perubahan akun ada.
- Trigger / Step-by-step: create/update/delete account.
- Expected API / UI result: akun tersedia untuk posting jurnal.
- Expected DB/status side effect: account master berubah.
- Negative path / edge case: hapus account yang masih direferensikan transaksi.
- Risk if failed: posting finance putus.
- Priority: P1

## 7. Inventory & Purchasing

### SCN-INV-001
- Module: Product CRUD + image upload
- Actor: Admin Gudang / Super Admin
- Precondition: user role valid.
- Trigger / Step-by-step: create/update product, upload image.
- Expected API / UI result: produk tampil di inventory dan katalog.
- Expected DB/status side effect: product tersimpan, gambar tersanitasi.
- Negative path / edge case: upload image oversize/invalid.
- Risk if failed: katalog rusak atau file abuse.
- Priority: P1

### SCN-INV-002
- Module: Stock mutation
- Actor: Admin Gudang / Super Admin
- Precondition: produk ada.
- Trigger / Step-by-step: mutation `in`, `out`, `adjustment`.
- Expected API / UI result: current stock berubah sesuai aturan.
- Expected DB/status side effect: `StockMutation` tercatat, inventory cost bergerak.
- Negative path / edge case: mutation menyebabkan stok negatif.
- Risk if failed: stok fisik dan sistem pecah.
- Priority: P0

### SCN-INV-003
- Module: Create purchase order
- Actor: Kasir / Super Admin
- Precondition: supplier valid.
- Trigger / Step-by-step: buat PO dengan beberapa item.
- Expected API / UI result: PO baru status `pending`.
- Expected DB/status side effect: `PurchaseOrder` dan item-itemnya terbentuk.
- Negative path / edge case: supplier invalid, total_cost invalid.
- Risk if failed: restock pipeline tidak bisa diaudit.
- Priority: P1

### SCN-INV-004
- Module: Receive PO partial / full
- Actor: Admin Gudang / Kasir / Super Admin
- Precondition: PO `pending` atau `partially_received`.
- Trigger / Step-by-step: receive sebagian lalu receive penuh.
- Expected API / UI result: status PO berubah `partially_received` lalu `received`.
- Expected DB/status side effect: stok produk naik, stock mutation tercatat, inbound cost masuk.
- Negative path / edge case: receive ulang pada PO `received`/`canceled`.
- Risk if failed: stok dobel atau inbound hilang.
- Priority: P0

### SCN-INV-005
- Module: PO receive saat ada allocation pending
- Actor: Admin Gudang / Kasir
- Precondition: ada backorder untuk produk yang sama.
- Trigger / Step-by-step: receive PO.
- Expected API / UI result: stok available berubah, admin masih harus melakukan alokasi manual.
- Expected DB/status side effect: tidak otomatis menutup seluruh kekurangan tanpa proses allocation.
- Negative path / edge case: operator mengira auto-allocation penuh terjadi.
- Risk if failed: backorder tidak pernah diselesaikan atau terselesaikan tanpa kontrol.
- Priority: P0

### SCN-INV-006
- Module: Inventory import preview/commit
- Actor: Admin Gudang / Super Admin
- Precondition: file `.xlsx/.xls/.csv` valid atau invalid tersedia.
- Trigger / Step-by-step: preview import, edit rows, commit import.
- Expected API / UI result: preview menampilkan summary/errors; commit hanya jalan bila rows valid.
- Expected DB/status side effect: produk terbuat/terupdate sesuai hasil import.
- Negative path / edge case: format file tidak didukung, path import tak diizinkan, rows kosong.
- Risk if failed: bulk data master korup.
- Priority: P1

### SCN-INV-007
- Module: Stock opname overlap
- Actor: Admin Gudang / Super Admin
- Precondition: audit stok aktif, mutasi stok juga berjalan.
- Trigger / Step-by-step: start opname, submit item, finish, sambil ada mutation/receive.
- Expected API / UI result: audit tetap bisa ditelusuri.
- Expected DB/status side effect: opname tersimpan konsisten; selisih bisa direview.
- Negative path / edge case: data stok berubah selama audit.
- Risk if failed: audit stok menyesatkan.
- Priority: P0

## 8. Retur

### SCN-RET-001
- Module: Admin approve retur + assign pickup
- Actor: Kasir / Super Admin
- Precondition: retur `pending`.
- Trigger / Step-by-step: approve retur dan assign courier pickup bila flow mensyaratkan.
- Expected API / UI result: retur maju ke status berikutnya.
- Expected DB/status side effect: `courier_id` retur dapat terisi, event retur terpancar.
- Negative path / edge case: courier tidak diisi saat status perlu pickup assignment.
- Risk if failed: retur approved tapi tidak ada eksekutor.
- Priority: P0

### SCN-RET-002
- Module: Driver pickup retur
- Actor: Driver
- Precondition: retur diassign ke driver.
- Trigger / Step-by-step: buka `/driver/retur/[id]`, update status pickup sampai serah kasir/gudang.
- Expected API / UI result: hanya driver owner bisa update.
- Expected DB/status side effect: status retur bergerak sesuai rule.
- Negative path / edge case: driver lain akses, status lompat.
- Risk if failed: chain of custody retur putus.
- Priority: P0

### SCN-RET-003
- Module: Retur reject
- Actor: Kasir / Super Admin
- Precondition: retur `pending`.
- Trigger / Step-by-step: reject retur dengan alasan.
- Expected API / UI result: customer mendapat status penolakan yang jelas.
- Expected DB/status side effect: retur jadi status terminal reject.
- Negative path / edge case: reject tanpa alasan operasional jelas.
- Risk if failed: komplain customer meningkat.
- Priority: P1

## 9. Chat & WhatsApp

### SCN-CHAT-001
- Module: Open thread and send message
- Actor: Customer, Staff, Driver
- Precondition: user terautentikasi, thread valid atau bisa di-open.
- Trigger / Step-by-step: buka thread, kirim pesan teks.
- Expected API / UI result: pesan muncul di sisi pengirim dan penerima, unread badge berubah.
- Expected DB/status side effect: chat message tersimpan, thread last activity berubah.
- Negative path / edge case: wrong role mencoba akses thread yang tidak berhak.
- Risk if failed: komunikasi operasional putus atau bocor.
- Priority: P1

### SCN-CHAT-002
- Module: Attachment upload policy
- Actor: Customer, Staff, Driver, guest widget
- Precondition: endpoint attachment tersedia.
- Trigger / Step-by-step: upload file valid lalu file invalid.
- Expected API / UI result: MIME yang didukung lolos; file oversize atau unsupported ditolak.
- Expected DB/status side effect: file tersimpan hanya untuk lampiran valid.
- Negative path / edge case: guest upload tanpa metadata yang cukup.
- Risk if failed: storage abuse / malware distribution.
- Priority: P0

### SCN-CHAT-003
- Module: WhatsApp disconnected
- Actor: Kasir / Super Admin
- Precondition: halaman WA aktif.
- Trigger / Step-by-step: WA client disconnect atau auth failure.
- Expected API / UI result: status page memperlihatkan kondisi aktual.
- Expected DB/status side effect: tidak merusak thread/message yang sudah ada.
- Negative path / edge case: operator tetap mengira channel WA aktif.
- Risk if failed: pesan customer tidak tertangani.
- Priority: P1

## 10. Cross-Cutting Abuse / Resilience

### SCN-X-001
- Module: Illegal role access
- Actor: semua role salah akses
- Precondition: token valid tetapi role tidak sesuai endpoint.
- Trigger / Step-by-step: coba akses endpoint role lain.
- Expected API / UI result: 403 stabil.
- Expected DB/status side effect: tidak ada mutasi data.
- Negative path / edge case: route fallback atau detail order via invoice ID.
- Risk if failed: privilege escalation.
- Priority: P0

### SCN-X-002
- Module: Multipart token expiry
- Actor: customer/driver
- Precondition: token hampir expired.
- Trigger / Step-by-step: upload proof payment/delivery/issue saat token kadaluarsa.
- Expected API / UI result: request ditolak konsisten.
- Expected DB/status side effect: file tidak dianggap sukses terproses secara bisnis.
- Negative path / edge case: file sudah tertulis di disk tapi transaksi bisnis gagal.
- Risk if failed: orphan file dan status ambigu.
- Priority: P0

### SCN-X-003
- Module: Realtime notification sync
- Actor: customer, gudang, finance, kasir
- Precondition: dua role membuka halaman terkait order yang sama.
- Trigger / Step-by-step: lakukan perubahan status order.
- Expected API / UI result: listener refresh/badge/notifikasi terpicu ke target role yang benar.
- Expected DB/status side effect: hanya event, tidak ada data baru selain event log.
- Negative path / edge case: target role tidak sesuai atau refresh tidak terjadi.
- Risk if failed: dashboard salah baca kondisi operasional.
- Priority: P1

### SCN-X-004
- Module: Illegal transition
- Actor: admin, driver, finance
- Precondition: order ada dalam status tertentu.
- Trigger / Step-by-step: paksa transisi yang tidak ada di `orderTransitions`.
- Expected API / UI result: 409 conflict.
- Expected DB/status side effect: status order tetap.
- Negative path / edge case: status legacy `waiting_payment`.
- Risk if failed: lifecycle order rusak.
- Priority: P0

### SCN-X-005
- Module: Partial success pasca-commit
- Actor: semua flow kritikal
- Precondition: ada flow dengan side effect ke file, event, jurnal, atau notifikasi.
- Trigger / Step-by-step: simulasi kegagalan setelah transaksi utama commit.
- Expected API / UI result: state utama tetap konsisten dan bisa di-reconcile.
- Expected DB/status side effect: tidak ada split-brain permanen.
- Negative path / edge case: event terkirim tapi UI belum refresh; file tertulis tapi proof ditolak.
- Risk if failed: data utama dan artefak pendukung tidak sinkron.
- Priority: P0

## 11. Ringkasan Cakupan

- Total skenario di dokumen ini: 61
- P0: 47
- P1: 14
- P2: 0

## 12. Blind Spots yang Tetap Perlu Data / Integrasi

- Seed data customer/order/invoice campuran untuk semua kombinasi status.
- Simulasi WhatsApp real client (`qr`, `auth_failure`, `disconnected`).
- Validasi jurnal dan account posting penuh membutuhkan data akun standar aktif.
- Beberapa flow retur rinci ditentukan oleh `ReturService`, sehingga perlu seed status retur yang lengkap untuk uji transisi penuh.
- Performa race condition nyata checkout/promo/alokasi/COD verify perlu concurrent test harness, bukan hanya uji manual.
