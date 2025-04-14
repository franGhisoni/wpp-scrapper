import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

// Cargar variables de entorno
dotenv.config();

// Convertir exec a Promise
const execAsync = promisify(exec);

/**
 * Script para actualizar y limpiar el sistema
 * Ejecutar con: npm run upgrade
 */
async function main() {
  console.log('='.repeat(50));
  console.log('INICIANDO PROCESO DE ACTUALIZACIÓN Y LIMPIEZA');
  console.log('='.repeat(50));
  
  let errorOcurred = false;
  
  try {
    // 1. Verificar conexión a Strapi
    try {
      await verifyStrapi();
    } catch (strapiError) {
      console.error('⚠️ Error al conectar con Strapi. Continuando con el resto del proceso...');
      errorOcurred = true;
    }
    
    // 2. Limpiar directorios temporales (siempre ejecutar esto)
    await cleanDirectories();
    
    // 3. Verificar variables de entorno
    try {
      await checkEnvironmentVariables();
    } catch (envError) {
      console.error('⚠️ Error al verificar variables de entorno. Continuando con el resto del proceso...');
      errorOcurred = true;
    }
    
    // 4. Configurar Strapi (solo si la conexión fue exitosa)
    if (!errorOcurred) {
      try {
        await setupStrapi();
      } catch (setupError) {
        console.error('⚠️ Error al configurar Strapi. Continuando con el resto del proceso...');
        errorOcurred = true;
      }
    } else {
      console.log('\n📋 Omitiendo configuración de Strapi debido a errores previos...');
    }
    
    if (errorOcurred) {
      console.log('\n⚠️ El proceso de actualización completó con advertencias.');
      console.log('Algunos pasos no pudieron completarse, pero la limpieza de archivos se realizó correctamente.');
    } else {
      console.log('\n✅ Proceso de actualización completado con éxito!');
    }
    console.log('Ahora puede iniciar la aplicación con: npm run dev\n');
  } catch (error) {
    console.error('\n❌ Error fatal durante el proceso de actualización:');
    console.error(error);
    process.exit(1);
  }
}

/**
 * Verifica la conexión a Strapi
 */
async function verifyStrapi() {
  console.log('\n📋 Verificando conexión a Strapi...');
  
  const strapiUrl = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
  const apiToken = process.env.STRAPI_API_TOKEN;
  
  if (!apiToken) {
    console.log('⚠️ No se encontró STRAPI_API_TOKEN en las variables de entorno');
    console.log('Asegúrate de configurarlo en el archivo .env');
    throw new Error('STRAPI_API_TOKEN no configurado');
  }
  
  try {
    // Usar configuración simplificada para evitar problemas con el agente HTTP
    const response = await axios.get(`${strapiUrl}/api/health`, {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      timeout: 30000, // 30 segundos
      validateStatus: status => status < 500 // Aceptar cualquier respuesta que no sea error de servidor
    });
    
    if (response.status === 200) {
      console.log('✅ Conexión a Strapi exitosa');
    } else {
      console.warn(`⚠️ Respuesta inusual de Strapi: ${response.status} - Continuando de todos modos...`);
    }
  } catch (error) {
    console.error('❌ Error al conectar con Strapi:', error);
    console.log(`\nPosibles soluciones:
    1. Asegúrate que Strapi esté en ejecución en ${strapiUrl}
    2. Verifica que el token API sea válido
    3. Si usas localhost, intenta con 127.0.0.1 en lugar de localhost
    4. Revisa si hay un firewall bloqueando la conexión`);
    throw new Error('No se pudo conectar a Strapi');
  }
}

/**
 * Limpia directorios temporales y de sesión
 */
async function cleanDirectories() {
  console.log('\n📋 Limpiando directorios temporales...');
  
  const dirsToClean = [
    './.wwebjs_auth',
    './tmp',
    './tmp_test'
  ];
  
  for (const dir of dirsToClean) {
    if (fs.existsSync(dir)) {
      console.log(`Eliminando directorio: ${dir}`);
      
      try {
        if (process.platform === 'win32') {
          await execAsync(`rd /s /q "${dir}"`);
        } else {
          await execAsync(`rm -rf "${dir}"`);
        }
        console.log(`✅ Directorio eliminado: ${dir}`);
      } catch (error) {
        console.warn(`⚠️ No se pudo eliminar el directorio ${dir}:`, error);
        console.log('Continuando con el proceso...');
      }
    } else {
      console.log(`El directorio ${dir} no existe, omitiendo...`);
    }
  }
  
  console.log('✅ Limpieza de directorios completada');
}

/**
 * Verifica y muestra las variables de entorno
 */
async function checkEnvironmentVariables() {
  console.log('\n📋 Verificando variables de entorno...');
  
  const requiredVars = ['STRAPI_URL', 'STRAPI_API_TOKEN'];
  const optionalVars = ['PORT', 'AUTO_CLOSE_AFTER_SCAN', 'AUTO_CLOSE_TIMEOUT'];
  
  let missingRequired = false;
  
  console.log('\nVariables requeridas:');
  for (const varName of requiredVars) {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: Configurado`);
    } else {
      console.log(`❌ ${varName}: No configurado`);
      missingRequired = true;
    }
  }
  
  console.log('\nVariables opcionales:');
  for (const varName of optionalVars) {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: ${process.env[varName]}`);
    } else {
      console.log(`⚠️ ${varName}: No configurado (se usará valor por defecto)`);
    }
  }
  
  if (missingRequired) {
    throw new Error('Faltan variables de entorno requeridas');
  }
  
  console.log('\n✅ Verificación de variables de entorno completada');
}

/**
 * Configura el esquema en Strapi
 */
async function setupStrapi() {
  console.log('\n📋 Configurando esquema en Strapi...');
  
  try {
    await execAsync('npm run setup-strapi');
    console.log('✅ Esquema de Strapi configurado correctamente');
  } catch (error) {
    console.error('❌ Error al configurar esquema en Strapi:', error);
    throw new Error('No se pudo configurar el esquema en Strapi');
  }
}

// Ejecutar función principal
main(); 