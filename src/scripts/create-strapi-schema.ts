import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Cargar variables de entorno
dotenv.config();

// Configuración de Strapi
const STRAPI_URL = (process.env.STRAPI_URL || 'http://127.0.0.1:1337').replace('localhost', '127.0.0.1');
const API_TOKEN = process.env.STRAPI_API_TOKEN;

// Forzar IPv4 en axios
axios.defaults.family = 4;

// Verificación de variables
if (!API_TOKEN) {
  console.error('ERROR: No se ha configurado STRAPI_API_TOKEN en .env');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_TOKEN}`
};

// Esquema para whatsapp-sessions
const whatsappSessionSchema = {
  displayName: 'WhatsApp Session',
  singularName: 'whatsapp-session',
  pluralName: 'whatsapp-sessions',
  description: 'WhatsApp session data for RemoteAuth',
  attributes: {
    active: {
      type: 'boolean',
      default: true,
      required: true
    },
    session_id: {
      type: 'string',
      required: true
    },
    session_data: {
      type: 'text',
      required: true
    },
    is_compressed: {
      type: 'boolean',
      default: false
    },
    chunk_index: {
      type: 'integer',
      default: 0
    },
    total_chunks: {
      type: 'integer',
      default: 1
    },
    timestamp: {
      type: 'datetime'
    }
  }
};

async function main() {
  try {
    console.log(`Conectando a Strapi en ${STRAPI_URL}...`);

    // Verificar si ya existe el tipo de contenido
    const contentTypeResponse = await axios.get(
      `${STRAPI_URL}/api/content-type-builder/content-types`,
      { headers }
    ).catch(err => {
      if (err.response?.status === 403) {
        console.error('ERROR: No tienes permisos para acceder a Content-Type Builder API.');
        console.error('Necesitas crear manualmente el tipo de contenido "whatsapp-sessions" con estos campos:');
        console.error('- active (boolean)');
        console.error('- session_id (text)');
        console.error('- session_data (text)');
        console.error('- is_compressed (boolean)');
        console.error('- chunk_index (integer)');
        console.error('- total_chunks (integer)');
        console.error('- timestamp (datetime)');
        return null;
      }
      throw err;
    });

    if (!contentTypeResponse) {
      return;
    }

    const contentTypes = contentTypeResponse.data.data;
    const whatsappSessionType = contentTypes.find(
      (ct: any) => ct.uid === 'api::whatsapp-session.whatsapp-session'
    );

    if (whatsappSessionType) {
      console.log('El tipo de contenido "whatsapp-sessions" ya existe.');
    } else {
      console.log('Creando tipo de contenido "whatsapp-sessions"...');
      
      // Crear el tipo de contenido
      await axios.post(
        `${STRAPI_URL}/api/content-type-builder/content-types`,
        {
          contentType: {
            kind: 'collectionType',
            ...whatsappSessionSchema
          }
        },
        { headers }
      );
      
      console.log('Tipo de contenido creado. Reinicia Strapi para aplicar los cambios.');
    }

    // Configurar permisos para el rol Public
    console.log('Configurando permisos para el rol "Public"...');
    
    const rolesResponse = await axios.get(`${STRAPI_URL}/api/users-permissions/roles`, { headers });
    const publicRole = rolesResponse.data.roles.find((role: any) => role.type === 'public');
    
    if (!publicRole) {
      console.error('ERROR: No se encontró el rol "Public"');
      return;
    }
    
    // Actualizar permisos
    await axios.put(
      `${STRAPI_URL}/api/users-permissions/roles/${publicRole.id}`,
      {
        role: {
          ...publicRole,
          permissions: {
            ...publicRole.permissions,
            'api::whatsapp-session.whatsapp-session': {
              controllers: {
                'whatsapp-session': {
                  find: { enabled: true },
                  findOne: { enabled: true },
                  create: { enabled: true },
                  update: { enabled: true }
                }
              }
            }
          }
        }
      },
      { headers }
    );
    
    console.log('Permisos configurados correctamente.');
    console.log('Configuración completada. La integración con Strapi está lista.');
    
  } catch (error: any) {
    console.error('Error durante la configuración:', error.message);
    if (error.response) {
      console.error(`Estado HTTP: ${error.response.status}`);
      console.error('Respuesta:', error.response.data);
    }
  }
}

main(); 