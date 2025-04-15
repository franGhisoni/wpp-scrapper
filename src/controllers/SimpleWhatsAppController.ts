import { Request, Response } from 'express';
import SimpleWhatsAppService from '../services/SimpleWhatsAppService';
import fs from 'fs';

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
      console.log('Iniciando generateQR');
      
      // Verificar si ya está autenticado
      if (SimpleWhatsAppService.isClientAuthenticated()) {
        console.log('Cliente ya está autenticado en generateQR');
        res.json({
          status: 'AUTHENTICATED',
          message: 'Cliente ya autenticado'
        });
        return;
      }
      
      // Verificar si ya existe un QR
      const existingQR = SimpleWhatsAppService.getQRCode();
      if (existingQR) {
        console.log('QR existente encontrado en generateQR');
        res.json({
          status: 'NEED_SCAN',
          qr: existingQR
        });
        return;
      }
      
      // Verificar si existe un directorio de sesión previa
      const sessionDir = './.wwebjs_auth/session-whatsapp-api';
      const sessionExists = fs.existsSync(sessionDir);
      console.log(`Verificando existencia de sesión en ${sessionDir}: ${sessionExists}`);
      
      // Ajustar el timeout basado en la existencia de sesión
      // Si hay sesión, esperamos menos tiempo ya que debería autenticarse rápido
      const timeoutMs = sessionExists ? 15000 : 60000;
      console.log(`Timeout configurado: ${timeoutMs}ms`);
      
      // Inicializar cliente WhatsApp
      console.log('Inicializando cliente WhatsApp');
      await SimpleWhatsAppService.initialize();
      
      // Si hay una sesión previa, esperar brevemente para dar tiempo a la autenticación automática
      if (sessionExists) {
        console.log('Sesión existente detectada, esperando 5 segundos para autenticación automática');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Verificar de nuevo si se autenticó
        if (SimpleWhatsAppService.isClientAuthenticated()) {
          console.log('Cliente autenticado automáticamente después de la espera');
          res.json({
            status: 'AUTHENTICATED',
            message: 'Cliente autenticado automáticamente'
          });
          return;
        }
      }
      
      // Definir la función para esperar el QR con timeout
      const waitForQR = async (): Promise<string | null> => {
        return new Promise<string | null>((resolve) => {
          // Comprobar primero si ya está autenticado
          if (SimpleWhatsAppService.isClientAuthenticated()) {
            console.log('Cliente ya autenticado al inicio de waitForQR');
            resolve(null);
            return;
          }

          // Comprobar si ya hay un QR existente
          const existingQR = SimpleWhatsAppService.getQRCode();
          if (existingQR) {
            console.log('QR existente encontrado en waitForQR');
            resolve(existingQR);
            return;
          }

          // Establecer timeout para evitar esperar indefinidamente
          const qrTimeout = setTimeout(() => {
            console.log(`Timeout esperando QR después de ${timeoutMs}ms`);
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            clearInterval(checkExistingQR);
            resolve(null);
          }, timeoutMs);

          // Función para manejar el evento de QR
          const onQR = (qr: string) => {
            console.log('Evento QR recibido');
            clearTimeout(qrTimeout);
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            clearInterval(checkExistingQR);
            resolve(qr);
          };

          // Función para manejar el evento de autenticación
          const onAuthenticated = () => {
            console.log('Evento authenticated recibido durante waitForQR');
            clearTimeout(qrTimeout);
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            clearInterval(checkExistingQR);
            resolve(null);
          };

          // Verificar periódicamente si hay un QR existente (por si se perdió el evento)
          const checkExistingQR = setInterval(() => {
            const qr = SimpleWhatsAppService.getQRCode();
            if (qr) {
              console.log('QR encontrado durante verificación periódica');
              clearTimeout(qrTimeout);
              SimpleWhatsAppService.removeListener('qr', onQR);
              SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
              clearInterval(checkExistingQR);
              resolve(qr);
            }
            
            // También verificar si se autenticó
            if (SimpleWhatsAppService.isClientAuthenticated()) {
              console.log('Cliente autenticado durante verificación periódica');
              clearTimeout(qrTimeout);
              SimpleWhatsAppService.removeListener('qr', onQR);
              SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
              clearInterval(checkExistingQR);
              resolve(null);
            }
          }, 1000);

          // Registrar listeners para eventos de QR y autenticación
          SimpleWhatsAppService.on('qr', onQR);
          SimpleWhatsAppService.on('authenticated', onAuthenticated);
        });
      };
      
      // Esperar por el QR con timeout
      console.log(`Esperando QR (timeout: ${timeoutMs}ms)`);
      const qr = await waitForQR();
      
      if (qr) {
        console.log('QR recibido, enviando respuesta');
        res.json({
          status: 'NEED_SCAN',
          qr
        });
      } else if (SimpleWhatsAppService.isClientAuthenticated()) {
        console.log('Cliente autenticado después de esperar QR');
        res.json({
          status: 'AUTHENTICATED',
          message: 'Cliente autenticado'
        });
      } else {
        console.log('Timeout esperando QR, enviando error');
        res.status(408).json({
          status: 'TIMEOUT',
          message: 'Timeout esperando código QR'
        });
      }
    } catch (error: any) {
      console.error('Error en generateQR:', error);
      res.status(500).json({
        status: 'ERROR',
        message: 'Error generando código QR',
        error: error.message || 'Error desconocido'
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
      // Obtener el parámetro since de los query params (horas atrás)
      const since = req.query.since ? parseInt(req.query.since as string) : 24;
      
      if (!groupName) {
        res.status(400).json({
          success: false,
          message: 'Se requiere el nombre del grupo'
        });
        return;
      }
      
      console.log(`Obteniendo métricas para grupo "${groupName}" con since=${since} horas`);
      const metrics = await SimpleWhatsAppService.getGroupMetrics(groupName, since);
      
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