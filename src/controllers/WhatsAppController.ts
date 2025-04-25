import { Request, Response } from 'express';
import SimpleWhatsAppService from '../services/SimpleWhatsAppService';
import GroupMemberRepository from '../repositories/GroupMemberRepository';

/**
 * Controlador para WhatsApp
 */
class WhatsAppController {
  /**
   * Genera un código QR para autenticación con WhatsApp Web
   */
  async generateSession(req: Request, res: Response): Promise<void> {
    try {
      // Inicializar cliente si no está inicializado
      if (!SimpleWhatsAppService.isClientAuthenticated()) {
        await SimpleWhatsAppService.initialize();
      }

      // Verificar si ya está autenticado
      if (SimpleWhatsAppService.isClientAuthenticated()) {
        res.status(200).json({
          success: true,
          message: 'Cliente ya autenticado',
          authState: 'AUTHENTICATED',
          sessionExists: true
        });
        return;
      }

      // Verificar si ya existe un QR
      const existingQR = SimpleWhatsAppService.getQRCode();
      if (existingQR) {
        res.status(200).json({
          success: true,
          message: 'Código QR generado exitosamente. Escanea con WhatsApp para iniciar sesión.',
          qrCode: existingQR,
          authState: 'PENDING'
        });
        return;
      }

      // Si no hay QR, esperar a que se genere uno
      const waitForQR = async (): Promise<string | null> => {
        return new Promise<string | null>((resolve) => {
          if (SimpleWhatsAppService.isClientAuthenticated()) {
            resolve(null);
            return;
          }

          const existingQR = SimpleWhatsAppService.getQRCode();
          if (existingQR) {
            resolve(existingQR);
            return;
          }

          const onQR = (qr: string) => {
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
            clearInterval(checkExistingQR);
            resolve(qr);
          };

          const onAuthenticated = () => {
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
            clearInterval(checkExistingQR);
            resolve(null);
          };
          
          const onAuthFailure = (error: string) => {
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
            clearInterval(checkExistingQR);
            resolve(null);
          };

          const checkExistingQR = setInterval(() => {
            const qr = SimpleWhatsAppService.getQRCode();
            if (qr) {
              SimpleWhatsAppService.removeListener('qr', onQR);
              SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
              SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
              clearInterval(checkExistingQR);
              resolve(qr);
            }
            
            if (SimpleWhatsAppService.isClientAuthenticated()) {
              SimpleWhatsAppService.removeListener('qr', onQR);
              SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
              SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
              clearInterval(checkExistingQR);
              resolve(null);
            }
          }, 1000);

          SimpleWhatsAppService.on('qr', onQR);
          SimpleWhatsAppService.on('authenticated', onAuthenticated);
          SimpleWhatsAppService.on('auth_failure', onAuthFailure);
        });
      };

      const qr = await waitForQR();
      
      if (qr) {
        res.status(200).json({
          success: true,
          message: 'Código QR generado exitosamente. Escanea con WhatsApp para iniciar sesión.',
          qrCode: qr,
          authState: 'PENDING'
        });
      } else if (SimpleWhatsAppService.isClientAuthenticated()) {
        res.status(200).json({
          success: true,
          message: 'Cliente autenticado',
          authState: 'AUTHENTICATED',
          sessionExists: true
        });
      } else {
        const authError = SimpleWhatsAppService.getAuthError();
        res.status(401).json({
          success: false,
          message: 'Error de autenticación',
          error: authError,
          authState: 'ERROR'
        });
      }
    } catch (error) {
      console.error('Error al generar sesión de WhatsApp:', error);
      res.status(500).json({
        success: false,
        message: 'Error al generar sesión de WhatsApp',
        error: error instanceof Error ? error.message : 'Error desconocido',
        authState: 'ERROR'
      });
    }
  }

  /**
   * Verifica el estado de la sesión de WhatsApp
   */
  async checkSessionStatus(req: Request, res: Response): Promise<void> {
    try {
      const isAuthenticated = SimpleWhatsAppService.isClientAuthenticated();
      const qrCode = SimpleWhatsAppService.getQRCode();
      const authError = SimpleWhatsAppService.getAuthError();
      
      if (isAuthenticated) {
        res.status(200).json({
          success: true,
          status: 'active',
          message: 'Sesión de WhatsApp activa',
          authState: 'AUTHENTICATED'
        });
      } else if (qrCode) {
        res.status(200).json({
          success: true,
          status: 'pending',
          message: 'Esperando escaneo de código QR',
          qrCode,
          authState: 'PENDING'
        });
      } else if (authError) {
        res.status(401).json({
          success: false,
          status: 'error',
          message: 'Error de autenticación',
          error: authError,
          authState: 'ERROR'
        });
      } else {
        res.status(200).json({
          success: true,
          status: 'inactive',
          message: 'No hay sesión activa de WhatsApp',
          authState: 'NO_SESSION'
        });
      }
    } catch (error) {
      console.error('Error al verificar estado de sesión:', error);
      res.status(500).json({
        success: false,
        message: 'Error al verificar estado de sesión',
        error: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  /**
   * Obtiene el estado de autenticación actual
   */
  async getAuthState(req: Request, res: Response): Promise<void> {
    try {
      const isAuthenticated = SimpleWhatsAppService.isClientAuthenticated();
      const qrCode = SimpleWhatsAppService.getQRCode();
      const authError = SimpleWhatsAppService.getAuthError();
      
      // Determinar el estado de la conexión
      let status = 'UNKNOWN';
      if (isAuthenticated) {
        status = 'AUTHENTICATED';
      } else if (qrCode) {
        status = 'NEED_SCAN';
      } else if (authError) {
        status = 'AUTH_ERROR';
      } else {
        status = 'NO_SESSION';
      }
      
      res.status(200).json({
        success: true,
        data: {
          status,
          authenticated: isAuthenticated,
          qrAvailable: !!qrCode,
          qrCode: qrCode, // Solo presente si hay QR disponible
          error: authError,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error al obtener estado de autenticación:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener estado de autenticación',
        error: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  /**
   * Obtiene información de un grupo de WhatsApp
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
      
      res.status(200).json({
        success: true,
        data: groupInfo
      });
    } catch (error) {
      console.error('Error al obtener información del grupo:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener información del grupo',
        error: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  /**
   * Obtiene métricas de un grupo
   */
  async getGroupMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { groupName } = req.params;
      const since = req.query.since ? parseInt(req.query.since as string) : 24;
      
      if (!groupName) {
        res.status(400).json({
          success: false,
          message: 'Se requiere el nombre del grupo'
        });
        return;
      }
      
      const metrics = await SimpleWhatsAppService.getGroupMetrics(groupName, since);
      
      res.status(200).json({
        success: true,
        data: metrics
      });
    } catch (error) {
      console.error('Error al obtener métricas del grupo:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener métricas del grupo',
        error: error instanceof Error ? error.message : 'Error desconocido'
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
      
      console.log(`Iniciando escaneo de ${groupNames.length} grupos...`);
      
      // Establecer un timeout global para el escaneo
      const scanTimeout = setTimeout(() => {
        console.log('⚠️ Timeout global para el escaneo de grupos');
      }, 10 * 60 * 1000); // 10 minutos máximo
      
      // Ejecutar escaneo y esperar resultados
      const results = await SimpleWhatsAppService.scanGroups(groupNames);
      
      clearTimeout(scanTimeout);
      console.log(`Escaneo de grupos completado: ${Object.keys(results).length} grupos procesados`);
      
      res.status(200).json({
        success: true,
        message: `Escaneo de ${groupNames.length} grupos completado`,
        data: results
      });
    } catch (error) {
      console.error('Error escaneando grupos:', error);
      res.status(500).json({
        success: false,
        message: 'Error al escanear grupos',
        error: error instanceof Error ? error.message : 'Error desconocido'
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
   * Limpia recursos y reinicia el sistema
   */
  async cleanup(req: Request, res: Response): Promise<void> {
    try {
      console.log('Iniciando limpieza de recursos...');
      
      await SimpleWhatsAppService.close();
      
      res.status(200).json({
        success: true,
        message: 'Recursos liberados correctamente'
      });
    } catch (error) {
      console.error('Error durante la limpieza de recursos:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }
}

export default new WhatsAppController(); 