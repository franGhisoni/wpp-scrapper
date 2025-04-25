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
    logger.info('Iniciando escaneo de grupos', { count: groupNames.length });
    
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
    
    logger.info('Total chats obtenidos', { count: allChats.length });
    
    const allGroups = allChats.filter(chat => chat.isGroup);
    logger.info('Total grupos disponibles', { count: allGroups.length });
    
    // Procesar cada grupo
    for (const groupName of groupNames) {
      try {
        logger.info('Escaneando grupo', { group: groupName });
        
        const result = await this.withTimeout(
          () => this.scanSingleGroup(groupName, allGroups),
          300000 // Timeout en milisegundos (5 minutos)
        );
        
        results[groupName] = result;
        
        if (result.success) {
          logger.info('Grupo escaneado con éxito', { 
            group: groupName, 
            members: result.members.length 
          });
        } else {
          logger.warn('Error al escanear grupo', { group: groupName, error: result.error });
        }
      } catch (error) {
        logger.error('Error al procesar grupo', { group: groupName, error });
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
      
      logger.info('Grupo encontrado. Obteniendo participantes...', { group: foundGroup.name });
      
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
      
      logger.info('Participantes obtenidos', { 
        group: foundGroup.name, 
        count: members.length 
      });
      
      return {
        name: foundGroup.name,
        members,
        success: true
      };
    } catch (error) {
      logger.error('Error en scanSingleGroup', { 
        group: groupName, 
        error 
      });
      
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