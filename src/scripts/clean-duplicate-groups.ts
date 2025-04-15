import axios from 'axios';
import dotenv from 'dotenv';
import dns from 'dns';

// Force IPv4
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

// Always use 127.0.0.1 instead of localhost
const strapiUrl = (process.env.STRAPI_URL || 'http://127.0.0.1:1337').replace('localhost', '127.0.0.1');
const apiToken = process.env.STRAPI_API_TOKEN;

// Configurar axios para forzar IPv4
axios.defaults.family = 4;

async function main() {
  if (!apiToken) {
    console.error('Error: STRAPI_API_TOKEN no está configurado en el archivo .env');
    console.log('Variables disponibles:', process.env);
    process.exit(1);
  }

  console.log(`Conectando a Strapi en ${strapiUrl}...`);
  
  try {
    // Obtener todos los grupos
    console.log('Obteniendo todos los grupos de WhatsApp...');
    const response = await axios.get(
      `${strapiUrl}/api/whatsapp-groups`,
      {
        params: {
          'pagination[pageSize]': 500, // Obtener hasta 500 grupos
        },
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.status !== 200) {
      throw new Error(`Error al obtener grupos: ${response.status}`);
    }
    
    const groups = response.data.data;
    console.log(`Se encontraron ${groups.length} grupos en total.`);
    
    // Agrupar por nombre
    const groupsByName = {};
    for (const group of groups) {
      const name = group.attributes.name;
      if (!groupsByName[name]) {
        groupsByName[name] = [];
      }
      groupsByName[name].push(group);
    }
    
    // Identificar duplicados
    let duplicateCount = 0;
    const groupsToKeep = [];
    const groupsToDelete = [];
    
    for (const [name, groupsList] of Object.entries(groupsByName)) {
      if (groupsList.length > 1) {
        duplicateCount++;
        console.log(`\n🔍 Grupo "${name}" tiene ${groupsList.length} duplicados:`);
        
        // Ordenar por fecha de creación (más reciente primero)
        groupsList.sort((a, b) => {
          const dateA = new Date(a.attributes.createdAt || 0);
          const dateB = new Date(b.attributes.createdAt || 0);
          return dateB.getTime() - dateA.getTime();
        });
        
        // Mostrar información de cada duplicado
        groupsList.forEach((group, index) => {
          const memberCount = group.attributes.memberCount || 0;
          const createdAt = group.attributes.createdAt ? new Date(group.attributes.createdAt).toLocaleString() : 'desconocido';
          const lastScan = group.attributes.lastScan ? new Date(group.attributes.lastScan).toLocaleString() : 'nunca';
          
          console.log(`  ${index === 0 ? '✅' : '❌'} ID: ${group.id}, Miembros: ${memberCount}, Creado: ${createdAt}, Último escaneo: ${lastScan}`);
          
          if (index === 0) {
            groupsToKeep.push(group); // Mantener el más reciente
          } else {
            groupsToDelete.push(group); // Eliminar los demás
          }
        });
      } else {
        groupsToKeep.push(groupsList[0]); // No es duplicado, mantenerlo
      }
    }
    
    console.log(`\n📊 Resumen:`);
    console.log(`  Total de grupos: ${groups.length}`);
    console.log(`  Grupos únicos: ${groupsToKeep.length}`);
    console.log(`  Grupos duplicados: ${duplicateCount}`);
    console.log(`  Grupos a eliminar: ${groupsToDelete.length}`);
    
    // Preguntar si se desea proceder con la eliminación
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    if (groupsToDelete.length === 0) {
      console.log('\n✅ No hay grupos duplicados para eliminar.');
      readline.close();
      return;
    }
    
    const confirmation = await new Promise(resolve => {
      readline.question('\n⚠️ ¿Desea eliminar los grupos duplicados? [s/N] ', answer => {
        resolve(answer.toLowerCase() === 's');
        readline.close();
      });
    });
    
    if (!confirmation) {
      console.log('Operación cancelada por el usuario.');
      return;
    }
    
    // Eliminar grupos duplicados
    console.log('\n🗑️ Eliminando grupos duplicados...');
    let deleteSuccess = 0;
    let deleteErrors = 0;
    
    for (const group of groupsToDelete) {
      try {
        console.log(`  Eliminando grupo "${group.attributes.name}" (ID: ${group.id})...`);
        
        // Primero obtener todos los miembros de este grupo
        const membersResponse = await axios.get(
          `${strapiUrl}/api/group-members`,
          {
            params: {
              'filters[whats_app_group][id][$eq]': group.id,
              'pagination[pageSize]': 500,
            },
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (membersResponse.status === 200) {
          const members = membersResponse.data.data;
          console.log(`    Este grupo tiene ${members.length} miembros que serán eliminados.`);
          
          // Eliminar cada miembro
          for (const member of members) {
            try {
              await axios.delete(
                `${strapiUrl}/api/group-members/${member.id}`,
                {
                  headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                  }
                }
              );
            } catch (memberError) {
              console.error(`    Error al eliminar miembro ${member.id}: ${memberError.message}`);
            }
          }
        }
        
        // Eliminar el grupo
        const deleteResponse = await axios.delete(
          `${strapiUrl}/api/whatsapp-groups/${group.id}`,
          {
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (deleteResponse.status === 200) {
          console.log(`    ✅ Grupo eliminado correctamente.`);
          deleteSuccess++;
        } else {
          console.error(`    ❌ Error al eliminar grupo: ${deleteResponse.status}`);
          deleteErrors++;
        }
      } catch (error) {
        console.error(`    ❌ Error al procesar eliminación: ${error.message}`);
        deleteErrors++;
      }
    }
    
    console.log(`\n📊 Resultado de la limpieza:`);
    console.log(`  Grupos eliminados correctamente: ${deleteSuccess}`);
    console.log(`  Errores durante la eliminación: ${deleteErrors}`);
    console.log(`  Grupos restantes: ${groups.length - deleteSuccess}`);
    
  } catch (error) {
    console.error('Error durante la limpieza:', error.message);
    if (error.response) {
      console.error('Estado:', error.response.status);
      console.error('Respuesta:', error.response.data);
    }
    process.exit(1);
  }
}

main(); 