import { Request, Response } from 'express';
import SimpleWhatsAppService from '../services/SimpleWhatsAppService';

/**
 * Controlador simplificado para WhatsApp
 */
class SimpleWhatsAppController {
  /**
   * Obtiene estado de autenticación
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = {
        authenticated: SimpleWhatsAppService.isClientAuthenticated(),
        qrCode: SimpleWhatsAppService.getQRCode()
      };
      
      res.status(200).json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  /**
   * Genera un código QR para iniciar sesión en WhatsApp Web
   */
  async generateQR(req: Request, res: Response): Promise<void> {
    try {
      // Ya está autenticado, no generamos QR
      if (SimpleWhatsAppService.isClientAuthenticated()) {
        res.json({
          status: 'AUTHENTICATED',
          message: 'Cliente ya autenticado'
        });
        return;
      }

      // Si hay un QR existente, lo devolvemos
      const existingQR = SimpleWhatsAppService.getQRCode();
      if (existingQR) {
        res.json({
          status: 'NEED_SCAN',
          qr: existingQR
        });
        return;
      }

      // Inicializar cliente solo si no está iniciado
      await SimpleWhatsAppService.initialize();

      // Esperar a que el código QR esté disponible o se alcance timeout
      const timeoutMs = 60000; // 60 segundos
      const startTime = Date.now();
      
      // Función que espera el QR con timeout
      const waitForQR = async (): Promise<string | null> => {
        return new Promise((resolve) => {
          // Crear timeout
          const timeout = setTimeout(() => {
            console.log("Timeout esperando QR");
            resolve(null);
          }, timeoutMs);
          
          // Evento QR
          const onQR = (qr: string) => {
            clearTimeout(timeout);
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            resolve(qr);
          };
          
          // Evento autenticación
          const onAuthenticated = () => {
            clearTimeout(timeout);
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            resolve(null);
          };
          
          // Registrar listeners
          SimpleWhatsAppService.on('qr', onQR);
          SimpleWhatsAppService.on('authenticated', onAuthenticated);
          
          // Verificar si ya tenemos QR (para caso donde el evento ya pasó)
          const checkExisting = () => {
            const qr = SimpleWhatsAppService.getQRCode();
            if (qr) {
              clearTimeout(timeout);
              SimpleWhatsAppService.removeListener('qr', onQR);
              SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
              resolve(qr);
            }
          };
          
          // Verificar inmediatamente
          checkExisting();
        });
      };
      
      // Esperar QR
      const qrCode = await waitForQR();
      
      // Verificar si mientras esperábamos se autenticó
      if (SimpleWhatsAppService.isClientAuthenticated()) {
        res.json({
          status: 'AUTHENTICATED',
          message: 'Cliente autenticado durante la generación de QR'
        });
        return;
      }
      
      if (qrCode) {
        res.json({
          status: 'NEED_SCAN',
          qr: qrCode
        });
      } else {
        res.status(408).json({
          status: 'TIMEOUT',
          message: 'Tiempo de espera agotado generando QR'
        });
      }
    } catch (error) {
      console.error('Error generando QR:', error);
      res.status(500).json({
        status: 'ERROR',
        message: 'Error generando código QR',
        error: error instanceof Error ? error.message : 'Error desconocido'
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
      
      const groupInfo = await SimpleWhatsAppService.getGroupInfo(groupName);
      
      res.status(200).json({ success: true, data: groupInfo });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
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
      
      const metrics = await SimpleWhatsAppService.getGroupMetrics(groupName);
      
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
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
      
      // Cambio: Procesamos de forma síncrona y esperamos los resultados
      console.log(`Iniciando escaneo síncrono de ${groupNames.length} grupos...`);
      
      // Establecer un timeout global para el escaneo
      const scanTimeout = setTimeout(() => {
        console.log('⚠️ Timeout global para el escaneo de grupos');
      }, 10 * 60 * 1000); // 10 minutos máximo
      
      // Ejecutar escaneo y esperar resultados
      const results = await SimpleWhatsAppService.scanGroups(groupNames);
      
      clearTimeout(scanTimeout);
      console.log(`Escaneo de grupos completado: ${Object.keys(results).length} grupos procesados`);
      
      // Devolver resultados completos directamente
      res.status(200).json({
        success: true,
        message: `Escaneo de ${groupNames.length} grupos completado`,
        data: results
      });
    } catch (error) {
      console.error('Error escaneando grupos:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  /**
   * Cierra la sesión de WhatsApp
   */
  async logout(req: Request, res: Response): Promise<void> {
    try {
      await SimpleWhatsAppService.close();
      
      res.status(200).json({
        success: true,
        message: 'Sesión cerrada correctamente'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
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
          const metrics = await SimpleWhatsAppService.getGroupMetrics(groupName);
          results[groupName] = metrics;
        } catch (error) {
          console.error(`Error al obtener métricas del grupo ${groupName}:`, error);
          results[groupName] = { error: error instanceof Error ? error.message : 'Error desconocido' };
        }
      }
      
      res.status(200).json({ success: true, data: results });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  /**
   * Verifica si el sistema está ocupado escaneando grupos
   */
  async checkScanStatus(req: Request, res: Response): Promise<void> {
    try {
      const isScanning = SimpleWhatsAppService.isScanning();
      const scanProgress = SimpleWhatsAppService.getScanProgress();
      
      res.status(200).json({
        success: true,
        data: {
          scanning: isScanning,
          progress: scanProgress
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }
}

export default new SimpleWhatsAppController(); 