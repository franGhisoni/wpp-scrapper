import { Client, RemoteAuth, GroupChat, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { GroupMember } from '../models/GroupMember';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';

// Asegurar que las variables de entorno estén cargadas
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
  private clientPath: string = './.wwebjs_auth';
  private autoCloseTimeout: NodeJS.Timeout | null = null;
  private previousMembers: Record<string, GroupMember[]> = {};

  private constructor() {
    super();
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
  public async initialize(): Promise<void> {
    if (this.isInitializing) return;
    if (this.client && this.isAuthenticated) return;
    
    this.isInitializing = true;
    
    try {
      // Inicializar cliente con LocalAuth
      console.log(`[WhatsAppService] Inicializando con LocalAuth (clientId: ${this.clientId}, dataPath: ${this.clientPath})`);
      this.client = new Client({
        authStrategy: new LocalAuth({
           clientId: this.clientId, 
           dataPath: this.clientPath 
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-extensions'
          ]
        }
      });
      
      // Configurar eventos
      this.setupEvents();
      
      // Inicializar cliente
      await this.client.initialize();
      
      console.log('Cliente WhatsApp inicializado con LocalAuth');
    } catch (error: any) {
      console.error('Error al inicializar cliente WhatsApp con LocalAuth:', error);
      this.authError = error && typeof error === 'object' && 'message' in error 
        ? error.message 
        : 'Error de inicialización';
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Obtiene información de un grupo de WhatsApp
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
      // Obtener chats
      const chats = await this.client!.getChats();
      const groups = chats.filter(chat => chat.isGroup);
      
      // Buscar el grupo por nombre
      const group = groups.find(g => 
        g.name.toLowerCase() === groupName.toLowerCase() || 
        g.name.toLowerCase().includes(groupName.toLowerCase())
      ) as GroupChat;
      
      if (!group) {
        throw new Error(`Grupo "${groupName}" no encontrado.`);
      }
      
      // Obtener participantes
      const participants = await group.participants;
      
      // Convertir a formato GroupMember
      const members = participants.map(p => ({
        phoneNumber: p.id.user,
        name: `Participante ${p.id.user}`,
        isActive: true,
        groupName: group.name,
        joinDate: new Date()
      } as GroupMember));
      
      // Guardar miembros actuales para métricas futuras
      this.previousMembers[group.name] = [...members];
      
      return {
        name: group.name,
        members
      };
    } catch (error) {
      console.error('Error al obtener información del grupo:', error);
      throw error;
    } finally {
      // Programar cierre automático
      this.scheduleAutoClose();
    }
  }

  /**
   * Escanea múltiples grupos y devuelve información
   */
  public async scanGroups(groupNames: string[]): Promise<Record<string, { name: string, members: GroupMember[] }>> {
    if (!this.client || !this.isAuthenticated) {
      await this.initialize();
      
      if (!this.isAuthenticated) {
        throw new Error('Cliente no autenticado. Por favor escanee el código QR.');
      }
    }
    
    // Cancelar cierre automático si está activo
    this.cancelAutoClose();
    
    const results: Record<string, { name: string, members: GroupMember[] }> = {};
    
    for (const groupName of groupNames) {
      try {
        const info = await this.getGroupInfo(groupName);
        results[groupName] = info;
      } catch (error) {
        console.error(`Error al procesar grupo ${groupName}:`, error);
      }
    }
    
    // Programar cierre automático
    this.scheduleAutoClose();
    
    return results;
  }

  /**
   * Genera métricas de grupo comparando con escaneados anteriores
   */
  public async getGroupMetrics(groupName: string): Promise<GroupMetrics> {
    // Obtener miembros actuales
    const { members: currentMembers, name } = await this.getGroupInfo(groupName);
    
    // Obtener miembros anteriores
    const previousMembers = this.previousMembers[name] || [];
    
    // Encontrar miembros nuevos (están en currentMembers pero no en previousMembers)
    const newMembers = currentMembers.filter(current => 
      !previousMembers.some(prev => prev.phoneNumber === current.phoneNumber)
    );
    
    // Encontrar miembros que salieron (están en previousMembers pero no en currentMembers)
    const leftMembers = previousMembers.filter(prev => 
      !currentMembers.some(current => current.phoneNumber === prev.phoneNumber)
    ).map(member => ({
      ...member,
      isActive: false,
      leftDate: new Date()
    }));
    
    // Actualizar miembros anteriores para próximas métricas
    this.previousMembers[name] = [...currentMembers];
    
    return {
      totalMembers: currentMembers.length,
      newMembers,
      leftMembers,
      groupName: name,
      scanDate: new Date()
    };
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
   * Cierra el cliente y libera recursos
   */
  public async close(): Promise<void> {
    // Cancelar cierre automático si está activo
    this.cancelAutoClose();
    
    if (this.client) {
      try {
        // Intentar cerrar el cliente de manera segura
        await this.client.destroy().catch(err => {
          console.warn('Advertencia al cerrar cliente:', err.message);
        });
        console.log('Cliente cerrado correctamente');
      } catch (error) {
        console.error('Error al cerrar cliente:', error);
        // Continuar a pesar del error para limpiar los recursos
      } finally {
        this.client = null;
        this.isAuthenticated = false;
        this.qrCode = null;
        this.authError = null;
        
        // Esperar un momento para permitir liberar recursos
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Intentar limpiar cualquier archivo bloqueado
        try {
          const sessionPath = `${this.clientPath}/session-${this.clientId}`;
          if (fs.existsSync(sessionPath)) {
            console.log(`Nota: Los archivos en ${sessionPath} podrían seguir bloqueados.`);
            console.log('La aplicación intentará liberarlos en la próxima ejecución.');
          }
        } catch (err) {
          // Ignorar errores al intentar limpiar
        }
      }
    }
  }

  /**
   * Programa cierre automático del cliente
   */
  private scheduleAutoClose(): void {
    // Leer de variables de entorno
    const autoClose = process.env.AUTO_CLOSE_AFTER_SCAN === 'true';
    const timeout = parseInt(process.env.AUTO_CLOSE_TIMEOUT || '300000', 10);
    
    if (autoClose && this.client && this.isAuthenticated) {
      this.cancelAutoClose();
      
      console.log(`Programando cierre automático en ${timeout}ms`);
      this.autoCloseTimeout = setTimeout(async () => {
        console.log('Ejecutando cierre automático');
        await this.close();
      }, timeout);
    }
  }

  /**
   * Cancela el cierre automático si está programado
   */
  private cancelAutoClose(): void {
    if (this.autoCloseTimeout) {
      console.log('Cancelando cierre automático');
      clearTimeout(this.autoCloseTimeout);
      this.autoCloseTimeout = null;
    }
  }

  /**
   * Configura los eventos del cliente
   */
  private setupEvents(): void {
    if (!this.client) return;
    
    // Evento de código QR
    this.client.on('qr', (qr) => {
      this.qrCode = qr;
      this.isAuthenticated = false;
      
      // Mostrar código QR en consola
      console.log('CÓDIGO QR RECIBIDO:');
      qrcode.generate(qr, { small: true });
      
      // Emitir evento
      this.emit('qr', qr);
    });
    
    // Evento de autenticación
    this.client.on('authenticated', (session) => {
      console.log('Cliente autenticado');
      this.isAuthenticated = true;
      this.qrCode = null;
      this.authError = null;
      
      // Emitir evento
      this.emit('authenticated', session);
    });
    
    // Evento cuando el cliente está listo
    this.client.on('ready', () => {
      console.log('Cliente WhatsApp listo!');
      this.isAuthenticated = true;
      
      // Emitir evento
      this.emit('ready');
    });
    
    // Evento de desconexión
    this.client.on('disconnected', (reason) => {
      console.log('Cliente desconectado:', reason);
      this.isAuthenticated = false;
      this.qrCode = null;
      this.client = null;
      
      // Emitir evento
      this.emit('disconnected', reason);
    });
    
    // Evento de error de autenticación
    this.client.on('auth_failure', (error: any) => {
      console.error('Error de autenticación:', error);
      this.authError = error && typeof error === 'object' && 'message' in error 
        ? error.message 
        : 'Error de autenticación';
      this.isAuthenticated = false;
      
      // Emitir evento
      this.emit('auth_failure', error);
    });
  }
}

export default WhatsAppService.getInstance(); 