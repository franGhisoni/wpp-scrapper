import express from 'express';
import SimpleWhatsAppController from '../controllers/SimpleWhatsAppController';

const router = express.Router();

// Rutas de WhatsApp
router.get('/whatsapp/status', SimpleWhatsAppController.getStatus);
router.get('/whatsapp/api-status', SimpleWhatsAppController.getApiStatus);
router.get('/whatsapp/qr', SimpleWhatsAppController.generateQR);
router.post('/whatsapp/scan', SimpleWhatsAppController.scanGroups);
router.get('/whatsapp/scan/status', SimpleWhatsAppController.checkScanStatus);
router.post('/whatsapp/metrics', SimpleWhatsAppController.getGroupsMetrics);
router.post('/whatsapp/logout', SimpleWhatsAppController.logout);

// Mantener endpoint individual para compatibilidad
router.get('/whatsapp/group/:groupName', SimpleWhatsAppController.getGroupInfo);
router.get('/whatsapp/group/:groupName/metrics', SimpleWhatsAppController.getGroupMetrics);

export default router; 