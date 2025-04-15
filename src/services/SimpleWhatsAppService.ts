import { Client, LocalAuth, GroupChat } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { GroupMember } from '../models/GroupMember';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
import { exec } from 'child_process';
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
  private static instance: SimpleWhatsAppService;
  private isInitializing: boolean = false;
  private clientId: string = 'whatsapp-api';
  private clientPath: string = './.wwebjs_auth';
  private autoCloseTimeout: NodeJS.Timeout | null = null;
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

  private static strapiUrl: string = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
  private static strapiApiToken: string = process.env.STRAPI_API_TOKEN || '';

  private constructor() {
    super();
    // Debug environment for deployment
    console.log('💬 SimpleWhatsAppService - Iniciando servicio');
    console.log('🌐 Entorno:', process.env.NODE_ENV || 'No definido (usando development por defecto)');
    console.log('🚪 Puerto:', process.env.PORT || '9877 (por defecto)');
    console.log('🔗 Strapi URL:', SimpleWhatsAppService.strapiUrl);
    console.log('🔑 Strapi API Token configurado:', SimpleWhatsAppService.strapiApiToken ? 'Sí' : 'No');
    console.log('🔍 BROWSER_HEADLESS:', process.env.BROWSER_HEADLESS || 'true (por defecto)');
    console.log('⏱️ AUTO_CLOSE_AFTER_SCAN:', process.env.AUTO_CLOSE_AFTER_SCAN || 'No definido');
    console.log('📁 Ruta de sesión:', this.clientPath);
    
    // Configure axios for IPv4
    const http = require('http');
    const https = require('https');
    
    // Set up IPv4 agents to avoid IPv6 issues
    const httpAgent = new http.Agent({ 
      family: 4,
      keepAlive: true,
      timeout: 60000 // Increase timeout for cloud environments
    });
    
    const httpsAgent = new https.Agent({ 
      family: 4,
      keepAlive: true,
      timeout: 60000, // Increase timeout for cloud environments
      rejectUnauthorized: process.env.NODE_ENV !== 'production' // Only disable cert validation in dev
    });
    
    // Apply to axios globally
    axios.defaults.httpAgent = httpAgent;
    axios.defaults.httpsAgent = httpsAgent;
    axios.defaults.timeout = 60000; // Increase default timeout
  }

  public static getInstance(): SimpleWhatsAppService {
    if (!SimpleWhatsAppService.instance) {
      SimpleWhatsAppService.instance = new SimpleWhatsAppService();
    }
    return SimpleWhatsAppService.instance;
  }

  /**
   * Inicializa el cliente de WhatsApp Web
   */
  public async initialize(): Promise<void> {
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
    
    try {
      console.log(`[${this.clientId}] Inicializando WhatsApp con LocalAuth...`);
      
      // Verificar y limpiar sesiones antiguas si es necesario
      await this.cleanLocalSessionIfNeeded();
      
      // Si ya hay un cliente, intentar destruirlo primero
      if (this.client) {
        try {
          console.log('Destruyendo cliente anterior antes de crear uno nuevo...');
          await this.client.destroy().catch(e => console.error('Error destruyendo cliente anterior:', e));
          this.client = null;
        } catch (error) {
          console.error('Error al destruir cliente anterior:', error);
          // Continuar a pesar del error
        }
      }
      
      // Determinar si ejecutar en modo headless
      const headless = process.env.BROWSER_HEADLESS !== 'false';
      console.log(`[${this.clientId}] Configurado Puppeteer en modo headless: ${headless}`);
      
      // Inicializar cliente con LocalAuth
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.clientId,
          dataPath: this.clientPath
        }),
        puppeteer: {
          headless: headless ? true : false, // Versión compatible con el tipo esperado boolean | "chrome"
          args: [
            '--no-sandbox', 
            '--disable-extensions',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this one doesn't works in Windows
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
          timeout: 90000, // Aumentar timeout para entornos más lentos
        }
      });
      
      // Configurar eventos
      this.setupEvents();
      
      // Inicializar cliente
      console.log('Iniciando cliente WhatsApp...');
      await this.client.initialize();
      
      // Esperar un momento para asegurar que el cliente está correctamente inicializado
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verificar que el cliente está disponible y cuenta con pupPage
      if (!this.client || !this.client.pupPage) {
        throw new Error('El cliente no se inicializó correctamente o la página de Puppeteer no está disponible');
      }
      
      console.log('Cliente WhatsApp inicializado con LocalAuth');
      
      // Si el cliente no emitió un evento de autenticación en unos segundos, verificar el estado
      setTimeout(() => {
        if (!this.isAuthenticated && this.client) {
          console.log('Verificando estado de autenticación después de inicialización...');
          // Solo para diagnóstico - no cambiar el estado
        }
      }, 5000);
      
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
              
              const participants = await foundGroup.participants;
              
              // Convertir a formato GroupMember
              const members = participants.map(p => {
                // Usar la fecha actual como join_date
                const joinDate = new Date();
                return {
                  phoneNumber: p.id.user,
                  name: `Participante ${p.id.user}`,
                  isActive: true,
                  groupName: foundGroup.name,
                  joinDate: joinDate, // Asegurarse de que sea un objeto Date válido
                  leftDate: null,
                  id: 0, // Placeholder ID, will be assigned by Strapi
                  createdAt: new Date(),
                  updatedAt: new Date()
                } as GroupMember;
              });
              
              console.log(`[${this.clientId}] Se encontraron ${members.length} participantes en el grupo ${foundGroup.name}`);
              
              // Guardar miembros actuales para métricas futuras
              this.previousMembers[foundGroup.name] = [...members];
              
              // Guardar en Strapi
              try {
                await SimpleWhatsAppService.saveGroupToStrapi(foundGroup.name, members);
                console.log(`[${this.clientId}] ✅ Guardado en Strapi: ${foundGroup.name} con ${members.length} miembros`);
              } catch (strapiError) {
                console.error(`[${this.clientId}] ⚠️ Error al guardar en Strapi:`, strapiError);
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
      if (!SimpleWhatsAppService.strapiApiToken) {
        console.log('⚠️ No se puede guardar en Strapi: STRAPI_API_TOKEN no configurado');
        return;
      }

      const timestamp = new Date().toISOString();
      console.log(`Guardando en Strapi con URL: ${SimpleWhatsAppService.strapiUrl}`);
      
      // Forzar URL IPv4
      const strapiUrl = SimpleWhatsAppService.strapiUrl.replace('localhost', '127.0.0.1');
      
      try {
        // Verificar si Strapi está funcionando
        const healthCheck = await axios.get(`${strapiUrl}/api/ping`, {
          headers: { 'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}` },
          validateStatus: () => true
        });
        
        console.log(`Estado de Strapi: ${healthCheck.status} - ${healthCheck.statusText}`);
        
        if (healthCheck.status >= 400) {
          throw new Error(`Error conectando con Strapi (${healthCheck.status})`);
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
              'sort': 'createdAt:desc', // Ordenar por fecha de creación, más reciente primero
            },
            headers: {
              'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true
          }
        );
        
        if (existingGroups.status === 200 && existingGroups.data?.data?.length > 0) {
          // Si hay múltiples grupos con el mismo nombre, usar el más reciente
          // y registrar los otros como posibles duplicados
          const groups = existingGroups.data.data;
          if (groups.length > 1) {
            console.log(`⚠️ ADVERTENCIA: Se encontraron ${groups.length} grupos con el nombre "${groupName}". Posibles duplicados.`);
            groups.forEach((g, idx) => {
              console.log(`  Grupo #${idx+1}: ID ${g.id}, creado: ${g.attributes.createdAt || 'desconocido'}`);
            });
          }
          
          // Usar el primer grupo (más reciente si están ordenados)
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
                'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
                'Content-Type': 'application/json'
              },
              validateStatus: () => true
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
                memberCount: members.length
              }
            },
            {
              headers: {
                'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
                'Content-Type': 'application/json'
              },
              validateStatus: () => true
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
      
      // Obtener todos los miembros existentes para este grupo para optimizar búsquedas
      console.log(`Obteniendo miembros existentes para grupo "${groupName}" (ID: ${groupId})...`);
      let existingGroupMembers: any[] = [];
      
      try {
        const existingMembersResponse = await axios.get(
          `${strapiUrl}/api/group-members`,
          {
            params: {
              'filters[whats_app_group][id][$eq]': groupId,
              'pagination[pageSize]': 500, // Aumentar para asegurar obtener todos los miembros
            },
            headers: {
              'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true
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
      
      // Preparar lista de números de teléfono actuales para detectar miembros que se fueron
      const currentPhoneNumbers = new Set(members.map(m => m.phoneNumber));
      
      // Marcar los miembros que ya no están en el grupo con leftDate
      const updateLeftMembersPromises = [];
      
      for (const existingMember of existingGroupMembers) {
        const phoneNumber = existingMember.attributes.phone_number;
        // Si el miembro no está en la lista actual y no tiene fecha de salida
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
                  'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
                  'Content-Type': 'application/json'
                },
                validateStatus: () => true
              }
            ).catch(error => {
              console.error(`Error al actualizar left_date para ${phoneNumber}:`, error);
            })
          );
        }
      }
      
      // Esperar a que terminen todas las actualizaciones de left_date
      await Promise.all(updateLeftMembersPromises);
      
      // Guardar los miembros (en pequeños lotes para evitar problemas)
      const batchSize = 50;
      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize);
        
        const saveMemberPromises = batch.map(async (member) => {
          try {
            const existingMemberInfo = memberMap.get(member.phoneNumber);
            
            if (existingMemberInfo) {
              // Verificar si realmente necesita actualizarse (si estaba inactivo o tenía fecha de salida)
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
                      'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
                      'Content-Type': 'application/json'
                    },
                    validateStatus: () => true
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
              // Verificar explícitamente si este miembro ya existe en este grupo
              // usando los parámetros phone_number + whats_app_group
              console.log(`Verificando si ya existe miembro ${member.phoneNumber} en grupo ${groupName} (ID: ${groupId})...`);
              
              const existingMembersInGroup = await axios.get(
                `${strapiUrl}/api/group-members`,
                {
                  params: {
                    'filters[phone_number][$eq]': member.phoneNumber,
                    'filters[whats_app_group][id][$eq]': groupId
                  },
                  headers: {
                    'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
                    'Content-Type': 'application/json'
                  },
                  validateStatus: () => true
                }
              );
              
              if (existingMembersInGroup.status === 200 && existingMembersInGroup.data?.data?.length > 0) {
                // Ya existe en este grupo, actualizar solo si es necesario
                const existingMember = existingMembersInGroup.data.data[0];
                const isActive = existingMember.attributes.is_active === true;
                const hasLeftDate = existingMember.attributes.Left_date !== null && 
                                    existingMember.attributes.Left_date !== undefined;
                
                const needsUpdate = !isActive || hasLeftDate;
                
                if (needsUpdate) {
                  const existingMemberId = existingMember.id;
                  console.log(`Miembro ${member.phoneNumber} ya existe en este grupo (ID: ${existingMemberId}), actualizando estado...`);
                  
                  const updateResponse = await axios.put(
                    `${strapiUrl}/api/group-members/${existingMemberId}`,
                    {
                      data: {
                        Left_date: null,
                        is_active: true
                      }
                    },
                    {
                      headers: {
                        'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
                        'Content-Type': 'application/json'
                      },
                      validateStatus: () => true
                    }
                  );
                  
                  if (updateResponse.status >= 400) {
                    console.error(`Error al actualizar miembro ${member.phoneNumber} en grupo: ${updateResponse.status}`);
                    console.error(updateResponse.data);
                  } else {
                    console.log(`Miembro ${member.phoneNumber} actualizado correctamente en grupo ${groupName}`);
                  }
                } else {
                  console.log(`Miembro ${member.phoneNumber} ya está activo en este grupo, no requiere actualización`);
                }
              } else {
                // Es un miembro completamente nuevo para este grupo, crearlo
                console.log(`Creando nuevo miembro ${member.phoneNumber} para grupo ${groupName} (ID: ${groupId})`);
                
                // Asegurar que join_date siempre sea una fecha válida con formato ISO
                let joinDate = timestamp;
                
                // Si member.joinDate es un objeto Date válido, convertirlo a ISO string
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
                      whats_app_group: groupId
                    }
                  },
                  {
                    headers: {
                      'Authorization': `Bearer ${SimpleWhatsAppService.strapiApiToken}`,
                      'Content-Type': 'application/json'
                    },
                    validateStatus: () => true
                  }
                );
                
                if (createResponse.status >= 400) {
                  console.error(`Error al crear miembro ${member.phoneNumber}: ${createResponse.status}`);
                  console.error(createResponse.data);
                } else {
                  console.log(`Miembro ${member.phoneNumber} creado exitosamente para grupo ${groupName}`);
                }
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
    
    console.log(`[${this.clientId}] Iniciando cierre de cliente WhatsApp`);
    
    try {
      // Primero intentar un logout ordenado
      await this.logout()
        .catch(error => {
          console.error(`[${this.clientId}] Error al hacer logout durante cierre:`, error);
        });
      
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
    
    const autoCloseAfterScan = process.env.AUTO_CLOSE_AFTER_SCAN === 'true';
    
    if (autoCloseAfterScan) {
      const timeout = parseInt(process.env.AUTO_CLOSE_TIMEOUT || '180000', 10); // 3 minutos por defecto
      console.log(`Programando cierre automático en ${timeout/60000} minutos...`);
      
      this.autoCloseTimeout = setTimeout(() => {
        console.log('Cerrando cliente automáticamente por inactividad...');
        this.close();
      }, timeout);
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
      this.emit('ready');
    });
    
    this.client.on('disconnected', () => {
      console.log('Cliente desconectado');
      this.isAuthenticated = false;
      this.emit('disconnected');
    });
    
    this.client.on('remote_session_saved', () => {
      console.log('[SimpleWhatsAppService] Evento remote_session_saved recibido! La librería cree que guardó la sesión.');
    });
  }

  /**
   * Limpia los datos de sesión local si es necesario
   */
  private async cleanLocalSessionIfNeeded(): Promise<void> {
    try {
      // Comprobar si hay archivos de sesión corruptos
      const sessionDir = `${this.clientPath}/session-${this.clientId}`;
      const tempDir = `${this.clientPath}/RemoteAuth-${this.clientId}`;
      
      if (fs.existsSync(tempDir)) {
        console.log(`Encontrado directorio RemoteAuth antiguo ${tempDir}, eliminando...`);
        await this.deleteDir(tempDir);
      }
      
      if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length === 0) {
        console.log(`Sesión local vacía o inválida, limpiando...`);
        await this.cleanLocalSession();
      } else {
        console.log(`Sesión local parece válida, intentando usarla...`);
      }
    } catch (error) {
      console.error('Error al verificar sesión local:', error);
    }
  }

  /**
   * Elimina un directorio de forma asíncrona con manejo de errores
   * @param dirPath Ruta del directorio a eliminar
   */
  private async deleteDir(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      console.log(`El directorio ${dirPath} no existe, omitiendo...`);
      return;
    }
    
    // Esperar para asegurar que los archivos no estén en uso
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      // Usar fs.promises.rm que es asíncrono y maneja recursividad
      console.log(`Intentando eliminar directorio ${dirPath} con fs.promises.rm...`);
      await fs.promises.rm(dirPath, { recursive: true, force: true });
      return;
    } catch (error: any) {
      console.error(`[${this.clientId}] Error al eliminar directorio con fs.promises.rm:`, error);
      
      // Si falla por archivos bloqueados, esperar y continuar sin error
      if (error && error.code && ['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
        console.log(`[${this.clientId}] Archivos bloqueados en ${dirPath}, se ignorará y continuará...`);
        return;
      }
      
      // Fallback: usar comandos del sistema según la plataforma
      try {
        if (process.platform === 'win32') {
          // En Windows, usar rd /s /q
          console.log(`Intentando eliminar ${dirPath} con comando 'rd'...`);
          await new Promise((resolve, reject) => {
            exec(`rd /s /q "${dirPath}"`, (error, stdout, stderr) => {
              if (error) {
                console.error(`[${this.clientId}] Error en comando rd:`, stderr);
                // No rechazar para continuar a pesar de errores
                resolve(null);
                return;
              }
              resolve(stdout);
            });
          });
        } else {
          // En Unix/Linux/Mac, usar rm -rf
          console.log(`Intentando eliminar ${dirPath} con comando 'rm -rf'...`);
          await new Promise((resolve, reject) => {
            exec(`rm -rf "${dirPath}"`, (error, stdout, stderr) => {
              if (error) {
                console.error(`[${this.clientId}] Error en comando rm:`, stderr);
                // No rechazar para continuar a pesar de errores
                resolve(null);
                return;
              }
              resolve(stdout);
            });
          });
        }
      } catch (cmdError) {
        console.error(`[${this.clientId}] Error al eliminar directorio con comando del sistema:`, cmdError);
        // No lanzar error para permitir continuar
        console.log(`[${this.clientId}] Se ignorará el error y continuará...`);
      }
    }
  }

  /**
   * Cierra la sesión de WhatsApp y limpia recursos
   * @returns Promise que resuelve cuando se completa el proceso de logout
   */
  public async logout(): Promise<void> {
    console.log(`[${this.clientId}] Iniciando proceso de logout`);
    
    try {
      if (this.client) {
        try {
          // Intentar logout normal primero
          console.log(`[${this.clientId}] Ejecutando client.logout()`);
          await this.client.logout()
            .catch(e => console.error(`[${this.clientId}] Error en client.logout():`, e));
        } catch (logoutError) {
          console.error(`[${this.clientId}] Error durante logout:`, logoutError);
        }
        
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
      
      // Emitir evento de logout
      this.emit('logout', this.clientId);
      
      // Esperar 2 segundos para asegurar que los archivos no estén en uso
      console.log(`[${this.clientId}] Esperando 2 segundos antes de limpiar archivos de sesión...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Limpiar archivos de sesión local
      await this.cleanLocalSession();
      
      console.log(`[${this.clientId}] Proceso de logout completado con éxito`);
    } catch (error) {
      console.error(`[${this.clientId}] Error fatal durante el proceso de logout:`, error);
      throw error;
    }
  }
  
  /**
   * Limpia los archivos de sesión local
   * @returns Promise que resuelve cuando se completa la limpieza
   */
  public async cleanLocalSession(): Promise<void> {
    console.log(`[${this.clientId}] Iniciando limpieza de archivos de sesión local`);
    
    // Directorios a limpiar
    const directories = [
      // Directorio RemoteAuth (sesiones antiguas)
      `${this.clientPath}/RemoteAuth-${this.clientId}`,
      // Directorio LocalAuth
      `${this.clientPath}/session-${this.clientId}`
    ];
    
    for (const dir of directories) {
      try {
        console.log(`[${this.clientId}] Eliminando directorio: ${dir}`);
        await this.deleteDir(dir);
        console.log(`[${this.clientId}] Directorio eliminado: ${dir}`);
      } catch (error) {
        console.error(`[${this.clientId}] Error al eliminar directorio ${dir}:`, error);
        
        // Intentar nuevamente después de un tiempo
        console.log(`[${this.clientId}] Esperando 5 segundos para reintentar eliminación...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
          console.log(`[${this.clientId}] Reintentando eliminar directorio: ${dir}`);
          await this.deleteDir(dir);
          console.log(`[${this.clientId}] Directorio eliminado en segundo intento: ${dir}`);
        } catch (retryError) {
          console.error(`[${this.clientId}] Error al reintentar eliminación de ${dir}:`, retryError);
          // No lanzar error, continuar con los demás directorios
        }
      }
    }
    
    console.log(`[${this.clientId}] Limpieza de archivos de sesión local completada`);
  }

  /**
   * Elimina un directorio recursivamente
   * @deprecated Usar la versión asíncrona deleteDir
   */
  private synchronousDeleteDir(dir: string): void {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        const curPath = `${dir}/${file}`;
        if (fs.lstatSync(curPath).isDirectory()) {
          this.synchronousDeleteDir(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(dir);
    }
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
}

export default SimpleWhatsAppService.getInstance();