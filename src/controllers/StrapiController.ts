import { Request, Response } from 'express';
import StrapiService from '../services/StrapiService';

/**
 * Controlador para interactuar con Strapi
 */
class StrapiController {
  /**
   * Obtiene todos los grupos de WhatsApp desde Strapi
   */
  async getWhatsAppGroups(req: Request, res: Response): Promise<void> {
    try {
      const groups = await StrapiService.getWhatsAppGroups();
      res.status(200).json({ success: true, data: groups });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error?.message || 'Error al obtener grupos de WhatsApp desde Strapi'
      });
    }
  }

  /**
   * Obtiene un grupo de WhatsApp específico por nombre
   */
  async getWhatsAppGroupByName(req: Request, res: Response): Promise<void> {
    try {
      const { name } = req.params;
      const group = await StrapiService.getWhatsAppGroupByName(name);
      
      if (!group) {
        res.status(404).json({
          success: false,
          message: `Grupo de WhatsApp "${name}" no encontrado`
        });
        return;
      }
      
      res.status(200).json({ success: true, data: group });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error?.message || 'Error al obtener grupo de WhatsApp desde Strapi'
      });
    }
  }

  /**
   * Obtiene todas las campañas desde Strapi
   */
  async getCampaigns(req: Request, res: Response): Promise<void> {
    try {
      const campaigns = await StrapiService.getCampaigns();
      res.status(200).json({ success: true, data: campaigns });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error?.message || 'Error al obtener campañas desde Strapi'
      });
    }
  }

  /**
   * Escanea todos los grupos de WhatsApp asociados a una campaña
   */
  async scanCampaignGroups(req: Request, res: Response): Promise<void> {
    try {
      res.status(501).json({
        success: false,
        message: 'Funcionalidad no implementada'
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error?.message || 'Error al escanear grupos de campaña'
      });
    }
  }

  /**
   * Incrementa el contador de clicks en un grupo de WhatsApp
   */
  async incrementGroupClicks(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params;
      const id = parseInt(groupId, 10);
      
      if (isNaN(id)) {
        res.status(400).json({
          success: false,
          message: 'ID de grupo inválido'
        });
        return;
      }
      
      // Actualizar contador de clicks
      const success = await StrapiService.updateWhatsAppGroupClicks(id, 1); // Incrementar en 1
      
      if (!success) {
        res.status(404).json({
          success: false,
          message: `Grupo de WhatsApp con ID ${id} no encontrado`
        });
        return;
      }
      
      res.status(200).json({
        success: true,
        message: 'Contador de clicks incrementado correctamente'
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error?.message || 'Error al incrementar contador de clicks'
      });
    }
  }
}

export default new StrapiController(); 