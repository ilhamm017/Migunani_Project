import { Router } from 'express';
import * as CatalogController from '../controllers/CatalogController';

const router = Router();

// Public Routes (No Auth Middleware needed for viewing)
router.get('/', CatalogController.getCatalog);
router.get('/categories', CatalogController.getPublicCategories);
router.get('/:id', CatalogController.getProductDetails);

export default router;
