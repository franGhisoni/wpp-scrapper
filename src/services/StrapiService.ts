import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';
import https from 'https';

dotenv.config();

// Configurar agentes HTTP con IPv4 forzado
const httpAgent = new http.Agent({
  family: 4,  // Forzar IPv4
  keepAlive: true,
  timeout: 30000, // 30 segundos de timeout
});

const httpsAgent = new https.Agent({
  family: 4,  // Forzar IPv4
  keepAlive: true,
  timeout: 30000, // 30 segundos de timeout
  rejectUnauthorized: false // Para desarrollo
});

// Configurar axios para usar los agentes
axios.defaults.timeout = 30000; // 30 segundos
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

// Configuración de Strapi
const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const API_TOKEN = process.env.STRAPI_API_TOKEN;

/**
 * Servicio para interactuar con Strapi
 */
class StrapiService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor() {
    this.baseUrl = STRAPI_URL;
    this.headers = API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
    
    console.log(`Inicializando StrapiService con URL: ${this.baseUrl}`);
  }

  /**
   * Comprueba si el servicio está activo (ahora siempre retorna true)
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * Obtiene todos los grupos de WhatsApp de Strapi
   */
  async getWhatsAppGroups(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/whatsapp-groups`, {
        headers: this.headers,
        params: {
          populate: 'campaigns', // Incluir relación con campaigns
          pagination: { pageSize: 100 }
        }
      });

      // Transformar respuesta Strapi a formato útil
      return response.data.data.map((item: any) => ({
        id: item.id,
        ...item.attributes,
        campaigns: this.extractRelation(item, 'campaigns')
      }));
    } catch (error) {
      console.error('Error al obtener grupos de WhatsApp desde Strapi:', error);
      return [];
    }
  }
  
  /**
   * Obtiene un grupo de WhatsApp específico por nombre
   */
  async getWhatsAppGroupByName(name: string): Promise<any | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/whatsapp-groups`, {
        headers: this.headers,
        params: {
          filters: { name: { $eq: name } },
          populate: 'campaigns',
          pagination: { pageSize: 1 }
        }
      });

      if (response.data.data.length === 0) {
        return null;
      }

      const item = response.data.data[0];
      return {
        id: item.id,
        ...item.attributes,
        campaigns: this.extractRelation(item, 'campaigns')
      };
    } catch (error) {
      console.error(`Error al obtener grupo de WhatsApp "${name}" desde Strapi:`, error);
      return null;
    }
  }

  /**
   * Obtiene todas las campañas desde Strapi
   */
  async getCampaigns(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/campaigns`, {
        headers: this.headers,
        params: {
          populate: '*',
          pagination: { pageSize: 100 }
        }
      });
      
      return response.data.data.map((item: any) => ({
        id: item.id,
        ...item.attributes,
        whatsapp_groups: this.extractRelation(item, 'whatsapp_groups')
      }));
    } catch (error) {
      console.error('Error al obtener campañas desde Strapi:', error);
      return [];
    }
  }

  /**
   * Obtiene una campaña específica por ID
   */
  async getCampaignById(id: number): Promise<any | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/campaigns/${id}`, {
        headers: this.headers,
        params: {
          populate: '*'
        }
      });

      const item = response.data.data;
      return {
        id: item.id,
        ...item.attributes,
        whatsapp_groups: this.extractRelation(item, 'whatsapp_groups')
      };
    } catch (error) {
      console.error(`Error al obtener campaña con ID ${id} desde Strapi:`, error);
      return null;
    }
  }

  /**
   * Actualiza el conteo de clicks en un grupo de WhatsApp
   */
  async updateWhatsAppGroupClicks(groupId: number, clicks: number): Promise<boolean> {
    try {
      await axios.put(
        `${this.baseUrl}/api/whatsapp-groups/${groupId}`,
        {
          data: { clicks }
        },
        { headers: this.headers }
      );
      return true;
    } catch (error) {
      console.error(`Error al actualizar clicks del grupo ${groupId}:`, error);
      return false;
    }
  }

  /**
   * Crear un nuevo registro
   * @param collection Nombre de la colección
   * @param data Datos a guardar
   * @returns Datos del registro creado
   */
  async create(collection: string, data: any): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/${collection}`;
      
      const response = await axios.post(
        url,
        { data },
        { headers: this.headers }
      );
      
      return response.data;
    } catch (error: any) {
      console.error(`Error al crear registro en ${collection}:`, error.message);
      if (error.response) {
        console.error('Detalles:', error.response.data);
      }
      throw error;
    }
  }
  
  /**
   * Actualizar un registro existente
   * @param collection Nombre de la colección
   * @param id ID del registro
   * @param data Datos a actualizar
   * @returns Datos del registro actualizado
   */
  async update(collection: string, id: number, data: any): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/${collection}/${id}`;
      
      const response = await axios.put(
        url,
        { data },
        { headers: this.headers }
      );
      
      return response.data;
    } catch (error: any) {
      console.error(`Error al actualizar registro en ${collection}:`, error.message);
      if (error.response) {
        console.error('Detalles:', error.response.data);
      }
      throw error;
    }
  }
  
  /**
   * Buscar registros
   * @param collection Nombre de la colección
   * @param filters Filtros de búsqueda
   * @returns Registros encontrados
   */
  async find(collection: string, filters: any = {}): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/${collection}`;
      
      const response = await axios.get(url, {
        params: {
          ...filters
        },
        headers: this.headers
      });
      
      return response.data;
    } catch (error: any) {
      console.error(`Error al buscar registros en ${collection}:`, error.message);
      if (error.response) {
        console.error('Detalles:', error.response.data);
      }
      throw error;
    }
  }
  
  /**
   * Obtener un registro por ID
   * @param collection Nombre de la colección
   * @param id ID del registro
   * @returns Datos del registro
   */
  async findOne(collection: string, id: number): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/${collection}/${id}`;
      
      const response = await axios.get(url, {
        headers: this.headers
      });
      
      return response.data;
    } catch (error: any) {
      console.error(`Error al obtener registro de ${collection}:`, error.message);
      if (error.response) {
        console.error('Detalles:', error.response.data);
      }
      throw error;
    }
  }
  
  /**
   * Eliminar un registro
   * @param collection Nombre de la colección
   * @param id ID del registro
   * @returns Resultado de la operación
   */
  async delete(collection: string, id: number): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/${collection}/${id}`;
      
      const response = await axios.delete(url, {
        headers: this.headers
      });
      
      return response.data;
    } catch (error: any) {
      console.error(`Error al eliminar registro de ${collection}:`, error.message);
      if (error.response) {
        console.error('Detalles:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Extrae relaciones de la respuesta de Strapi
   */
  private extractRelation(item: any, relationName: string): any[] {
    if (!item.attributes || !item.attributes[relationName] || !item.attributes[relationName].data) {
      return [];
    }

    const relationData = item.attributes[relationName].data;
    if (!Array.isArray(relationData)) {
      return [
        {
          id: relationData.id,
          ...relationData.attributes
        }
      ];
    }
    
    return relationData.map((rel: any) => ({
      id: rel.id,
      ...rel.attributes
    }));
  }
  
  /**
   * Obtener los headers para las peticiones a Strapi
   */
  private getHeaders(): Record<string, string> {
    return this.headers;
  }
}

export default new StrapiService(); 