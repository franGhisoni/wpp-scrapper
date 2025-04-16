import axios from 'axios';
import { GroupMember, GroupMetrics } from '../models/GroupMember';
import dotenv from 'dotenv';

dotenv.config();

// Forzar el uso de IPv4 en todas las conexiones
axios.defaults.family = 4;

// Modificar la URL para usar siempre IPv4
const STRAPI_URL = (process.env.STRAPI_URL || 'http://localhost:1337');
const API_TOKEN = process.env.STRAPI_API_TOKEN;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

class GroupMemberRepository {
  constructor() {
    console.log(`Inicializando GroupMemberRepository en modo ${IS_PRODUCTION ? 'producción' : 'desarrollo'}`);
    console.log(`Usando Strapi para almacenamiento en: ${STRAPI_URL}`);
  }

  async createOrUpdateMembers(members: Omit<GroupMember, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<GroupMember[]> {
    return this.createOrUpdateMembersStrapi(members);
  }
  
  async getGroupMembers(groupName: string, activeOnly: boolean = true): Promise<GroupMember[]> {
    return this.getGroupMembersStrapi(groupName, activeOnly);
  }
  
  async getGroupMetrics(groupName: string, sinceHours: number = 24): Promise<GroupMetrics> {
    return this.getGroupMetricsStrapi(groupName, sinceHours);
  }
  
  async markInactiveGroupMembers(groupName: string, activePhoneNumbers: string[]): Promise<number> {
    return this.markInactiveGroupMembersStrapi(groupName, activePhoneNumbers);
  }
  
  // IMPLEMENTACIONES PARA STRAPI
  
  private async createOrUpdateMembersStrapi(members: Omit<GroupMember, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<GroupMember[]> {
    const results: GroupMember[] = [];
    // Cache for groups to avoid repeated lookups
    const groupCache: Record<string, any> = {};

    try {
      for (const member of members) {
        try {
          // Use cached group or fetch if not in cache
          const group = groupCache[member.groupName] || 
                        await this.findOrCreateGroupInStrapi(member.groupName);
          
          // Store in cache
          if (!groupCache[member.groupName]) {
            groupCache[member.groupName] = group;
          }
          
          const groupId = group.id;
          
          // Buscar si el miembro ya existe
          const memberResponse = await axios.get(`${STRAPI_URL}/api/group-members`, {
            headers: { Authorization: `Bearer ${API_TOKEN}` },
            params: {
              filters: {
                phone_number: { $eq: member.phoneNumber },
                whats_app_group: { id: { $eq: groupId } }
              }
            }
          });

          let resultMember;
          const currentDate = new Date();

          if (memberResponse.data.data.length > 0) {
            // Miembro existente, actualizar
            const existingMember = memberResponse.data.data[0];
            const existingId = existingMember.id;
            const existingIsActive = existingMember.attributes.is_active;

            let updateData: any = {
              Name: member.name
            };

            // Si estaba inactivo y ahora está activo
            if (!existingIsActive && member.isActive) {
              updateData = {
                ...updateData,
                is_active: true,
                Join_date: member.joinDate ? member.joinDate.toISOString() : currentDate.toISOString(),
                Left_date: null
              };
            } 
            // Si estaba activo y ahora está inactivo
            else if (existingIsActive && !member.isActive) {
              updateData = {
                ...updateData,
                is_active: false,
                Left_date: currentDate.toISOString()
              };
            }

            const updateResponse = await axios.put(`${STRAPI_URL}/api/group-members/${existingId}`, {
              data: updateData
            }, {
              headers: { Authorization: `Bearer ${API_TOKEN}` }
            });

            resultMember = this.mapStrapiResponseToGroupMember(updateResponse.data.data);
          } else {
            // Nuevo miembro
            const createData = {
              phone_number: member.phoneNumber,
              Name: member.name,
              is_active: member.isActive,
              Join_date: member.joinDate ? member.joinDate.toISOString() : currentDate.toISOString(),
              Left_date: null,
              whats_app_group: groupId
            };

            const createResponse = await axios.post(`${STRAPI_URL}/api/group-members`, {
              data: createData
            }, {
              headers: { Authorization: `Bearer ${API_TOKEN}` }
            });

            resultMember = this.mapStrapiResponseToGroupMember(createResponse.data.data);
          }

          results.push(resultMember);
        } catch (error) {
          console.error(`Error procesando miembro ${member.phoneNumber} del grupo ${member.groupName}:`, error);
          // Continuar con el siguiente miembro en caso de error
        }
      }

      return results;
    } catch (error) {
      console.error('Error creating or updating group members in Strapi:', error);
      throw error;
    }
  }

  private async getGroupMembersStrapi(groupName: string, activeOnly: boolean = true): Promise<GroupMember[]> {
    try {
      // Obtener o crear el grupo
      const group = await this.findOrCreateGroupInStrapi(groupName);
      const groupId = group.id;

      // Construir filtros
      const filters: any = {
        whats_app_group: { id: { $eq: groupId } }
      };

      if (activeOnly) {
        filters.is_active = { $eq: true };
      }

      // Obtener miembros
      const membersResponse = await axios.get(`${STRAPI_URL}/api/group-members`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        params: {
          filters,
          sort: 'Name:asc'
        }
      });

      return membersResponse.data.data.map(this.mapStrapiResponseToGroupMember);
    } catch (error) {
      console.error('Error getting group members from Strapi:', error);
      throw error;
    }
  }

  private async getGroupMetricsStrapi(groupName: string, sinceHours: number = 24): Promise<GroupMetrics> {
    try {
      // Obtener o crear el grupo
      const group = await this.findOrCreateGroupInStrapi(groupName);
      const groupId = group.id;
      
      const sinceDate = new Date();
      sinceDate.setHours(sinceDate.getHours() - sinceHours);
      
      console.log(`Calculando métricas para grupo "${groupName}" con período de ${sinceHours} horas atrás (desde ${sinceDate.toISOString()})`);

      // Obtener todos los miembros del grupo en una sola llamada
      const membersResponse = await axios.get(`${STRAPI_URL}/api/group-members`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        params: {
          filters: {
            whats_app_group: { id: { $eq: groupId } }
          }
        }
      });

      const allMembers = membersResponse.data.data.map(this.mapStrapiResponseToGroupMember);
      
      // Filtrar miembros en memoria
      const currentMembers = allMembers.filter(member => member.isActive);
      
      // Miembros nuevos: aquellos que se unieron durante el período de tiempo especificado
      const newMembers = allMembers.filter(member => {
        // Si no está activo o no tiene fecha de unión, no es un miembro nuevo
        if (!member.isActive || !member.joinDate) return false;
        
        const joinDate = new Date(member.joinDate);
        
        // Ahora comparamos la fecha de unión con la fecha límite (sinceDate)
        const isNew = joinDate >= sinceDate;
        
        if (isNew) {
          console.log(`Miembro nuevo: ${member.name || member.phoneNumber}, se unió el ${joinDate.toISOString()}, dentro del rango de ${sinceHours} horas`);
        }
        
        return isNew;
      });
      
      // Miembros que dejaron el grupo durante el período especificado
      const leftMembers = allMembers.filter(member => {
        // Si está activo o no tiene fecha de salida, no ha dejado el grupo
        if (member.isActive || !member.leftDate) return false;
        
        const leftDate = new Date(member.leftDate);
        
        // Comparamos la fecha de salida con la fecha límite
        const leftRecently = leftDate >= sinceDate;
        
        if (leftRecently) {
          console.log(`Miembro que salió: ${member.name || member.phoneNumber}, salió el ${leftDate.toISOString()}, dentro del rango de ${sinceHours} horas`);
        }
        
        return leftRecently;
      });

      console.log(`Métricas obtenidas para grupo "${groupName}": ${currentMembers.length} miembros, ${newMembers.length} nuevos, ${leftMembers.length} salieron`);

      return {
        groupName,
        totalMembers: currentMembers.length,
        newMembers,
        leftMembers,
        scanDate: new Date()
      };
    } catch (error) {
      console.error('Error getting group metrics from Strapi:', error);
      throw error;
    }
  }

  private async markInactiveGroupMembersStrapi(groupName: string, activePhoneNumbers: string[]): Promise<number> {
    try {
      // Encontrar o crear el grupo
      const group = await this.findOrCreateGroupInStrapi(groupName);
      const groupId = group.id;

      // Obtener miembros activos que no están en la lista
      const membersToDeactivateResponse = await axios.get(`${STRAPI_URL}/api/group-members`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        params: {
          filters: {
            whats_app_group: { id: { $eq: groupId } },
            is_active: { $eq: true },
            phone_number: { $notIn: activePhoneNumbers }
          }
        }
      });

      const membersToDeactivate = membersToDeactivateResponse.data.data;
      let count = 0;

      // Marcar cada miembro como inactivo
      for (const member of membersToDeactivate) {
        await axios.put(`${STRAPI_URL}/api/group-members/${member.id}`, {
          data: {
            is_active: false,
            Left_date: new Date().toISOString()
          }
        }, {
          headers: { Authorization: `Bearer ${API_TOKEN}` }
        });
        count++;
      }

      return count;
    } catch (error) {
      console.error('Error marking inactive group members in Strapi:', error);
      throw error;
    }
  }

  private mapStrapiResponseToGroupMember(strapiMember: any): GroupMember {
    const attributes = strapiMember.attributes;
    return {
      id: strapiMember.id,
      phoneNumber: attributes.phone_number,
      name: attributes.Name,
      isActive: attributes.is_active,
      groupName: attributes.whats_app_group?.data?.attributes?.name || '',
      joinDate: attributes.Join_date ? new Date(attributes.Join_date) : null,
      leftDate: attributes.Left_date ? new Date(attributes.Left_date) : null,
      createdAt: new Date(attributes.createdAt),
      updatedAt: new Date(attributes.updatedAt)
    };
  }

  /**
   * Crea un grupo en Strapi si no existe
   */
  private async findOrCreateGroupInStrapi(groupName: string): Promise<any> {
    try {
      // Intentar obtener el grupo existente
      const existingGroups = await axios.get(
        `${STRAPI_URL}/api/whatsapp-groups`,
        {
          headers: { Authorization: `Bearer ${API_TOKEN}` },
          params: {
            filters: { name: { $eq: groupName } },
            pagination: { pageSize: 1 }
          }
        }
      );

      // Si existe, devolverlo
      if (existingGroups.data.data.length > 0) {
        console.log(`Grupo encontrado en Strapi: ${groupName}`);
        return existingGroups.data.data[0];
      }

      // Si no existe, crearlo
      console.log(`Creando nuevo grupo en Strapi: ${groupName}`);
      const response = await axios.post(
        `${STRAPI_URL}/api/whatsapp-groups`,
        {
          data: {
            name: groupName,
            description: `Grupo creado automáticamente: ${groupName}`,
            clicks: 0,
            closed: false
          }
        },
        { headers: { Authorization: `Bearer ${API_TOKEN}` } }
      );

      console.log(`Grupo creado exitosamente: ${groupName}`);
      return response.data.data;
    } catch (error) {
      console.error(`Error al buscar o crear grupo ${groupName} en Strapi:`, error);
      throw new Error(`Error al buscar o crear grupo en Strapi: ${error}`);
    }
  }
}

export default new GroupMemberRepository(); 