import { Router } from 'express';
import * as CartController from '../controllers/CartController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken); // All cart routes require auth

router.get('/', CartController.getCart);
router.post('/', CartController.addToCart);
router.patch('/item/:id', CartController.updateCartItem); // Update Qty
router.delete('/item/:id', CartController.removeCartItem);
router.delete('/', CartController.clearCart);

export default router;
