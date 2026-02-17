import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import * as InventoryController from '../controllers/InventoryController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();
const uploadImport = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024
    }
});
const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024
    }
});

const uploadProductImageMiddleware = (req: Request, res: Response, next: NextFunction) => {
    uploadImage.single('image')(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Ukuran gambar terlalu besar (maksimal 2MB).' });
        }
        if (err) {
            return res.status(400).json({ message: 'Upload gambar gagal diproses.' });
        }
        return next();
    });
};

// Public Routes (Moved to /api/v1/catalog)
// router.get('/products', InventoryController.getProducts); -> Now protected or internal
// router.get('/products/:sku', InventoryController.getProductBySku);

// Protected Routes (Admin/Gudang + role operasional order intake)
router.get('/admin/products', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), InventoryController.getProducts);
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
router.get('/admin/inventory/po', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.getPurchaseOrders);
router.get('/admin/inventory/po/:id', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.getPurchaseOrderById);
router.post('/admin/inventory/po', authenticateToken, authorizeRoles('super_admin', 'kasir'), InventoryController.createPurchaseOrder);
router.patch('/admin/inventory/po/:id/receive', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.receivePurchaseOrder);
router.post('/admin/inventory/import/preview', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), uploadImport.single('file'), InventoryController.previewProductsImportFromUpload);
router.post('/admin/inventory/import/commit', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), InventoryController.commitProductsImport);
router.post('/admin/inventory/import', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), uploadImport.single('file'), InventoryController.importProductsFromUpload);
router.post('/admin/inventory/import-from-path', authenticateToken, authorizeRoles('super_admin'), InventoryController.importProductsFromPath);

// Scan (Admin/Gudang/Kasir)
router.get('/admin/inventory/scan', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.scanProduct);
router.get('/admin/inventory/scan/:sku', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'kasir'), InventoryController.scanProduct);

// Supplier Invoices
router.post('/admin/finance/supplier-invoice', authenticateToken, authorizeRoles('super_admin', 'admin_finance'), InventoryController.createSupplierInvoice);
router.post('/admin/finance/supplier-invoice/pay', authenticateToken, authorizeRoles('super_admin', 'admin_finance'), InventoryController.paySupplierInvoice);

export default router;
