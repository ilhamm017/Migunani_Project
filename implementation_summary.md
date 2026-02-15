# Order Allocation Refactoring Summary

## Changes Implemented

### Backend
- **Route Permissions**: Updated `back_end/src/routes/allocation.ts` to allow `kasir` and `admin_finance` access to allocation endpoints, removing `admin_gudang`.

### Frontend
- **Allocation Page Moved**: Moved `admin/warehouse/allocation` to `admin/orders/allocation`.
- **Admin Dashboard**:
    - **Kasir**: Added "Alokasi Order" card.
    - **Warehouse**: Removed "Alokasi Order" card and related stats from landing page.
- **Warehouse Kanban**:
    - Simplified columns to only show `ready_to_ship` (Siap Packing) and `shipped` (Dikirim).
    - Removed `pending` and `waiting_payment` columns to reduce noise for warehouse staff.
- **Order Details**:
    - Updated "Proses Alokasi" button visibility to include `kasir` and `admin_finance`.
    - Removed `admin_gudang` from allocation actions.

## Verification Steps
1.  **Login as Kasir**: Verify "Alokasi Order" exists and works.
2.  **Login as Warehouse**: Verify "Alokasi Order" is gone and Kanban shows only ready orders.
