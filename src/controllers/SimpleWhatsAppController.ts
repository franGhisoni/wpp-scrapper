import { Request, Response } from 'express';
import SimpleWhatsAppService from '../services/SimpleWhatsAppService';
import fs from 'fs';
import qrcode from 'qrcode';

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
        
        // Convertir el QR string a imagen base64
        try {
          const qrBase64 = await qrcode.toDataURL(existingQR);
          
          res.json({
            status: 'NEED_SCAN',
            qr: existingQR,
            qrImage: qrBase64 // Incluir la imagen en base64
          });
        } catch (qrError) {
          console.error('Error generando imagen QR:', qrError);
          
          // Enviar solo el string QR si hay error en la conversión
          res.json({
            status: 'NEED_SCAN',
            qr: existingQR
          });
        }
        return;
      }
      
      // Verificar si existe un directorio de sesión previa
      const sessionDir = './.wwebjs_auth/session-whatsapp-api';
      const sessionExists = fs.existsSync(sessionDir);
      console.log(`Verificando existencia de sesión en ${sessionDir}: ${sessionExists}`);
      
      // Inicializar cliente WhatsApp
      console.log('Inicializando cliente WhatsApp');
      
      // Parámetro para indicar si debemos limpiar la sesión si falla la autenticación
      // Solo limpiar si el request viene explícitamente para generar un nuevo QR
      const cleanFailedSession = req.query.forceNew === 'true' || false;
      console.log(`Configurado para limpiar sesión si falla: ${cleanFailedSession}`);
      
      await SimpleWhatsAppService.initialize(cleanFailedSession);
      
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
      
      // Función para esperar el QR sin timeout
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

          // Función para manejar el evento de QR
          const onQR = (qr: string) => {
            console.log('Evento QR recibido');
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
            clearInterval(checkExistingQR);
            resolve(qr);
          };

          // Función para manejar el evento de autenticación
          const onAuthenticated = () => {
            console.log('Evento authenticated recibido durante waitForQR');
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
            clearInterval(checkExistingQR);
            resolve(null);
          };
          
          // Función para manejar el evento de fallo de autenticación
          const onAuthFailure = (error: string) => {
            console.log(`Evento auth_failure recibido: ${error}`);
            SimpleWhatsAppService.removeListener('qr', onQR);
            SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
            SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
            clearInterval(checkExistingQR);
            // Mantenemos el resolve como null para que el controlador pueda manejarlo
            resolve(null);
          };

          // Verificar periódicamente si hay un QR existente (por si se perdió el evento)
          const checkExistingQR = setInterval(() => {
            const qr = SimpleWhatsAppService.getQRCode();
            if (qr) {
              console.log('QR encontrado durante verificación periódica');
              SimpleWhatsAppService.removeListener('qr', onQR);
              SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
              SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
              clearInterval(checkExistingQR);
              resolve(qr);
            }
            
            // También verificar si se autenticó
            if (SimpleWhatsAppService.isClientAuthenticated()) {
              console.log('Cliente autenticado durante verificación periódica');
              SimpleWhatsAppService.removeListener('qr', onQR);
              SimpleWhatsAppService.removeListener('authenticated', onAuthenticated);
              SimpleWhatsAppService.removeListener('auth_failure', onAuthFailure);
              clearInterval(checkExistingQR);
              resolve(null);
            }
          }, 1000);

          // Registrar listeners para eventos de QR, autenticación y fallo
          SimpleWhatsAppService.on('qr', onQR);
          SimpleWhatsAppService.on('authenticated', onAuthenticated);
          SimpleWhatsAppService.on('auth_failure', onAuthFailure);
        });
      };
      
      // Esperar por el QR sin timeout
      console.log('Esperando QR (sin timeout)...');
      const qr = await waitForQR();
      
      if (qr) {
        console.log('QR recibido, enviando respuesta');
        
        // Convertir el QR string a imagen base64
        try {
          const qrBase64 = await qrcode.toDataURL(qr);
          
          res.json({
            status: 'NEED_SCAN',
            qr: qr,
            qrImage: qrBase64 // Incluir la imagen en base64
          });
        } catch (qrError) {
          console.error('Error generando imagen QR:', qrError);
          
          // Enviar solo el string QR si hay error en la conversión
          res.json({
            status: 'NEED_SCAN',
            qr: qr
          });
        }
      } else if (SimpleWhatsAppService.isClientAuthenticated()) {
        console.log('Cliente autenticado después de esperar QR');
        res.json({
          status: 'AUTHENTICATED',
          message: 'Cliente autenticado'
        });
      } else {
        // Si llegamos aquí, puede ser por un fallo de autenticación
        console.log('No se obtuvo QR ni se autenticó, verificando errores...');
        const authError = SimpleWhatsAppService.getAuthError();
        
        if (authError) {
          console.log(`Error de autenticación detectado: ${authError}`);
          res.status(401).json({
            status: 'AUTH_ERROR',
            message: 'Error de autenticación',
            error: authError
          });
        } else {
          console.log('No se pudo obtener QR por razones desconocidas');
          res.status(500).json({
            status: 'ERROR',
            message: 'No se pudo generar o recibir el código QR'
          });
        }
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
   * Genera una imagen QR para escanear directamente
   */
  async generateQRImage(req: Request, res: Response): Promise<void> {
    try {
      // Verificar si ya está autenticado
      if (SimpleWhatsAppService.isClientAuthenticated()) {
        res.status(400).json({
          status: 'AUTHENTICATED',
          message: 'Cliente ya autenticado, no se requiere QR'
        });
        return;
      }
      
      // Verificar si ya existe un QR
      const existingQR = SimpleWhatsAppService.getQRCode();
      if (!existingQR) {
        // Si no hay QR disponible, iniciar proceso para obtenerlo
        console.log('No hay QR disponible, inicializando cliente...');
        await SimpleWhatsAppService.initialize();
        
        // Esperar hasta 10 segundos para que se genere el QR
        let attempts = 0;
        let qrCode = null;
        while (!qrCode && attempts < 10) {
          qrCode = SimpleWhatsAppService.getQRCode();
          if (!qrCode) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
        }
        
        if (!qrCode) {
          res.status(500).json({
            status: 'ERROR',
            message: 'No se pudo generar código QR en el tiempo esperado'
          });
          return;
        }
      }
      
      const qrCodeString = SimpleWhatsAppService.getQRCode();
      
      // Configurar la respuesta como imagen PNG
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      
      // Generar la imagen QR directamente en la respuesta
      qrcode.toFileStream(res, qrCodeString!, {
        type: 'png',
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      
    } catch (error: any) {
      console.error('Error generando imagen QR:', error);
      res.status(500).json({
        status: 'ERROR',
        message: 'Error generando imagen QR',
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
      // Uso close(false) para asegurar que se eliminen los archivos de sesión
      await SimpleWhatsAppService.close(false);
      
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
   * Esta función es útil cuando el sistema está en un estado inconsistente
   */
  async cleanup(req: Request, res: Response): Promise<void> {
    try {
      console.log('Iniciando limpieza de recursos...');
      
      // Forzar cierre con forceClean = true para eliminar archivos si es necesario
      const forceClean = req.query.force === 'true';
      
      if (forceClean) {
        console.log('Limpieza forzada solicitada, se eliminarán archivos de sesión');
        // Cerrar cliente y eliminar archivos de sesión
        await SimpleWhatsAppService.close(false);
        
        // Limpiar sesión localmente
        await SimpleWhatsAppService.cleanLocalSession();
        
        res.status(200).json({
          success: true,
          message: 'Recursos liberados y sesión eliminada correctamente'
        });
      } else {
        // Solo cierre suave, conservando sesión
        await SimpleWhatsAppService.close(true);
        
        res.status(200).json({
          success: true,
          message: 'Recursos liberados correctamente (sesión preservada)'
        });
      }
    } catch (error) {
      console.error('Error durante la limpieza de recursos:', error);
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

  /**
   * Obtiene estado detallado para integración API-a-API
   * Este método está optimizado para minimizar uso de QR
   */
  async getApiStatus(req: Request, res: Response): Promise<void> {
    try {
      // Verificar si existe un directorio de sesión
      const sessionDir = './.wwebjs_auth/session-whatsapp-api';
      const sessionExists = fs.existsSync(sessionDir);
      const sessionValid = sessionExists && fs.readdirSync(sessionDir).length > 0;
      
      // Verificar si ya está autenticado
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
      } else if (sessionValid) {
        status = 'SESSION_AVAILABLE';
      } else {
        status = 'NO_SESSION';
      }
      
      // Determinar acciones recomendadas para la API
      let nextAction = '';
      let requiresHuman = false;
      
      switch (status) {
        case 'AUTHENTICATED':
          nextAction = 'CONTINUE';
          requiresHuman = false;
          break;
        case 'SESSION_AVAILABLE':
          nextAction = 'INITIALIZE';
          requiresHuman = false;
          break;
        case 'NEED_SCAN':
          nextAction = 'SCAN_QR';
          requiresHuman = true;
          break;
        case 'AUTH_ERROR':
          nextAction = 'RESET_SESSION';
          requiresHuman = true;
          break;
        case 'NO_SESSION':
          nextAction = 'CREATE_SESSION';
          requiresHuman = true;
          break;
      }
      
      res.status(200).json({
        success: true,
        data: {
          status,
          authenticated: isAuthenticated,
          sessionExists: sessionExists,
          sessionValid: sessionValid,
          qrAvailable: !!qrCode,
          qrCode: qrCode, // Solo presente si hay QR disponible
          error: authError,
          nextAction,
          requiresHuman,
          timestamp: new Date().toISOString(),
          reconnectAttempt: req.query.attempt ? parseInt(req.query.attempt as string) : 0
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido',
        error: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }
}

export default new SimpleWhatsAppController(); 