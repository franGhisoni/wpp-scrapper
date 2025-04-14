import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import dns from 'dns';

// Force IPv4
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

// Always use 127.0.0.1 instead of localhost
const strapiUrl = 'http://127.0.0.1:1337';
const apiToken = process.env.STRAPI_API_TOKEN;

// Schemas to create
const schemas = {
  'whatsapp-groups': {
    displayName: 'WhatsApp Group',
    pluralDisplayName: 'WhatsApp Groups',
    description: 'WhatsApp group information',
    attributes: {
      name: {
        type: 'string',
        required: true,
      },
      memberCount: {
        type: 'integer',
        default: 0,
      },
      lastScan: {
        type: 'datetime',
      },
      members: {
        type: 'relation',
        relation: 'oneToMany',
        target: 'api::whatsapp-member.whatsapp-member',
        targetAttribute: 'group',
      }
    }
  },
  'whatsapp-members': {
    displayName: 'WhatsApp Member',
    pluralDisplayName: 'WhatsApp Members',
    description: 'WhatsApp group member information',
    attributes: {
      phoneNumber: {
        type: 'string',
        required: true,
      },
      name: {
        type: 'string',
      },
      isActive: {
        type: 'boolean',
        default: true,
      },
      joinDate: {
        type: 'datetime',
      },
      lastSeen: {
        type: 'datetime',
      },
      group: {
        type: 'relation',
        relation: 'manyToOne',
        target: 'api::whatsapp-group.whatsapp-group',
        targetAttribute: 'members',
      }
    }
  }
};

async function main() {
  if (!apiToken) {
    console.error('Error: STRAPI_API_TOKEN no está configurado en el archivo .env');
    console.log('Variables disponibles:', process.env);
    process.exit(1);
  }

  try {
    console.log(`Conectando a Strapi en ${strapiUrl}...`);
    
    // Check Strapi connection
    try {
      const healthResponse = await axios.get(`${strapiUrl}/api/health`, {
        validateStatus: () => true // Accept any status
      });
      
      if (healthResponse.status >= 200 && healthResponse.status < 500) {
        console.log(`Conexión a Strapi exitosa (status: ${healthResponse.status})`);
      } else {
        console.warn(`Respuesta inesperada de Strapi: ${healthResponse.status}`);
        console.log('Intentando continuar de todos modos...');
      }
    } catch (error: any) {
      console.warn('Error al verificar el estado de Strapi, intentando continuar de todos modos:', error.message || 'Error desconocido');
    }
    
    // Create schemas if needed
    for (const [schemaName, schema] of Object.entries(schemas)) {
      try {
        console.log(`Verificando si existe el tipo de contenido '${schemaName}'...`);
        
        // Check if content type exists
        const contentTypeResponse = await axios.get(
          `${strapiUrl}/api/content-type-builder/content-types/api::${schemaName.replace(/-/g, '-')}.${schemaName.replace(/-/g, '-')}`,
          {
            headers: {
              'Authorization': `Bearer ${apiToken}`
            },
            validateStatus: () => true
          }
        );
        
        if (contentTypeResponse.status === 200) {
          console.log(`El tipo de contenido '${schemaName}' ya existe.`);
          continue;
        }
        
        console.log(`Creando tipo de contenido '${schemaName}'...`);
        
        // Create content type
        const createResponse = await axios.post(
          `${strapiUrl}/api/content-type-builder/content-types`,
          {
            contentType: {
              displayName: schema.displayName,
              pluralDisplayName: schema.pluralDisplayName,
              description: schema.description,
              draftAndPublish: false,
              kind: 'collectionType',
              collectionName: schemaName,
              attributes: schema.attributes
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true
          }
        );
        
        if (createResponse.status !== 201) {
          console.error(`Error al crear el tipo de contenido '${schemaName}':`, createResponse.data);
          continue;
        }
        
        console.log(`Tipo de contenido '${schemaName}' creado correctamente.`);
      } catch (error) {
        console.error(`Error al procesar el esquema '${schemaName}':`, error);
      }
    }
    
    // Set permissions for Public role
    try {
      console.log('Configurando permisos para el rol Public...');
      
      // Get Public role ID
      const rolesResponse = await axios.get(
        `${strapiUrl}/api/users-permissions/roles`,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`
          },
          validateStatus: () => true
        }
      );
      
      if (rolesResponse.status !== 200) {
        throw new Error(`No se pudo obtener el rol Public (status: ${rolesResponse.status})`);
      }
      
      const publicRole = rolesResponse.data.roles.find(role => role.type === 'public');
      if (!publicRole) {
        throw new Error('No se encontró el rol Public');
      }
      
      console.log(`ID del rol Public: ${publicRole.id}`);
      
      // Configure permissions
      for (const schemaName of Object.keys(schemas)) {
        const updatePermissionsResponse = await axios.put(
          `${strapiUrl}/api/users-permissions/roles/${publicRole.id}`,
          {
            role: {
              ...publicRole,
              permissions: {
                ...publicRole.permissions,
                [`api::${schemaName}.${schemaName}`]: {
                  controllers: {
                    [`${schemaName}`]: {
                      find: { enabled: true },
                      findOne: { enabled: true },
                      create: { enabled: true },
                      update: { enabled: true },
                      delete: { enabled: true }
                    }
                  }
                }
              }
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true
          }
        );
        
        if (updatePermissionsResponse.status !== 200) {
          console.error(`Error al configurar permisos para '${schemaName}':`, updatePermissionsResponse.data);
          continue;
        }
        
        console.log(`Permisos configurados para '${schemaName}'`);
      }
    } catch (error) {
      console.error('Error al configurar permisos:', error);
    }
    
    console.log('Proceso completado.');
  } catch (error) {
    console.error('Error general:', error);
    process.exit(1);
  }
}

main(); 