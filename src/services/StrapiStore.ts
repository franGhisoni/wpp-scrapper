import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Store } from 'whatsapp-web.js';
import dotenv from 'dotenv';
import zlib from 'zlib';
import http from 'http';
import https from 'https';

// Forzar la carga de variables de entorno antes de cualquier otra operación
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
  rejectUnauthorized: false // Para desarrollo (considera cambiarlo en producción)
});

// Configurar axios para usar los agentes
axios.defaults.timeout = 30000; // 30 segundos
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

// Configuración para fragmentación
const MAX_CHUNK_SIZE = 1024 * 1024; // 1MB por fragmento

interface StoreOptions {
  session: string; // Este es el sessionName completo, ej: RemoteAuth-clientId
  path?: string;
}

interface StrapiStoreConfig {
  strapiUrl?: string;
  apiToken?: string;
}

/**
 * Implementación de Store para RemoteAuth con Strapi,
 * siguiendo el flujo esperado por el código fuente de RemoteAuth.
 */
class StrapiStore implements Store {
  private strapiUrl: string;
  private apiToken: string;

  constructor(config?: StrapiStoreConfig) {
    this.strapiUrl = config?.strapiUrl || process.env.STRAPI_URL || 'http://localhost:1337';
    this.apiToken = config?.apiToken || process.env.STRAPI_API_TOKEN || '';

    console.log(`StrapiStore inicializado con URL: ${this.strapiUrl}`);
    if (!this.apiToken) {
      console.error('ERROR: No se ha configurado STRAPI_API_TOKEN');
    } else {
      console.log(`Token API configurado con longitud: ${this.apiToken.length}`);
    }
  }

  /**
   * Verifica si existe una sesión ACTIVA en Strapi
   */
  async sessionExists(options: StoreOptions): Promise<boolean> {
    const sessionName = options.session; // Usar el sessionName completo
    try {
      const response = await axios.get(`${this.strapiUrl}/api/whatsapp-sessions`, {
        headers: this.getHeaders(),
        params: {
          filters: {
            active: true,
            session_id: sessionName // Usar el sessionName completo
          },
          pagination: { page: 1, pageSize: 1 }
        }
      });
      return response.data.data && response.data.data.length > 0;
    } catch (error: any) {
      console.error(`Error al verificar sesión activa ${sessionName}:`, error.message);
      return false;
    }
  }

  /**
   * Guarda la sesión leyendo el .zip local creado por RemoteAuth.
   */
  async save(options: StoreOptions): Promise<void> {
    const sessionName = options.session; // Usar el sessionName completo
    const localZipPath = `${sessionName}.zip`;

    if (!fs.existsSync(localZipPath)) {
      console.error(`¡ERROR CRÍTICO! RemoteAuth no creó el archivo ${localZipPath} antes de llamar a save.`);
      // Listar directorio actual para depurar
      try {
        console.log('Contenido del directorio actual:', fs.readdirSync('.'));
      } catch (e) { /* ignore */ }
      return;
    }

    console.log(`Guardando sesión ${sessionName} en Strapi desde ${localZipPath}...`);

    try {
      // Limpiar fragmentos antiguos ANTES de guardar
      console.log(`Limpiando fragmentos antiguos para ${sessionName} antes de guardar...`);
      await this.deleteAllSessionFragments(sessionName); // Usar el sessionName completo

      // Leer, comprimir, fragmentar... (código existente)
      const zipData = fs.readFileSync(localZipPath);
      const compressedData = zlib.gzipSync(zipData);
      const base64Data = compressedData.toString('base64');
      const chunks = [];
      const totalChunks = Math.ceil(base64Data.length / MAX_CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        chunks.push(base64Data.substring(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE));
      }
      console.log(`Dividiendo sesión en ${totalChunks} fragmentos para guardar`);

      // Guardar fragmentos
      for (let i = 0; i < chunks.length; i++) {
        const chunkData = {
          session_id: sessionName, // Usar el sessionName completo
          active: true,
          is_compressed: true,
          chunk_index: i,
          total_chunks: totalChunks,
          session_data: chunks[i],
          timestamp: new Date().toISOString()
        };
        console.log(`Guardando fragmento ${i+1}/${totalChunks}...`);
        await axios.post(`${this.strapiUrl}/api/whatsapp-sessions`, { data: chunkData }, {
          headers: this.getHeaders(),
          maxContentLength: Infinity, // Necesario para fragmentos grandes
          maxBodyLength: Infinity // Necesario para fragmentos grandes
        });
      }
      console.log(`Sesión ${sessionName} guardada exitosamente en ${totalChunks} fragmentos`);

    } catch (error: any) {
      console.error(`Error al guardar sesión ${sessionName}:`, error.message);
      if (error.response) {
        console.error(`Estado HTTP: ${error.response.status}`);
        console.error('Mensaje:', error.response.data);
      }
    }
  }

  /**
   * Extrae la sesión ACTIVA de Strapi y la guarda como .zip local.
   */
  async extract(options: StoreOptions): Promise<void> {
      const sessionName = options.session; // Usar el sessionName completo
      const localZipPath = options.path;

      if (!localZipPath) {
        // Esto no debería ocurrir según el código de RemoteAuth, pero por si acaso.
        throw new Error('Error interno: RemoteAuth no proporcionó una ruta (options.path) para guardar el archivo .zip extraído.');
      }

      // Asegurarse de que el directorio donde se guardará el zip exista
      const dirPath = path.dirname(localZipPath);
      if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
      }
      
      try {
        console.log(`Extrayendo sesión ${sessionName} desde Strapi a ${localZipPath}...`);

        // Obtener fragmentos activos
        const response = await axios.get(`${this.strapiUrl}/api/whatsapp-sessions`, {
            headers: this.getHeaders(),
            params: {
                filters: { active: true, session_id: sessionName }, // Usar el sessionName completo
                sort: 'chunk_index:asc',
                pagination: { pageSize: 200 }
            }
        });

        if (!response.data.data || response.data.data.length === 0) {
            console.log(`No hay sesión activa o fragmentos encontrados para ${sessionName}. RemoteAuth generará QR.`);
            // RemoteAuth espera que NO creemos el archivo localZipPath si no hay sesión.
            return;
        }

        // Borrar zip antiguo si existe SOLO cuando estamos seguros de que tenemos fragmentos
        if (fs.existsSync(localZipPath)) {
            try {
                fs.unlinkSync(localZipPath);
                console.log(`Archivo existente ${localZipPath} eliminado para reemplazarlo.`);
            } catch (e) {
                console.warn(`No se pudo eliminar ${localZipPath} previo, intentando sobrescribir:`, e);
            }
        }

        // Unir fragmentos, decodificar base64
        const fragments = response.data.data;
        console.log(`Encontrados ${fragments.length} fragmentos para ${sessionName}`);
        fragments.sort((a: any, b: any) => a.attributes.chunk_index - b.attributes.chunk_index);
        let sessionData = '';
        let isCompressed = false;
        
        // Validar que tenemos todos los fragmentos esperados antes de continuar
        const totalChunks = fragments.length > 0 ? fragments[0].attributes.total_chunks : 0;
        if (totalChunks !== fragments.length) {
            console.warn(`⚠️ Advertencia: Se esperaban ${totalChunks} fragmentos pero se encontraron ${fragments.length}`);
        }
        
        fragments.forEach(f => {
            sessionData += f.attributes.session_data;
            if (f.attributes.is_compressed) isCompressed = true;
        });
        const dataBuffer = Buffer.from(sessionData, 'base64');

        // Descomprimir Gzip (si se guardó comprimido)
        let finalZipBuffer;
        if (isCompressed) {
            console.log('Descomprimiendo datos (gunzip)...');
            try {
                finalZipBuffer = zlib.gunzipSync(dataBuffer);
            } catch (decompressError) {
                console.error('Error al descomprimir datos:', decompressError);
                console.log('Intentando usar datos sin descomprimir...');
                finalZipBuffer = dataBuffer;
            }
        } else {
            finalZipBuffer = dataBuffer; // Asumir que son los datos del zip directamente
        }
        console.log(`Tamaño del archivo ZIP recuperado: ${(finalZipBuffer.length / 1024 / 1024).toFixed(2)}MB`);

        // Guardar el buffer del ZIP en el archivo local
        try {
            fs.writeFileSync(localZipPath, finalZipBuffer);
            console.log(`Sesión ${sessionName} extraída y guardada correctamente en ${localZipPath}`);
        } catch (writeError) {
            console.error(`Error al escribir archivo ${localZipPath}:`, writeError);
            throw writeError;
        }

        // RemoteAuth se encargará de descomprimir este archivo localZipPath.

      } catch (error: any) {
        console.error(`Error al extraer sesión ${sessionName}:`, error.message);
        console.error('Este error es esperado si es la primera ejecución. RemoteAuth generará un nuevo QR.');
        // No eliminar el ZIP existente si hubo un error al extraer
        // Esto permite que si hay un error de conexión, aún podamos usar un ZIP anterior válido
      }
  }

  /**
   * Elimina TODOS los fragmentos de una sesión en Strapi.
   */
  async delete(options: StoreOptions): Promise<void> {
      const sessionName = options.session; // Usar el sessionName completo
      try {
        console.log(`Eliminando TODOS los fragmentos para la sesión ${sessionName} en Strapi...`);
        await this.deleteAllSessionFragments(sessionName); // Usar el sessionName completo
      } catch (error: any) {
        console.error(`Error al eliminar fragmentos de sesión ${sessionName}:`, error.message);
      }
  }

  /**
   * Elimina físicamente todos los fragmentos de una sesión específica.
   */
  private async deleteAllSessionFragments(sessionName: string): Promise<void> { // Usar el sessionName completo
    let currentPage = 1;
    let totalPages = 1;
    const strapiRecordIdsToDelete: number[] = [];

    console.log(`Buscando TODOS los fragmentos para ${sessionName} para eliminación...`);

    try {
        do {
            const response = await axios.get(`${this.strapiUrl}/api/whatsapp-sessions`, {
                headers: this.getHeaders(),
                params: {
                    filters: { session_id: sessionName }, // Usar el sessionName completo
                    fields: ['id'],
                    pagination: { page: currentPage, pageSize: 100 }
                }
            });
            const data = response.data.data;
            const meta = response.data.meta;
            if (data && data.length > 0) data.forEach((record: any) => strapiRecordIdsToDelete.push(record.id));
            if (meta && meta.pagination) totalPages = meta.pagination.pageCount;
            else totalPages = 1;
            currentPage++;
        } while (currentPage <= totalPages);

        if (strapiRecordIdsToDelete.length === 0) {
            console.log(`No se encontraron fragmentos para eliminar para la sesión ${sessionName}.`);
            return;
        }
        console.log(`Se eliminarán ${strapiRecordIdsToDelete.length} fragmentos para la sesión ${sessionName}...`);
        const deletionPromises = strapiRecordIdsToDelete.map(id =>
            axios.delete(`${this.strapiUrl}/api/whatsapp-sessions/${id}`, { headers: this.getHeaders() })
                .catch(err => console.error(`Error al eliminar fragmento ${id}:`, err.message))
        );
        await Promise.all(deletionPromises);
        console.log(`Todos los fragmentos para la sesión ${sessionName} eliminados.`);

    } catch (error: any) {
      console.error(`Error al buscar/eliminar fragmentos para ${sessionName}:`, error.message);
      // ... (manejo de errores) ...
    }
  }

  /**
   * Obtiene los headers para las peticiones a Strapi
   */
  private getHeaders(): Record<string, string> {
    const token = this.apiToken;
    if (!token) {
      console.error('ERROR CRÍTICO: Token API de Strapi no disponible.');
      return {};
    }
    const cleanToken = token.trim();
    if (cleanToken !== token) console.warn('ADVERTENCIA: El token contenía espacios extra.');
    return { Authorization: `Bearer ${cleanToken}` };
  }
}

export default StrapiStore; 