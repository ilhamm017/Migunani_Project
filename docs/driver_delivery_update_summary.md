# Driver Delivery Logic Update

## Implemented Changes

### Backend (`back_end/src/controllers/DriverController.ts`)
- **Updated `completeDelivery`**:
    - Calculates the COD amount from `order.total_amount` if payment method is 'cod'.
    - Updates `invoice.payment_status` to `cod_pending` with the collected amount.
    - Increments the driver's `User.debt` by the COD amount.
    - Saves the delivery proof photo URL to the order.

### Frontend (`front_end/app/driver/orders/[id]/page.tsx`)
- **Mandatory Photo**:
    - The "Konfirmasi Selesai" button is disabled via `disabled={!proof}` ensuring a photo is uploaded first.
    - Used `<input type="file" capture="environment">` to trigger the camera on mobile devices.
- **Confirmation Modal**:
    - Added a modal triggered by "Konfirmasi Selesai".
    - Displays "Tagihan COD: Rp ..." and a warning "Wajib terima uang tunai" for COD orders.
    - Prompts for confirmation "Ya, Selesai" before submitting to the API.

## Verification Steps
1.  **Login as Driver**: Navigate to an assigned order.
2.  **Photo Check**: Ensure "Konfirmasi Selesai" is disabled until a photo is selected.
3.  **Modal Check**: Click "Konfirmasi Selesai" and verify the modal appears with correct details.
4.  **Submit**: Confirm completion.
5.  **Debt Check**: Verify on the Driver Dashboard that "Utang COD ke Finance" has increased by the order amount (for COD orders).
