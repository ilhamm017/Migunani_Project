import { Router } from 'express';
import * as ShippingMethodController from '../controllers/ShippingMethodController';

const router = Router();

// Public route for customer-facing checkout UI.
router.get('/', ShippingMethodController.getPublicShippingMethods);

export default router;
