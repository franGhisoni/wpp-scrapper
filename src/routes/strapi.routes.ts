import { Router } from 'express';
import strapiController from '../controllers/StrapiController';

const router = Router();

/**
 * @route   GET /api/strapi/whatsapp-groups
 * @desc    Obtiene todos los grupos de WhatsApp desde Strapi
 * @access  Public
 */
router.get('/whatsapp-groups', strapiController.getWhatsAppGroups);

/**
 * @route   GET /api/strapi/whatsapp-groups/:name
 * @desc    Obtiene un grupo de WhatsApp específico por nombre
 * @access  Public
 */
router.get('/whatsapp-groups/:name', strapiController.getWhatsAppGroupByName);

/**
 * @route   GET /api/strapi/campaigns
 * @desc    Obtiene todas las campañas desde Strapi
 * @access  Public
 */
router.get('/campaigns', strapiController.getCampaigns);

/**
 * @route   POST /api/strapi/campaigns/:campaignId/scan
 * @desc    Escanea todos los grupos de WhatsApp asociados a una campaña
 * @access  Public
 */
router.post('/campaigns/:campaignId/scan', strapiController.scanCampaignGroups);

/**
 * @route   POST /api/strapi/whatsapp-groups/:groupId/click
 * @desc    Incrementa el contador de clicks en un grupo de WhatsApp
 * @access  Public
 */
router.post('/whatsapp-groups/:groupId/click', strapiController.incrementGroupClicks);

export default router; 