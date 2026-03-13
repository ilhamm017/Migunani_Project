# Transaction Contract Map

Dokumen ini merangkum state-machine operasional transaksi berdasarkan implementasi aktif.

## Core Transaction State Map

| Trigger | Actor Sah | Precondition | Expected Status | Expected Side Effect |
|---|---|---|---|---|
| Checkout transfer | Customer | cart valid, alamat valid, shipping aktif | `pending` | order baru tercipta, invoice belum ada |
| Checkout COD | Customer | cart valid, alamat valid, shipping aktif | `pending` | order baru tercipta, invoice belum ada |
| Allocate penuh | Kasir / Super Admin | order `pending`, stok cukup | `waiting_invoice` | allocation record terbentuk, stok reserved/released sesuai implementasi |
| Allocate parsial | Kasir / Super Admin | order `pending`, stok parsial | `waiting_invoice` | shortage/backorder terbuka |
| Cancel backorder | Kasir / Super Admin | backorder aktif | `waiting_invoice` atau tetap invoiceable | open backorder turun, canceled backorder naik |
| Issue invoice | Kasir / Super Admin | order invoiceable | `ready_to_ship` | invoice tercipta, payment status sesuai metode bayar |
| Upload proof | Customer | invoice transfer unpaid | `waiting_admin_verification` | proof URL tersimpan, async notify non-blocking |
| Verify payment approve | Admin Finance / Super Admin | invoice transfer waiting verification | `ready_to_ship` atau `completed` | jurnal `payment_verify`, invoice `paid` |
| Verify payment reject | Admin Finance / Super Admin | invoice transfer waiting verification | `hold` | proof dibersihkan, order hold |
| Ship | Admin Gudang | order `ready_to_ship` atau `hold` resolved | `shipped` | courier aktif terpasang |
| Driver complete | Driver assigned | order `shipped` | `completed` / `delivered` / `partially_fulfilled` | proof delivery tersimpan, status tergantung payment/backorder |
| Driver issue | Driver assigned | order masih aktif dikirim | `hold` | courier dilepas, issue tercatat |
| Verify COD | Admin Finance / Super Admin | order COD delivered/completed and settlement eligible | `completed` | settlement + jurnal `cod_settlement` |
| Create retur | Customer | order/item eligible retur | retur `pending` | retur record + evidence tersimpan |
| Approve retur | Kasir / Super Admin | retur pending | retur approved/pickup-assigned | pickup flow dibuka |
| Retur complete | Driver + Kasir | pickup dan receive valid | retur `completed` | stok/retur status sinkron |
| Refund disburse | Admin Finance / Super Admin | retur completed, refund pending | retur tetap `completed` | jurnal `retur_refund`, refund timestamp terisi |

## Contract Notes
- COD normal bisa sudah `cod_pending` saat invoice diterbitkan.
- `driver recordPayment` bukan langkah wajib di semua flow COD.
- `partially_fulfilled` hanya valid setelah delivery pada order yang masih punya backorder aktif.
- WA non-ready sekarang failed-soft; transaksi utama tetap berjalan pada jalur async.
