import { Client, GroupChat } from 'whatsapp-web.js';
import { GroupMember } from '../models/GroupMember';
import { config } from '../config';
import { retry } from '../utils/RetryHelper';
import logger from '../utils/logger';

export interface ScanResult {
  name: string;
  members: GroupMember[];
  error?: string;
  success: boolean;
}

export class GroupScanner {
  constructor(
    private client: Client,
    private clientId: string
  ) {}

  /**
   * Implementación de timeout simple
   */
  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    errorMessage = 'Operation timed out'
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Escanea múltiples grupos y devuelve sus miembros
   */
  public async scanGroups(groupNames: string[]): Promise<Record<string, ScanResult>> {
    logger.info({ count: groupNames.length }, 'Iniciando escaneo de grupos');
    
    const results: Record<string, ScanResult> = {};
    
    // Primero obtener todos los chats una sola vez para mejorar rendimiento
    logger.info('Obteniendo lista completa de chats...');
    
    if (!this.client) {
      throw new Error('Cliente no disponible antes de obtener chats');
    }
    
    const allChats = await this.withTimeout(
      () => this.client.getChats(),
      30000 // Timeout en milisegundos (30 segundos)
    );
    
    logger.info({ count: allChats.length }, 'Total chats obtenidos');
    
    const allGroups = allChats.filter(chat => chat.isGroup);
    logger.info({ count: allGroups.length }, 'Total grupos disponibles');
    
    // Procesar cada grupo
    for (const groupName of groupNames) {
      try {
        logger.info({ group: groupName }, 'Escaneando grupo');
        
        const result = await this.withTimeout(
          () => this.scanSingleGroup(groupName, allGroups),
          300000 // Timeout en milisegundos (5 minutos)
        );
        
        results[groupName] = result;
        
        if (result.success) {
          logger.info({ 
            group: groupName, 
            members: result.members.length 
          }, 'Grupo escaneado con éxito');
        } else {
          logger.warn({ group: groupName, error: result.error }, 'Error al escanear grupo');
        }
      } catch (error) {
        logger.error({ group: groupName, error }, 'Error al procesar grupo');
        results[groupName] = { 
          name: groupName, 
          members: [],
          error: error instanceof Error ? error.message : 'Error desconocido',
          success: false
        };
      }
    }
    
    return results;
  }

  /**
   * Escanea un solo grupo y devuelve sus miembros
   */
  private async scanSingleGroup(groupName: string, allGroups: GroupChat[]): Promise<ScanResult> {
    try {
      // Buscar grupo en la lista ya obtenida (más rápido)
      const foundGroup = allGroups.find(g => 
        g.name.toLowerCase() === groupName.toLowerCase() || 
        g.name.toLowerCase().includes(groupName.toLowerCase())
      ) as GroupChat;
      
      if (!foundGroup) {
        return {
          name: groupName,
          members: [],
          error: `Grupo "${groupName}" no encontrado en la lista de grupos disponibles.`,
          success: false
        };
      }
      
      logger.info({ group: foundGroup.name }, 'Grupo encontrado. Obteniendo participantes...');
      
      // Obtener participantes con reintentos
      const participants = await retry<any[]>(
        () => Promise.resolve(foundGroup.participants),
        3, // Máximo número de reintentos
        1000, // Retraso entre reintentos en ms
        `Error al obtener participantes de ${foundGroup.name}`
      );
      
      if (!participants) {
        return {
          name: foundGroup.name,
          members: [],
          error: 'No se pudieron obtener los participantes después de varios intentos',
          success: false
        };
      }
      
      // Convertir a formato GroupMember
      const members = participants.map(p => {
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
      
      logger.info({ 
        group: foundGroup.name, 
        count: members.length 
      }, 'Participantes obtenidos');
      
      return {
        name: foundGroup.name,
        members,
        success: true
      };
    } catch (error) {
      logger.error({ 
        group: groupName, 
        error 
      }, 'Error en scanSingleGroup');
      
      return {
        name: groupName,
        members: [],
        error: error instanceof Error ? error.message : 'Error desconocido',
        success: false
      };
    }
  }
}

export default GroupScanner; 