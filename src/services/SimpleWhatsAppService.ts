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
 * Servicio simple para WhatsApp Web
 */
class SimpleWhatsAppService extends EventEmitter {
  private client: Client | null = null;
  private qrCode: string | null = null;
  private isAuthenticated: boolean = false;
  private authError: string | null = null;
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

  // Configuraciones de rendimiento
  private static readonly initialWaitMs: number = parseInt(process.env.INITIAL_WAIT_MS || '2000', 10);
  private static readonly groupTimeoutMs: number = parseInt(process.env.GROUP_TIMEOUT_MS || '300000', 10);
  private static readonly strapiTimeoutMs: number = parseInt(process.env.STRAPI_TIMEOUT_MS || '5000', 10);
  private static readonly strapiRetryDelayMs: number = parseInt(process.env.STRAPI_RETRY_DELAY_MS || '1000', 10);
  private static readonly maxRetries: number = parseInt(process.env.MAX_RETRIES || '3', 10);
  private static readonly batchSize: number = parseInt(process.env.BATCH_SIZE || '100', 10);
  private static readonly maxConcurrentRequests: number = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '10', 10);

  constructor() {
    super();
    // Debug environment for deployment
    console.log('💬 WhatsAppService - Iniciando servicio');
    console.log('🌐 Entorno:', process.env.NODE_ENV || 'No definido (usando development por defecto)');
    console.log('🚪 Puerto:', process.env.PORT || '9877 (por defecto)');
    console.log('🔗 Strapi URL:', SimpleWhatsAppService.strapiUrl);
    console.log('🔑 Strapi API Token configurado:', SimpleWhatsAppService.strapiApiToken ? 'Sí' : 'No');
    console.log('🔍 BROWSER_HEADLESS:', process.env.BROWSER_HEADLESS || 'true (por defecto)');
    console.log('⏱️ AUTO_CLOSE_AFTER_SCAN:', process.env.AUTO_CLOSE_AFTER_SCAN || 'No definido');
    
    // Log de configuraciones de rendimiento
    console.log('⚡ Configuraciones de rendimiento:');
    console.log(`   - INITIAL_WAIT_MS: ${SimpleWhatsAppService.initialWaitMs}ms`);
    console.log(`   - GROUP_TIMEOUT_MS: ${SimpleWhatsAppService.groupTimeoutMs}ms`);
    console.log(`   - STRAPI_TIMEOUT_MS: ${SimpleWhatsAppService.strapiTimeoutMs}ms`);
    console.log(`   - STRAPI_RETRY_DELAY_MS: ${SimpleWhatsAppService.strapiRetryDelayMs}ms`);
    console.log(`   - MAX_RETRIES: ${SimpleWhatsAppService.maxRetries}`);
    console.log(`   - BATCH_SIZE: ${SimpleWhatsAppService.batchSize}`);
    console.log(`   - MAX_CONCURRENT_REQUESTS: ${SimpleWhatsAppService.maxConcurrentRequests}`);
    
    // Configure axios for IPv4
    const http = require('http');
    const https = require('https');
    
    // Set up IPv4 agents to avoid IPv6 issues
    const httpAgent = new http.Agent({ 
      family: 4,
      keepAlive: true,
      timeout: SimpleWhatsAppService.strapiTimeoutMs
    });
    
    const httpsAgent = new https.Agent({ 
      family: 4,
      keepAlive: true,
      timeout: SimpleWhatsAppService.strapiTimeoutMs,
      rejectUnauthorized: process.env.NODE_ENV !== 'production'
    });
    
    // Apply to axios globally
    axios.defaults.httpAgent = httpAgent;
    axios.defaults.httpsAgent = httpsAgent;
    axios.defaults.timeout = SimpleWhatsAppService.strapiTimeoutMs;
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
    
    // Reducir el tiempo de espera según la configuración
    console.log(`Cliente autenticado. Esperando ${SimpleWhatsAppService.initialWaitMs}ms para asegurar que esté listo...`);
    await new Promise(resolve => setTimeout(resolve, SimpleWhatsAppService.initialWaitMs));
    
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
    
    // Usar el timeout configurado por grupo
    const groupTimeout = SimpleWhatsAppService.groupTimeoutMs;
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
              
              // Intentar obtener participantes con reintentos configurados
              let participants = null;
              let retryCount = 0;
              const maxRetries = SimpleWhatsAppService.maxRetries;
              
              while (!participants && retryCount < maxRetries) {
                try {
                  participants = await foundGroup.participants;
                } catch (error) {
                  retryCount++;
                  if (retryCount < maxRetries) {
                    console.log(`[${this.clientId}] Reintentando obtener participantes (intento ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, SimpleWhatsAppService.strapiRetryDelayMs * retryCount));
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
              
              // Guardar en Strapi con reintentos configurados
              let strapiSuccess = false;
              retryCount = 0;
              
              while (!strapiSuccess && retryCount < maxRetries) {
              try {
                if (!SimpleWhatsAppService.strapiApiToken) {
                  console.log(`[${this.clientId}] ⚠️ No se puede guardar en Strapi: STRAPI_API_TOKEN no configurado`);
                    strapiSuccess = true;
                } else {
                    await SimpleWhatsAppService.saveGroupToStrapi({
                      name: foundGroup.name,
                      members
                    });
                  console.log(`[${this.clientId}] ✅ Guardado en Strapi: ${foundGroup.name} con ${members.length} miembros`);
                    strapiSuccess = true;
                }
              } catch (strapiError) {
                  retryCount++;
                  if (retryCount < maxRetries) {
                    console.log(`[${this.clientId}] Reintentando guardar en Strapi (intento ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, SimpleWhatsAppService.strapiRetryDelayMs * retryCount));
                  } else {
                    console.error(`[${this.clientId}] ⚠️ Error al guardar en Strapi después de ${maxRetries} intentos:`, strapiError);
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
   * Guarda la información del grupo en Strapi
   * @param groupInfo Objeto con información del grupo
   * @returns Respuesta de la API de Strapi
   */
  static async saveGroupToStrapi(groupInfo: any): Promise<any> {
    console.log(`Guardando grupo ${groupInfo.name || 'desconocido'} en Strapi...`);
    try {
      // Obtenemos la URL y el token de las variables de entorno
      const strapiUrl = process.env.STRAPI_URL || 'http://localhost:1337';
      const strapiToken = process.env.STRAPI_TOKEN;

      if (!strapiToken) {
        console.warn('STRAPI_TOKEN no configurado, no se guardará en Strapi');
        return null;
      }

      // Construimos la URL de la API
      const apiUrl = `${strapiUrl}/api/whatsapp-groups`;

      // Configuramos los headers
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${strapiToken}`
      };

      // Realizamos la solicitud a Strapi
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: groupInfo
        })
      });

      // Verificamos si la respuesta fue exitosa
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error al guardar en Strapi: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Parseamos la respuesta
      const data = await response.json();
      console.log(`Grupo ${groupInfo.name || 'desconocido'} guardado en Strapi correctamente`);
      return data;
    } catch (error) {
      console.error('Error guardando grupo en Strapi:', error);
      throw error;
    }
  }
}

// Exportar una única instancia
export default new SimpleWhatsAppService();