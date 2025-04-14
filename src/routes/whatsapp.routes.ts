import { Router } from 'express';
import whatsAppController from '../controllers/WhatsAppController';

const router = Router();

/**
 * @route   POST /api/whatsapp/session
 * @desc    Generate a WhatsApp session and return QR code
 * @access  Public
 */
router.post('/session', whatsAppController.generateSession);

/**
 * @route   GET /api/whatsapp/session/status
 * @desc    Check if a WhatsApp session is active
 *          Optionally close the session with ?close=true query parameter
 *          Use ?force=true to force close the session (kills processes)
 * @access  Public
 */
router.get('/session/status', whatsAppController.checkSessionStatus);

/**
 * @route   GET /api/whatsapp/session/auth-state
 * @desc    Get authentication state
 * @access  Public
 */
router.get('/session/auth-state', whatsAppController.getAuthState);

/**
 * @route   GET /api/whatsapp/group/:groupName
 * @desc    Get information about a WhatsApp group
 * @access  Public
 */
router.get('/group/:groupName', whatsAppController.getGroupInfo);

/**
 * @route   POST /api/whatsapp/scan
 * @desc    Scan multiple WhatsApp groups and gather member data
 * @access  Public
 */
router.post('/scan', whatsAppController.scanMultipleGroups);

/**
 * @route   GET /api/whatsapp/metrics/:groupName
 * @desc    Get metrics for a specific group (new members, left members, total)
 * @access  Public
 */
router.get('/metrics/:groupName', whatsAppController.getGroupMetrics);

/**
 * @route   POST /api/whatsapp/metrics
 * @desc    Get metrics for a specific group using POST (new members, left members, total)
 *          Body: { groupName: "Nombre del grupo", sinceHours: 24 }
 * @access  Public
 */
router.post('/metrics', whatsAppController.getGroupMetrics);

/**
 * @route   GET /api/whatsapp/members/:groupName
 * @desc    Get all members of a specific group
 * @access  Public
 */
router.get('/members/:groupName', whatsAppController.getGroupMembers);

/**
 * @route   POST /api/whatsapp/session/backup
 * @desc    Fuerza un backup de la sesión actual
 * @access  Public
 */
router.post('/session/backup', whatsAppController.forceBackup);

// Forzar backup de sesión
router.post('/force-backup', whatsAppController.forceBackup);

// Forzar guardado manual de sesión
router.post('/force-save-session', whatsAppController.forceSaveSession);

export default router; 