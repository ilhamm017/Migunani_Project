import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import * as InventoryController from '../controllers/inventory';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import { createMemoryImageUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const router = Router();
const uploadImport = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024
    }
});
const uploadImage = createMemoryImageUpload(2 * 1024 * 1024);
const uploadProductImageMiddleware = createSingleUploadMiddleware(uploadImage, {
    fieldName: 'image',
    sizeExceededMessage: 'Ukuran gambar terlalu besar (maksimal 2MB).',
    fallbackMessage: 'Upload gambar gagal diproses.'
});
const uploadImportMiddleware = (req: Request, res: Response, next: NextFunction) => {
    uploadImport.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Ukuran file import terlalu besar (maksimal 20MB).' });
        }
        if (err instanceof Error) {
            return res.status(400).json({ message: err.message || 'Upload file import gagal diproses.' });
        }
        return next();
    });
};

// Public Routes (Moved to /api/v1/catalog)
// router.get('/products', InventoryController.getProducts); -> Now protected or internal
// router.get('/products/:sku', InventoryController.getProductBySku);

// Protected Routes (Admin/Gudang + role operasional order intake)
router.get('/admin/products', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), InventoryController.getProducts);
router.get('/admin/products/restock-suggestions', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), InventoryController.getRestockSuggestions);
router.get('/admin/products/:id/aliases', authenticateToken, authorizeRoles('super_admin', 'kasir', 'admin_gudang'), InventoryController.getProductAliases);
router.put('/admin/products/:id/aliases', authenticateToken, authorizeRoles('super_admin', 'kasir', 'admin_gudang'), InventoryController.putProductAliases);
router.get('/admin/vehicle-types', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.getVehicleTypes);
router.post('/admin/vehicle-types', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.createVehicleType);
router.patch('/admin/vehicle-types/rename', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.renameVehicleType);
router.delete('/admin/vehicle-types', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.deleteVehicleType);
router.get('/admin/categories', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.getCategories);
router.post('/admin/categories', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.createCategory);
router.put('/admin/categories/:id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.updateCategory);
router.patch('/admin/categories/:id/tier-discount', authenticateToken, authorizeRoles('super_admin', 'kasir'), InventoryController.updateCategoryTierDiscount);
router.delete('/admin/categories/:id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.deleteCategory);
router.get('/admin/suppliers', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.getSuppliers);
router.post('/admin/suppliers', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.createSupplier);
router.put('/admin/suppliers/:id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.updateSupplier);
router.delete('/admin/suppliers/:id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.deleteSupplier);
router.post('/admin/products', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.createProduct);
router.patch('/admin/products/tier-pricing/bulk-discount', authenticateToken, authorizeRoles('super_admin', 'kasir'), InventoryController.bulkUpdateTierDiscounts);
router.put('/admin/products/:id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.updateProduct);
router.patch('/admin/products/:id/tier-pricing', authenticateToken, authorizeRoles('super_admin', 'kasir'), InventoryController.updateProductTierPricing);
router.post('/admin/products/upload-image', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), uploadProductImageMiddleware, InventoryController.uploadProductImage);
router.post('/admin/inventory/mutation', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.createStockMutation);
router.get('/admin/inventory/mutation/:product_id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.getProductMutations);
router.get('/admin/inventory/stock-history/:product_id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), InventoryController.getProductStockHistory);
router.get('/admin/inventory/cost-layers/:productId', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), InventoryController.getCostLayersByProduct);
router.post('/admin/inventory/cost-layers/:productId/batches', authenticateToken, authorizeRoles('super_admin'), InventoryController.createCostLayerBatch);
router.patch('/admin/inventory/cost-layers/batches/:batchId', authenticateToken, authorizeRoles('super_admin'), InventoryController.updateCostLayerBatch);
router.delete('/admin/inventory/cost-layers/batches/:batchId', authenticateToken, authorizeRoles('super_admin'), InventoryController.deleteCostLayerBatch);

/**
 * Inbound Gudang (Receipt)
 * New canonical endpoints under /admin/inventory/inbound
 */
router.get('/admin/inventory/inbound/:id', authenticateToken, authorizeRoles('super_admin', 'admin_finance', 'kasir'), InventoryController.getPurchaseOrderById);
router.get('/admin/inventory/inbound/:id/export-xlsx', authenticateToken, authorizeRoles('super_admin', 'admin_finance', 'kasir'), InventoryController.exportPurchaseOrderExcel);
router.get('/admin/inventory/inbound', authenticateToken, authorizeRoles('super_admin', 'admin_finance', 'kasir'), InventoryController.getPurchaseOrders);
router.post('/admin/inventory/inbound', authenticateToken, authorizeRoles('super_admin'), InventoryController.createPurchaseOrder);
router.patch('/admin/inventory/inbound/:id/items-cost', authenticateToken, authorizeRoles('super_admin'), InventoryController.updateInboundItemCosts);
router.patch('/admin/inventory/inbound/:id/verify-1', authenticateToken, authorizeRoles('super_admin'), InventoryController.verifyInboundStep1);
router.patch('/admin/inventory/inbound/:id/verify-2', authenticateToken, authorizeRoles('super_admin'), InventoryController.verifyInboundStep2AndPost);
router.patch('/admin/inventory/inbound/:id/receive', authenticateToken, authorizeRoles('super_admin'), InventoryController.receivePurchaseOrder);

/**
 * Legacy alias (Deprecated): /admin/inventory/po -> same behavior as inbound receipt.
 * Kept temporarily for backward compatibility. Write operations remain super_admin only.
 */
router.get('/admin/inventory/po', authenticateToken, authorizeRoles('super_admin', 'admin_finance', 'kasir'), InventoryController.getPurchaseOrders);
router.get('/admin/inventory/po/:id', authenticateToken, authorizeRoles('super_admin', 'admin_finance', 'kasir'), InventoryController.getPurchaseOrderById);
router.get('/admin/inventory/po/:id/export-xlsx', authenticateToken, authorizeRoles('super_admin', 'admin_finance', 'kasir'), InventoryController.exportPurchaseOrderExcel);
router.post('/admin/inventory/po', authenticateToken, authorizeRoles('super_admin'), InventoryController.createPurchaseOrder);
router.patch('/admin/inventory/po/:id/items-cost', authenticateToken, authorizeRoles('super_admin'), InventoryController.updateInboundItemCosts);
router.patch('/admin/inventory/po/:id/verify-1', authenticateToken, authorizeRoles('super_admin'), InventoryController.verifyInboundStep1);
router.patch('/admin/inventory/po/:id/verify-2', authenticateToken, authorizeRoles('super_admin'), InventoryController.verifyInboundStep2AndPost);
router.patch('/admin/inventory/po/:id/receive', authenticateToken, authorizeRoles('super_admin'), InventoryController.receivePurchaseOrder);
router.post('/admin/inventory/import/preview', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), uploadImportMiddleware, InventoryController.previewProductsImportFromUpload);
router.post('/admin/inventory/import/commit', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.commitProductsImport);
router.post('/admin/inventory/import', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), uploadImportMiddleware, InventoryController.importProductsFromUpload);
router.post('/admin/inventory/import-from-path', authenticateToken, authorizeRoles('super_admin'), InventoryController.importProductsFromPath);

// Scan (Admin/Gudang/Kasir)
router.get('/admin/inventory/scan', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.scanProduct);
router.get('/admin/inventory/scan/:sku', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.scanProduct);

// Supplier Invoices
router.get('/admin/finance/supplier-invoices', authenticateToken, authorizeRoles('super_admin'), InventoryController.listSupplierInvoices);
router.get('/admin/finance/supplier-invoices/:id', authenticateToken, authorizeRoles('super_admin'), InventoryController.getSupplierInvoiceDetail);
router.post('/admin/finance/supplier-invoice', authenticateToken, authorizeRoles('super_admin', 'admin_finance'), InventoryController.createSupplierInvoice);
router.post('/admin/finance/supplier-invoice/pay', authenticateToken, authorizeRoles('super_admin', 'admin_finance'), InventoryController.paySupplierInvoice);

export default router;
