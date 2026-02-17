import { Router } from 'express';
import * as PromoController from '../controllers/PromoController';

const router = Router();

router.get('/validate/:code', PromoController.validatePromo);

export default router;
