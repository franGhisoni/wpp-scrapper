import { Request, Response } from 'express';
import WhatsAppService from '../services/WhatsAppService';

/**
 * Controlador para WhatsApp
 */
class WhatsAppController {
  /**
   * Obtiene estado de autenticación
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = {
        authenticated: WhatsAppService.isClientAuthenticated(),
        qrCode: WhatsAppService.getQRCode()
      };
      
      res.status(200).json({ success: true, data: status });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error && typeof error === 'object' && 'message' in error 
          ? error.message 
          : 'Error desconocido'
      });
    }
  }

  /**
   * Genera un código QR para autenticación y espera hasta que esté disponible
   */
  async generateQR(req: Request, res: Response): Promise<void> {
    try {
      if (WhatsAppService.isClientAuthenticated()) {
        res.status(200).json({
          success: true,
          message: 'Cliente ya autenticado, no es necesario escanear QR',
          authenticated: true
        });
        return;
      }
      
      // Verificar si ya hay un QR code generado
      const existingQrCode = WhatsAppService.getQRCode();
      if (existingQrCode) {
        res.status(200).json({ success: true, qrCode: existingQrCode });
        return;
      }
      
      // Esperar a que se genere el código QR
      const qrCodePromise = new Promise<string>((resolve, reject) => {
        // Timeout de 30 segundos para la generación del QR
        const timeout = setTimeout(() => {
          reject(new Error('Tiempo de espera agotado para la generación del código QR'));
        }, 30000);
        
        // Escuchar el evento qr
        const qrListener = (qr: string) => {
          clearTimeout(timeout);
          resolve(qr);
        };
        
        // Escuchar el evento de autenticación para cancelar la espera
        const authListener = () => {
          clearTimeout(timeout);
          resolve('authenticated');
        };
        
        // Suscribirse a los eventos
        WhatsAppService.once('qr', qrListener);
        WhatsAppService.once('authenticated', authListener);
        
        // Limpiar listeners en caso de error o timeout
        const cleanupListeners = () => {
          WhatsAppService.removeListener('qr', qrListener);
          WhatsAppService.removeListener('authenticated', authListener);
        };
        
        // Limpiar listeners cuando se resuelva o rechace la promesa
        setTimeout(cleanupListeners, 31000);
      });
      
      // Inicializar el cliente (generará QR si no está autenticado)
      await WhatsAppService.initialize();
      
      try {
        const qrResult = await qrCodePromise;
        
        if (qrResult === 'authenticated') {
          res.status(200).json({
            success: true,
            message: 'Cliente autenticado durante la generación del QR',
            authenticated: true
          });
        } else {
          res.status(200).json({ success: true, qrCode: qrResult });
        }
      } catch (error) {
        // Si se agota el tiempo, verificar si hay un QR code o si está autenticado
        if (WhatsAppService.isClientAuthenticated()) {
          res.status(200).json({
            success: true,
            message: 'Cliente autenticado',
            authenticated: true
          });
        } else {
          const qrCode = WhatsAppService.getQRCode();
          if (qrCode) {
            res.status(200).json({ success: true, qrCode });
          } else {
            res.status(500).json({
              success: false,
              message: 'No se pudo generar el código QR'
            });
          }
        }
      }
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error && typeof error === 'object' && 'message' in error 
          ? error.message 
          : 'Error desconocido'
      });
    }
  }

  /**
   * Obtiene información de un grupo
   */
  async getGroupInfo(req: Request, res: Response): Promise<void> {
    try {
      const { groupName } = req.params;
      
      if (!groupName) {
        res.status(400).json({
          success: false,
          message: 'Se requiere el nombre del grupo'
        });
        return;
      }
      
      const groupInfo = await WhatsAppService.getGroupInfo(groupName);
      
      res.status(200).json({ success: true, data: groupInfo });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error && typeof error === 'object' && 'message' in error 
          ? error.message 
          : 'Error desconocido'
      });
    }
  }

  /**
   * Obtiene métricas de un grupo
   */
  async getGroupMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { groupName } = req.params;
      
      if (!groupName) {
        res.status(400).json({
          success: false,
          message: 'Se requiere el nombre del grupo'
        });
        return;
      }
      
      const metrics = await WhatsAppService.getGroupMetrics(groupName);
      
      res.status(200).json({ success: true, data: metrics });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error && typeof error === 'object' && 'message' in error 
          ? error.message 
          : 'Error desconocido'
      });
    }
  }

  /**
   * Escanea múltiples grupos
   */
  async scanGroups(req: Request, res: Response): Promise<void> {
    try {
      const { groupNames } = req.body;
      
      if (!groupNames || !Array.isArray(groupNames) || groupNames.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Se requiere un array de nombres de grupos'
        });
        return;
      }
      
      const results = await WhatsAppService.scanGroups(groupNames);
      
      res.status(200).json({ success: true, data: results });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error && typeof error === 'object' && 'message' in error 
          ? error.message 
          : 'Error desconocido'
      });
    }
  }

  /**
   * Cierra la sesión de WhatsApp
   */
  async logout(req: Request, res: Response): Promise<void> {
    try {
      await WhatsAppService.close();
      
      res.status(200).json({
        success: true,
        message: 'Sesión cerrada correctamente'
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error && typeof error === 'object' && 'message' in error 
          ? error.message 
          : 'Error desconocido'
      });
    }
  }

  /**
   * Obtiene métricas de múltiples grupos
   */
  async getGroupsMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { groupNames } = req.body;
      
      if (!groupNames || !Array.isArray(groupNames) || groupNames.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Se requiere un array de nombres de grupos'
        });
        return;
      }
      
      const results = {};
      
      for (const groupName of groupNames) {
        try {
          const metrics = await WhatsAppService.getGroupMetrics(groupName);
          results[groupName] = metrics;
        } catch (error: any) {
          console.error(`Error al obtener métricas del grupo ${groupName}:`, error);
          results[groupName] = { 
            error: error && typeof error === 'object' && 'message' in error 
              ? error.message 
              : 'Error desconocido' 
          };
        }
      }
      
      res.status(200).json({ success: true, data: results });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error && typeof error === 'object' && 'message' in error 
          ? error.message 
          : 'Error desconocido'
      });
    }
  }
}

export default new WhatsAppController(); 