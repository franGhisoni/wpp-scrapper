import { Client, NoAuth, GroupChat } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { GroupMember } from '../models/GroupMember';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
import axios from 'axios';
import GroupMemberRepository from '../repositories/GroupMemberRepository';

// Cargar variables de entorno
dotenv.config();

// Tipos para métricas
export interface GroupMetrics {
  totalMembers: number;
  newMembers: GroupMember[];
  leftMembers: GroupMember[];
  groupName: string;
  scanDate: Date;
}

/**
 * Servicio para WhatsApp Web
 */
class WhatsAppService extends EventEmitter {
  private client: Client | null = null;
  private qrCode: string | null = null;
  private isAuthenticated: boolean = false;
  private authError: string | null = null;
  private static instance: WhatsAppService;
  private isInitializing: boolean = false;
  private clientId: string = 'whatsapp-api';
  private autoCloseTimeout: NodeJS.Timeout | null = null;
  private authTimeoutTimer: NodeJS.Timeout | null = null;
  private previousMembers: Record<string, GroupMember[]> = {};
  private scanning: boolean = false;
  private scanProgressData: {
    total: number;
    completed: number;
    successful: number;
    failed: number;
    failedGroups: string[];
  } = {
    total: 0,
    completed: 0,
    successful: 0,
    failed: 0,
    failedGroups: []
  };

  private static readonly strapiUrl: string = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
  private static readonly strapiApiToken: string = process.env.STRAPI_API_TOKEN || '';

  private constructor() {
    super();
    // Debug environment for deployment
    console.log('💬 WhatsAppService - Iniciando servicio');
    console.log('🌐 Entorno:', process.env.NODE_ENV || 'No definido (usando development por defecto)');
    console.log('🚪 Puerto:', process.env.PORT || '9877 (por defecto)');
    console.log('🔗 Strapi URL:', WhatsAppService.strapiUrl);
    console.log('🔑 Strapi API Token configurado:', WhatsAppService.strapiApiToken ? 'Sí' : 'No');
    console.log('🔍 BROWSER_HEADLESS:', process.env.BROWSER_HEADLESS || 'true (por defecto)');
    console.log('⏱️ AUTO_CLOSE_AFTER_SCAN:', process.env.AUTO_CLOSE_AFTER_SCAN || 'No definido');
    
    // Configure axios for IPv4
    const http = require('http');
    const https = require('https');
    
    // Set up IPv4 agents to avoid IPv6 issues
    const httpAgent = new http.Agent({ 
      family: 4,
      keepAlive: true,
      timeout: 120000 // Aumentar timeout para Render
    });
    
    const httpsAgent = new https.Agent({ 
      family: 4,
      keepAlive: true,
      timeout: 120000, // Aumentar timeout para Render
      rejectUnauthorized: process.env.NODE_ENV !== 'production'
    });
    
    // Apply to axios globally
    axios.defaults.httpAgent = httpAgent;
    axios.defaults.httpsAgent = httpsAgent;
    axios.defaults.timeout = 120000; // Aumentar timeout para Render
  }

  public static getInstance(): WhatsAppService {
    if (!WhatsAppService.instance) {
      WhatsAppService.instance = new WhatsAppService();
    }
    return WhatsAppService.instance;
  }

  /**
   * Inicializa el cliente de WhatsApp Web
   */
  public async initialize(maxRetries: number = 3, retryDelayMs: number = 5000): Promise<void> {
    if (this.isInitializing) {
      console.log('Inicialización ya en progreso, esperando...');
      return;
    }
    
    if (this.client && this.isAuthenticated) {
      console.log('Cliente ya inicializado y autenticado');
      return;
    }
    
    this.isInitializing = true;
    this.authError = null;
    
    // Limpiar cualquier temporizador de autenticación existente
    this.clearAuthTimeout();
    
    // Configurar el temporizador de autenticación
    this.setAuthTimeout();
    
    let retryCount = 0;
    
    try {
      console.log(`[${this.clientId}] Inicializando WhatsApp con NoAuth...`);
      
      // Si ya hay un cliente, intentar destruirlo primero
      if (this.client) {
        try {
          console.log('Destruyendo cliente anterior antes de crear uno nuevo...');
          await this.client.destroy().catch(e => console.error('Error destruyendo cliente anterior:', e));
          this.client = null;
          // Esperar un momento después de destruir el cliente
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error('Error al destruir cliente anterior:', error);
          // Continuar a pesar del error
        }
      }
      
      let initSuccess = false;
      
      while (!initSuccess && retryCount < maxRetries) {
        if (retryCount > 0) {
          console.log(`Intento ${retryCount + 1}/${maxRetries} de inicialización...`);
          // Aumentar el tiempo de espera entre reintentos
          await new Promise(resolve => setTimeout(resolve, retryDelayMs * (retryCount + 1)));
        }
        
        try {
          // Determinar si ejecutar en modo headless
          const headless = process.env.BROWSER_HEADLESS !== 'false';
          console.log(`[${this.clientId}] Configurado Puppeteer en modo headless: ${headless}`);
          
          // Inicializar cliente con NoAuth
      this.client = new Client({
            authStrategy: new NoAuth(),
        puppeteer: {
              headless: headless ? true : false,
          args: [
            '--no-sandbox',
                '--disable-extensions',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-accelerated-2d-canvas',
                '--disable-web-security',
                '--disable-features=site-per-process',
                '--allow-insecure-localhost',
                '--window-size=1280,960',
                '--disable-web-security',
                '--disable-infobars',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--ignore-ssl-errors'
              ],
              executablePath: process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
              ignoreHTTPSErrors: true,
              timeout: 120000, // Aumentado a 2 minutos
        }
      });
      
      // Configurar eventos
      this.setupEvents();
      
      // Inicializar cliente
          console.log('Iniciando cliente WhatsApp...');
      await this.client.initialize();
          
          // Esperar un momento para asegurar que el cliente está correctamente inicializado
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Verificar que el cliente está disponible y cuenta con pupPage
          if (!this.client || !this.client.pupPage) {
            throw new Error('El cliente no se inicializó correctamente o la página de Puppeteer no está disponible');
          }
          
          console.log('Cliente WhatsApp inicializado con NoAuth');
          initSuccess = true;
          
        } catch (initError) {
          console.error(`Error en intento ${retryCount + 1}/${maxRetries} de inicialización:`, initError);
          
          // Destruir el cliente si falló pero se creó
          if (this.client) {
            try {
              await this.client.destroy().catch(e => console.error('Error destruyendo cliente fallido:', e));
            } catch (destroyError) {
              console.error('Error al destruir cliente después de fallo de inicialización:', destroyError);
            }
            this.client = null;
          }
          
          retryCount++;
          
          // Si es el último intento, propagar el error
          if (retryCount >= maxRetries) {
            throw initError;
          }
        }
      }
      
    } catch (error) {
      console.error('Error al inicializar cliente WhatsApp:', error);
      this.authError = error instanceof Error ? error.message : 'Error de inicialización';
      
      // Limpiar referencias si hubo error
      if (this.client) {
        try {
          await this.client.destroy().catch(e => console.error('Error destruyendo cliente después de fallo:', e));
        } catch (destroyError) {
          console.error('Error al destruir cliente después de fallo de inicialización:', destroyError);
        }
        this.client = null;
      }
      
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Configura los eventos del cliente
   */
  private setupEvents(): void {
    if (!this.client) return;
    
    this.client.on('qr', (qr) => {
      console.log('Nuevo código QR generado');
      this.qrCode = qr;
      this.isAuthenticated = false;
      qrcode.generate(qr, { small: true });
      this.emit('qr', qr);
    });
    
    this.client.on('authenticated', () => {
      console.log('Cliente autenticado correctamente');
      this.isAuthenticated = true;
      this.qrCode = null;
      this.authError = null;
      this.clearAuthTimeout();
      this.emit('authenticated');
    });
    
    this.client.on('auth_failure', (error) => {
      console.error('Error de autenticación:', error);
      this.authError = error?.toString() || 'Error de autenticación';
      this.isAuthenticated = false;
      this.emit('auth_failure', this.authError);
    });
    
    this.client.on('ready', () => {
      console.log('Cliente listo para usar');
      this.isAuthenticated = true;
      this.authError = null;
      this.emit('ready');
    });
    
    this.client.on('disconnected', (reason) => {
      console.log('Cliente desconectado:', reason);
      this.isAuthenticated = false;
      
      // Si la razón es LOGOUT, intentar reconectar
      if (reason === 'LOGOUT') {
        console.log('Reconectando después de LOGOUT...');
        this.initialize(3, 5000).catch(error => {
          console.error('Error al reconectar:', error);
        });
      }
      
      this.emit('disconnected', reason);
    });
  }

  /**
   * Configura un temporizador para cerrar el cliente si no se autentica en el tiempo especificado
   */
  private setAuthTimeout(): void {
    // Limpiar cualquier temporizador existente primero
    this.clearAuthTimeout();
    
    // Obtener el tiempo de espera de las variables de entorno o usar 10 minutos por defecto
    const authTimeoutMinutes = parseInt(process.env.AUTH_TIMEOUT_MINUTES || '10', 10);
    const authTimeout = authTimeoutMinutes * 60 * 1000; // Convertir a milisegundos
    
    console.log(`⏱️ Configuración de timeouts:`);
    console.log(`   - AUTH_TIMEOUT_MINUTES: ${authTimeoutMinutes} minutos`);
    console.log(`   - AUTO_CLOSE_TIMEOUT: ${parseInt(process.env.AUTO_CLOSE_TIMEOUT || '300000', 10)/60000} minutos`);
    console.log(`   - AUTO_CLOSE_ENABLED: ${process.env.AUTO_CLOSE_ENABLED !== 'false' ? 'Sí' : 'No'}`);
    console.log(`   - AUTO_CLOSE_AFTER_SCAN: ${process.env.AUTO_CLOSE_AFTER_SCAN !== 'false' ? 'Sí' : 'No'}`);
    console.log(`   - FORCE_AUTO_CLOSE: ${process.env.FORCE_AUTO_CLOSE === 'true' ? 'Sí' : 'No'}`);
    
    // Crear nuevo temporizador
    this.authTimeoutTimer = setTimeout(() => {
      console.log('⚠️ Temporizador de autenticación expirado');
      
      if (!this.isAuthenticated) {
        console.log('🔒 No se autenticó en el tiempo esperado, cerrando cliente para liberar recursos...');
        this.close()
          .then(() => {
            console.log('Cliente cerrado exitosamente por timeout de autenticación');
            this.emit('auth_timeout');
          })
          .catch(error => {
            console.error('Error al cerrar cliente por timeout:', error);
            this.emit('auth_timeout_error', error);
          });
      }
    }, authTimeout);
    
    // Añadir un temporizador para mostrar advertencias cada minuto
    let remainingMinutes = authTimeoutMinutes;
    const warningInterval = setInterval(() => {
      remainingMinutes--;
      if (remainingMinutes > 0) {
        console.log(`⏰ Tiempo restante para autenticación: ${remainingMinutes} minutos`);
        this.emit('auth_timeout_warning', remainingMinutes);
      }
      
      // Limpiar el intervalo si el cliente se autentica o se cierra
      if (this.isAuthenticated || !this.authTimeoutTimer) {
        clearInterval(warningInterval);
      }
    }, 60 * 1000); // Cada minuto
  }
  
  /**
   * Limpia el temporizador de autenticación
   */
  private clearAuthTimeout(): void {
    if (this.authTimeoutTimer) {
      clearTimeout(this.authTimeoutTimer);
      this.authTimeoutTimer = null;
      console.log('Temporizador de autenticación cancelado');
    }
  }

  /**
   * Cierra el cliente y libera recursos
   */
  public async close(): Promise<void> {
    // Cancelar cierre automático si está activo
    this.cancelAutoClose();
    
    console.log(`[${this.clientId}] Iniciando cierre de cliente WhatsApp`);
    
    try {
      if (this.client) {
        try {
          // Destruir cliente para liberar recursos
          console.log(`[${this.clientId}] Destruyendo cliente`);
          await this.client.destroy()
            .catch(e => console.error(`[${this.clientId}] Error en client.destroy():`, e));
        } catch (destroyError) {
          console.error(`[${this.clientId}] Error durante destroy:`, destroyError);
        }
        
        // Limpiar la referencia del cliente
        this.client = null;
      }
      
      // Restablecer estado
      this.isAuthenticated = false;
      this.qrCode = null;
      
      console.log(`[${this.clientId}] Cierre de cliente completado con éxito`);
    } catch (error) {
      console.error(`[${this.clientId}] Error fatal durante cierre de cliente:`, error);
      throw error;
    }
  }

  /**
   * Programa el cierre automático del cliente
   */
  private scheduleAutoClose(): void {
    this.cancelAutoClose();
    
    // Leer configuración de variables de entorno
    const autoCloseEnabled = process.env.AUTO_CLOSE_ENABLED !== 'false' && 
                           process.env.AUTO_CLOSE_AFTER_SCAN !== 'false' && 
                           process.env.FORCE_AUTO_CLOSE !== 'true';
    
    const autoCloseTimeout = parseInt(process.env.AUTO_CLOSE_TIMEOUT || '300000', 10);
    
    if (autoCloseEnabled) {
      console.log(`ℹ️ Cierre automático activado. Se cerrará en ${autoCloseTimeout/60000} minutos de inactividad`);
      
      this.autoCloseTimeout = setTimeout(() => {
        console.log('ℹ️ Cerrando cliente automáticamente por inactividad...');
        this.close();
      }, autoCloseTimeout);
    } else {
      console.log('ℹ️ Cierre automático desactivado:');
      console.log(`   - AUTO_CLOSE_ENABLED: ${process.env.AUTO_CLOSE_ENABLED !== 'false' ? 'Sí' : 'No'}`);
      console.log(`   - AUTO_CLOSE_AFTER_SCAN: ${process.env.AUTO_CLOSE_AFTER_SCAN !== 'false' ? 'Sí' : 'No'}`);
      console.log(`   - FORCE_AUTO_CLOSE: ${process.env.FORCE_AUTO_CLOSE === 'true' ? 'Sí' : 'No'}`);
    }
  }

  /**
   * Cancela el cierre automático programado
   */
  private cancelAutoClose(): void {
    if (this.autoCloseTimeout) {
      clearTimeout(this.autoCloseTimeout);
      this.autoCloseTimeout = null;
      console.log('Cierre automático cancelado');
    }
  }

  /**
   * Obtiene el código QR para autenticación
   */
  public getQRCode(): string | null {
    return this.qrCode;
  }

  /**
   * Verifica si el cliente está autenticado
   */
  public isClientAuthenticated(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Obtiene el error de autenticación si existe
   * @returns El mensaje de error o null si no hay error
   */
  public getAuthError(): string | null {
    return this.authError;
  }

  /**
   * Indica si el servicio está actualmente escaneando grupos
   */
  public isScanning(): boolean {
    return this.scanning;
  }
  
  /**
   * Obtiene el progreso actual del escaneo
   */
  public getScanProgress(): {
    total: number;
    completed: number;
    successful: number;
    failed: number;
    failedGroups: string[];
    percent: number;
  } {
    const percent = this.scanProgressData.total > 0 
      ? Math.round((this.scanProgressData.completed / this.scanProgressData.total) * 100) 
      : 0;
      
    return {
      ...this.scanProgressData,
      percent
    };
  }

  /**
   * Obtiene información de un grupo
   */
  public async getGroupInfo(groupName: string): Promise<{ name: string, members: GroupMember[] }> {
    if (!this.client || !this.isAuthenticated) {
      await this.initialize();
      
      if (!this.isAuthenticated) {
        throw new Error('Cliente no autenticado. Por favor escanee el código QR.');
      }
    }
    
    // Cancelar cierre automático si está activo
    this.cancelAutoClose();
    
    try {
      console.log(`[${this.clientId}] Buscando grupo: ${groupName}...`);
      
      // Obtener chats
      const chats = await this.client!.getChats();
      console.log(`[${this.clientId}] Total chats encontrados: ${chats.length}`);
      
      const groups = chats.filter(chat => chat.isGroup);
      console.log(`[${this.clientId}] Total grupos encontrados: ${groups.length}`);
      
      console.log(`[${this.clientId}] Nombres de grupos disponibles:`);
      groups.forEach(g => console.log(`- ${g.name}`));
      
      // Buscar el grupo por nombre
      const group = groups.find(g => 
        g.name.toLowerCase() === groupName.toLowerCase() || 
        g.name.toLowerCase().includes(groupName.toLowerCase())
      ) as GroupChat;
      
      if (!group) {
        throw new Error(`Grupo "${groupName}" no encontrado. Verifique el nombre exacto en la lista anterior.`);
      }
      
      console.log(`[${this.clientId}] Grupo encontrado: ${group.name}. Obteniendo participantes...`);
      
      try {
      // Obtener participantes
      const participants = await group.participants;
      
      // Convertir a formato GroupMember
      const members = participants.map(p => ({
        phoneNumber: p.id.user,
        name: `Participante ${p.id.user}`,
        isActive: true,
        groupName: group.name,
          joinDate: new Date(),
          leftDate: null,
          id: 0, // Placeholder ID, will be assigned by Strapi
          createdAt: new Date(),
          updatedAt: new Date()
      } as GroupMember));
        
        console.log(`[${this.clientId}] Se encontraron ${members.length} participantes en el grupo ${group.name}`);
      
      // Guardar miembros actuales para métricas futuras
      this.previousMembers[group.name] = [...members];
      
      return {
        name: group.name,
        members
      };
      } catch (participantsError) {
        console.error(`[${this.clientId}] Error al obtener participantes del grupo ${group.name}:`, participantsError);
        throw new Error(`No se pudo obtener la lista de participantes de ${group.name}: ${participantsError}`);
      }
    } catch (error) {
      console.error(`[${this.clientId}] Error al obtener información del grupo:`, error);
      throw error;
    } finally {
      // Programar cierre automático
      this.scheduleAutoClose();
    }
  }

  /**
   * Obtiene métricas de un grupo
   */
  public async getGroupMetrics(groupName: string, sinceHours: number = 24): Promise<GroupMetrics> {
    try {
      // Reemplazarlo totalmente para usar el repositorio que gestiona los datos de Strapi
      console.log(`Obteniendo métricas del grupo "${groupName}" (últimas ${sinceHours} horas)...`);
      
      // Usar GroupMemberRepository para obtener métricas basadas en Strapi
      const metrics = await GroupMemberRepository.getGroupMetrics(groupName, sinceHours);
      
      console.log(`Métricas obtenidas para grupo "${groupName}": ${metrics.totalMembers} miembros, ${metrics.newMembers.length} nuevos, ${metrics.leftMembers.length} salieron`);
      
      return metrics;
    } catch (error) {
      console.error(`Error al obtener métricas del grupo "${groupName}":`, error);
      throw error;
    }
  }

  /**
   * Escanea múltiples grupos y devuelve información
   */
  public async scanGroups(groupNames: string[]): Promise<Record<string, { name: string, members: GroupMember[] }>> {
    // Verificación más rigurosa del cliente
    if (!this.client) {
      console.log('Cliente no inicializado, iniciando...');
      await this.initialize();
    }
      
    // Esperar a la autenticación si es necesario
      if (!this.isAuthenticated) {
      console.log('Cliente no autenticado. Esperando autenticación...');
      throw new Error('Cliente no autenticado. Por favor escanee el código QR primero.');
    }
    
    // Añadir un retraso para asegurar que el cliente esté completamente listo
    console.log('Cliente autenticado. Esperando 5 segundos para asegurar que esté listo...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verificar nuevamente el estado del cliente
    if (!this.client || !this.client.pupPage) {
      console.error('Error: El cliente o la página de Puppeteer no están disponibles');
      throw new Error('El cliente de WhatsApp no está correctamente inicializado. Intente reiniciar la aplicación.');
    }
    
    // Cancelar cierre automático si está activo
    this.cancelAutoClose();
    
    // Inicializar estado de escaneo
    this.scanning = true;
    this.scanProgressData = {
      total: groupNames.length,
      completed: 0,
      successful: 0,
      failed: 0,
      failedGroups: []
    };
    
    const results: Record<string, { name: string, members: GroupMember[] }> = {};
    const failedGroups: string[] = [];
    
    // Aumentar el timeout por grupo significativamente
    const groupTimeout = 300000; // 5 minutos máximo por grupo
    console.log(`[${this.clientId}] Timeout por grupo configurado a ${groupTimeout/1000} segundos`);
    
    try {
      // Primero obtener todos los chats una sola vez para mejorar rendimiento
      console.log(`[${this.clientId}] Obteniendo lista completa de chats...`);
      
      // Verificar cliente nuevamente antes de llamar a getChats
      if (!this.client) {
        throw new Error('Cliente no disponible antes de obtener chats');
      }
      
      const allChats = await this.client.getChats();
      console.log(`[${this.clientId}] Total chats obtenidos: ${allChats.length}`);
      
      const allGroups = allChats.filter(chat => chat.isGroup);
      console.log(`[${this.clientId}] Total grupos disponibles: ${allGroups.length}`);
      
      // Listar todos los grupos disponibles para referencia
      console.log(`[${this.clientId}] Grupos disponibles:`);
      allGroups.forEach(g => console.log(`- ${g.name}`));
    
    for (const groupName of groupNames) {
      try {
          console.log(`[${this.clientId}] Escaneando grupo: ${groupName}...`);
          
          // Crear una promesa con timeout para cada grupo
          const groupPromise = new Promise<{ name: string, members: GroupMember[] } | null>(async (resolve) => {
            const timer = setTimeout(() => {
              console.log(`[${this.clientId}] ⚠️ Timeout al escanear grupo ${groupName} después de ${groupTimeout/1000} segundos`);
              resolve(null);
            }, groupTimeout);
            
            try {
              // Buscar grupo en la lista ya obtenida primero (más rápido)
              const foundGroup = allGroups.find(g => 
                g.name.toLowerCase() === groupName.toLowerCase() || 
                g.name.toLowerCase().includes(groupName.toLowerCase())
              ) as GroupChat;
              
              if (!foundGroup) {
                throw new Error(`Grupo "${groupName}" no encontrado en la lista de grupos disponibles.`);
              }
              
              console.log(`[${this.clientId}] Grupo encontrado: ${foundGroup.name}. Obteniendo participantes...`);
              
              // Intentar obtener participantes con reintentos
              let participants = null;
              let retryCount = 0;
              const maxRetries = 3;
              
              while (!participants && retryCount < maxRetries) {
                try {
                  participants = await foundGroup.participants;
                } catch (error) {
                  retryCount++;
                  if (retryCount < maxRetries) {
                    console.log(`[${this.clientId}] Reintentando obtener participantes (intento ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
                  } else {
                    throw error;
                  }
                }
              }
              
              if (!participants) {
                throw new Error('No se pudieron obtener los participantes después de varios intentos');
              }
              
              // Convertir a formato GroupMember
              const members = participants.map(p => {
                // Usar la fecha actual como join_date
                const joinDate = new Date();
                return {
                  phoneNumber: p.id.user,
                  name: `Participante ${p.id.user}`,
                  isActive: true,
                  groupName: foundGroup.name,
                  joinDate: joinDate,
                  leftDate: null,
                  id: 0,
                  createdAt: new Date(),
                  updatedAt: new Date()
                } as GroupMember;
              });
              
              console.log(`[${this.clientId}] Se encontraron ${members.length} participantes en el grupo ${foundGroup.name}`);
              
              // Guardar miembros actuales para métricas futuras
              this.previousMembers[foundGroup.name] = [...members];
              
              // Guardar en Strapi con reintentos
              let strapiSuccess = false;
              retryCount = 0;
              
              while (!strapiSuccess && retryCount < maxRetries) {
                try {
                  if (!WhatsAppService.strapiApiToken) {
                    console.log(`[${this.clientId}] ⚠️ No se puede guardar en Strapi: STRAPI_API_TOKEN no configurado`);
                    strapiSuccess = true; // Considerar como éxito si no hay token
                  } else {
                    await WhatsAppService.saveGroupToStrapi(foundGroup.name, members);
                    console.log(`[${this.clientId}] ✅ Guardado en Strapi: ${foundGroup.name} con ${members.length} miembros`);
                    strapiSuccess = true;
                  }
                } catch (strapiError) {
                  retryCount++;
                  if (retryCount < maxRetries) {
                    console.log(`[${this.clientId}] Reintentando guardar en Strapi (intento ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
                  } else {
                    console.error(`[${this.clientId}] ⚠️ Error al guardar en Strapi después de ${maxRetries} intentos:`, strapiError);
                    // No lanzar error, continuar con el proceso
                  }
                }
              }
              
              clearTimeout(timer);
              resolve({
                name: foundGroup.name,
                members
              });
            } catch (err) {
              console.error(`[${this.clientId}] Error buscando grupo ${groupName}:`, err);
              clearTimeout(timer);
              resolve(null);
            }
          });
          
          // Esperar resultado con timeout
          const info = await groupPromise;
          
          if (info) {
        results[groupName] = info;
            console.log(`[${this.clientId}] ✅ Grupo ${groupName} escaneado con éxito. Miembros: ${info.members.length}`);
            this.scanProgressData.successful++;
          } else {
            failedGroups.push(groupName);
            this.scanProgressData.failedGroups.push(groupName);
            this.scanProgressData.failed++;
            results[groupName] = { 
              name: groupName, 
              members: [] 
            };
            console.log(`[${this.clientId}] ❌ Error al escanear grupo ${groupName}`);
          }
          
          // Actualizar progreso
          this.scanProgressData.completed++;
      } catch (error) {
          console.error(`[${this.clientId}] Error al procesar grupo ${groupName}:`, error);
          failedGroups.push(groupName);
          this.scanProgressData.failedGroups.push(groupName);
          this.scanProgressData.failed++;
          this.scanProgressData.completed++;
          results[groupName] = { 
            name: groupName, 
            members: [] 
          };
        }
      }
      
      if (failedGroups.length > 0) {
        console.log(`[${this.clientId}] No se pudieron escanear ${failedGroups.length} grupos: ${failedGroups.join(', ')}`);
      }
      
      // Finalizar estado de escaneo
      this.scanning = false;
    
    // Programar cierre automático
    this.scheduleAutoClose();
    
    return results;
    } catch (error) {
      console.error('Error al escanear grupos:', error);
      
      // Asegurarse de actualizar el estado de escaneo incluso en caso de error
      this.scanning = false;
      this.scheduleAutoClose();
      
      throw error;
    }
  }

  /**
   * Guarda información de grupo en Strapi
   */
  private static async saveGroupToStrapi(groupName: string, members: GroupMember[]): Promise<void> {
    try {
      if (!WhatsAppService.strapiApiToken) {
        console.log('⚠️ No se puede guardar en Strapi: STRAPI_API_TOKEN no configurado');
        return;
      }

      const timestamp = new Date().toISOString();
      console.log(`Guardando en Strapi con URL: ${WhatsAppService.strapiUrl}`);
      
      // Forzar URL IPv4
      const strapiUrl = WhatsAppService.strapiUrl.replace('localhost', '127.0.0.1');
      
      // Verificar si la URL de Strapi es válida
      if (!strapiUrl.startsWith('http://') && !strapiUrl.startsWith('https://')) {
        throw new Error(`URL de Strapi inválida: ${strapiUrl}`);
      }
      
      try {
        // Verificar si Strapi está funcionando
        const healthCheck = await axios.get(`${strapiUrl}/api/ping`, {
          headers: { 'Authorization': `Bearer ${WhatsAppService.strapiApiToken}` },
          validateStatus: () => true,
          timeout: 5000 // 5 segundos de timeout
        });
        
        console.log(`Estado de Strapi: ${healthCheck.status} - ${healthCheck.statusText}`);
        
        if (healthCheck.status >= 400) {
          throw new Error(`Error conectando con Strapi (${healthCheck.status}): ${healthCheck.statusText}`);
        }
      } catch (pingError) {
        console.error('Error verificando Strapi:', pingError);
        console.log('⚠️ Continuando a pesar del error...');
      }
      
      // Verificar si el grupo ya existe
      console.log(`Verificando si el grupo "${groupName}" ya existe en Strapi...`);
      let groupId = null;
      
      try {
        const existingGroups = await axios.get(
          `${strapiUrl}/api/whatsapp-groups`,
          {
            params: {
              'filters[name][$eq]': groupName,
              'sort': 'createdAt:desc',
            },
            headers: {
              'Authorization': `Bearer ${WhatsAppService.strapiApiToken}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true,
            timeout: 5000 // 5 segundos de timeout
          }
        );
        
        if (existingGroups.status === 200 && existingGroups.data?.data?.length > 0) {
          const groups = existingGroups.data.data;
          if (groups.length > 1) {
            console.log(`⚠️ ADVERTENCIA: Se encontraron ${groups.length} grupos con el nombre "${groupName}". Posibles duplicados.`);
            groups.forEach((g, idx) => {
              console.log(`  Grupo #${idx+1}: ID ${g.id}, creado: ${g.attributes.createdAt || 'desconocido'}`);
            });
          }
          
          groupId = groups[0].id;
          console.log(`Usando grupo "${groupName}" con ID: ${groupId}.`);
          
          // Actualizar grupo existente
          const updateResponse = await axios.put(
            `${strapiUrl}/api/whatsapp-groups/${groupId}`,
            {
              data: {
                lastScan: timestamp,
                memberCount: members.length
              }
            },
            {
              headers: {
                'Authorization': `Bearer ${WhatsAppService.strapiApiToken}`,
                'Content-Type': 'application/json'
              },
              validateStatus: () => true,
              timeout: 5000 // 5 segundos de timeout
            }
          );
          
          if (updateResponse.status >= 400) {
            console.error(`Error al actualizar grupo (${updateResponse.status}):`);
            console.error(updateResponse.data);
          } else {
            console.log(`Grupo "${groupName}" actualizado correctamente`);
          }
        } else {
          // Si no existe, crear nuevo grupo
          console.log(`Creando nuevo grupo "${groupName}"...`);
          const groupResponse = await axios.post(
            `${strapiUrl}/api/whatsapp-groups`, 
            {
              data: {
                name: groupName,
                lastScan: timestamp,
                memberCount: members.length,
                status: 'draft'
              }
            },
            {
              headers: {
                'Authorization': `Bearer ${WhatsAppService.strapiApiToken}`,
                'Content-Type': 'application/json'
              },
              validateStatus: () => true,
              timeout: 5000 // 5 segundos de timeout
            }
          );
          
          if (groupResponse.status >= 400) {
            console.error(`Error al crear grupo (${groupResponse.status}):`);
            console.error(groupResponse.data);
            throw new Error(`Error al crear grupo: ${groupResponse.status} ${groupResponse.statusText}`);
          }
          
          if (!groupResponse.data || !groupResponse.data.data) {
            console.error('Respuesta de Strapi:', groupResponse.data);
            throw new Error('Respuesta de Strapi inválida al crear grupo');
          }
          
          groupId = groupResponse.data.data.id;
          console.log(`Grupo "${groupName}" creado con ID: ${groupId}`);
        }
      } catch (groupError) {
        console.error(`Error al verificar/crear grupo "${groupName}":`, groupError);
        throw groupError;
      }
      
      if (!groupId) {
        throw new Error(`No se pudo obtener ID del grupo "${groupName}"`);
      }
      
      // Obtener todos los miembros existentes para este grupo
      console.log(`Obteniendo miembros existentes para grupo "${groupName}" (ID: ${groupId})...`);
      let existingGroupMembers: any[] = [];
      
      try {
        const existingMembersResponse = await axios.get(
          `${strapiUrl}/api/group-members`,
          {
            params: {
              'filters[whats_app_group][id][$eq]': groupId,
              'pagination[pageSize]': 500,
            },
            headers: {
              'Authorization': `Bearer ${WhatsAppService.strapiApiToken}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true,
            timeout: 5000 // 5 segundos de timeout
          }
        );
        
        if (existingMembersResponse.status === 200 && existingMembersResponse.data?.data?.length > 0) {
          existingGroupMembers = existingMembersResponse.data.data;
          console.log(`Se encontraron ${existingGroupMembers.length} miembros existentes para el grupo`);
        } else {
          console.log(`No se encontraron miembros existentes para el grupo`);
        }
      } catch (membersListError) {
        console.error(`Error al obtener miembros existentes:`, membersListError);
        console.log('⚠️ Continuando sin verificación previa de miembros...');
      }
      
      // Crear mapa para búsqueda rápida de miembros existentes
      const memberMap = new Map();
      for (const existingMember of existingGroupMembers) {
        const phoneNumber = existingMember.attributes.phone_number;
        memberMap.set(phoneNumber, {
          id: existingMember.id,
          join_date: existingMember.attributes.Join_date,
          is_active: existingMember.attributes.is_active,
          left_date: existingMember.attributes.Left_date
        });
      }
      
      // Preparar lista de números de teléfono actuales
      const currentPhoneNumbers = new Set(members.map(m => m.phoneNumber));
      
      // Marcar los miembros que ya no están en el grupo
      const updateLeftMembersPromises = [];
      
      for (const existingMember of existingGroupMembers) {
        const phoneNumber = existingMember.attributes.phone_number;
        if (!currentPhoneNumbers.has(phoneNumber) && !existingMember.attributes.Left_date) {
          console.log(`Miembro ${phoneNumber} ya no está en el grupo, actualizando left_date`);
          updateLeftMembersPromises.push(
            axios.put(
              `${strapiUrl}/api/group-members/${existingMember.id}`,
              {
                data: {
                  Left_date: timestamp,
                  is_active: false
                }
              },
              {
                headers: {
                  'Authorization': `Bearer ${WhatsAppService.strapiApiToken}`,
                  'Content-Type': 'application/json'
                },
                validateStatus: () => true,
                timeout: 5000 // 5 segundos de timeout
              }
            ).catch(error => {
              console.error(`Error al actualizar left_date para ${phoneNumber}:`, error);
            })
          );
        }
      }
      
      // Esperar a que terminen todas las actualizaciones de left_date
      await Promise.all(updateLeftMembersPromises);
      
      // Guardar los miembros (en pequeños lotes)
      const batchSize = 50;
      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize);
        
        const saveMemberPromises = batch.map(async (member) => {
          try {
            const existingMemberInfo = memberMap.get(member.phoneNumber);
            
            if (existingMemberInfo) {
              const needsUpdate = existingMemberInfo.is_active === false || 
                                 (existingMemberInfo.left_date !== null && existingMemberInfo.left_date !== undefined);
              
              if (needsUpdate) {
                console.log(`Actualizando miembro existente ${member.phoneNumber} (ID: ${existingMemberInfo.id}) en grupo "${groupName}"`);
                const updateResponse = await axios.put(
                  `${strapiUrl}/api/group-members/${existingMemberInfo.id}`,
                  {
                    data: {
                      Left_date: null,
                      is_active: true
                    }
                  },
                  {
                    headers: {
                      'Authorization': `Bearer ${WhatsAppService.strapiApiToken}`,
                      'Content-Type': 'application/json'
                    },
                    validateStatus: () => true,
                    timeout: 5000 // 5 segundos de timeout
                  }
                );
                
                if (updateResponse.status >= 400) {
                  console.error(`Error al actualizar miembro ${member.phoneNumber}: ${updateResponse.status}`);
                  console.error(updateResponse.data);
                } else {
                  console.log(`Miembro ${member.phoneNumber} actualizado correctamente en grupo "${groupName}"`);
                }
              } else {
                console.log(`Miembro ${member.phoneNumber} ya está activo en grupo "${groupName}", no requiere actualización`);
              }
            } else {
              // Es un miembro completamente nuevo
              console.log(`Creando nuevo miembro ${member.phoneNumber} para grupo ${groupName} (ID: ${groupId})`);
              
              let joinDate = timestamp;
              if (member.joinDate instanceof Date && !isNaN(member.joinDate.getTime())) {
                joinDate = member.joinDate.toISOString();
                console.log(`Usando join_date de objeto Date: ${joinDate} para miembro ${member.phoneNumber}`);
              } else {
                console.log(`Usando fecha actual como join_date: ${joinDate} para miembro ${member.phoneNumber}`);
              }
              
              const createResponse = await axios.post(
                `${strapiUrl}/api/group-members`,
                {
                  data: {
                    phone_number: member.phoneNumber,
                    name: member.name || `Miembro ${member.phoneNumber}`,
                    is_active: true,
                    Join_date: joinDate,
                    left_date: null,
                    whats_app_group: groupId,
                    status: 'draft'
                  }
                },
                {
                  headers: {
                    'Authorization': `Bearer ${WhatsAppService.strapiApiToken}`,
                    'Content-Type': 'application/json'
                  },
                  validateStatus: () => true,
                  timeout: 5000 // 5 segundos de timeout
                }
              );
              
              if (createResponse.status >= 400) {
                console.error(`Error al crear miembro ${member.phoneNumber}: ${createResponse.status}`);
                console.error(createResponse.data);
              } else {
                console.log(`Miembro ${member.phoneNumber} creado exitosamente para grupo ${groupName}`);
              }
            }
          } catch (memberError) {
            console.error(`Error al procesar miembro ${member.phoneNumber}:`, memberError);
          }
        });
        
        await Promise.all(saveMemberPromises);
        
        console.log(`Procesado lote de ${batch.length} miembros (${i + batch.length}/${members.length})`);
      }
    } catch (error) {
      console.error('Error guardando en Strapi:', error);
      throw error;
    }
  }
}

// Exportar una única instancia
export default WhatsAppService.getInstance(); 