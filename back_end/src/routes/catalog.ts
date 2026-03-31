import { Router } from 'express';
import * as CatalogController from '../controllers/CatalogController';
import { authenticateTokenOptional } from '../middleware/authMiddleware';

const router = Router();

// Public Routes (No Auth Middleware needed for viewing)
router.get('/', authenticateTokenOptional, CatalogController.getCatalog);
router.get('/categories', CatalogController.getPublicCategories);
router.get('/:id', authenticateTokenOptional, CatalogController.getProductDetails);

export default router;
