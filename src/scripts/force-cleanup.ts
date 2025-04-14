import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// Convertir exec a Promise
const execAsync = promisify(exec);

/**
 * Script para forzar limpieza total del sistema
 * Ejecutar con: npm run force-cleanup
 */
async function main() {
  console.log('='.repeat(80));
  console.log('LIMPIEZA FORZADA DEL SISTEMA');
  console.log('Este script eliminará TODOS los archivos temporales y de sesión.');
  console.log('='.repeat(80));
  
  // Directorios a limpiar
  const dirsToClean = [
    './.wwebjs_auth',
    './tmp',
    './tmp_test',
    './sessions'
  ];
  
  // Limpiar cada directorio
  for (const dir of dirsToClean) {
    await cleanDir(dir);
  }
  
  // Verificar si hay procesos de Chrome que puedan estar bloqueando archivos
  await checkChromeProcesses();
  
  console.log('\n✅ Limpieza forzada completada.');
  console.log('Ahora puede iniciar la aplicación con: npm run dev');
}

/**
 * Limpia un directorio usando múltiples métodos
 */
async function cleanDir(dirPath: string) {
  console.log(`\n📋 Limpiando directorio: ${dirPath}`);
  
  if (!fs.existsSync(dirPath)) {
    console.log(`El directorio ${dirPath} no existe, omitiendo...`);
    return;
  }
  
  // Esperar un momento para asegurar que los archivos no estén en uso
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Intentar tres métodos diferentes para asegurar la limpieza
  
  // 1. Usar fs.promises.rm
  try {
    console.log(`Intentando eliminar con fs.promises.rm...`);
    await fs.promises.rm(dirPath, { recursive: true, force: true });
    console.log(`✅ Directorio ${dirPath} eliminado con fs.promises.rm`);
    return;
  } catch (error: any) {
    console.warn(`⚠️ No se pudo eliminar con fs.promises.rm: ${error?.message || 'Error desconocido'}`);
  }
  
  // 2. Usar comandos del sistema
  try {
    if (process.platform === 'win32') {
      console.log(`Intentando eliminar con rd /s /q...`);
      await execAsync(`rd /s /q "${dirPath}"`);
    } else {
      console.log(`Intentando eliminar con rm -rf...`);
      await execAsync(`rm -rf "${dirPath}"`);
    }
    console.log(`✅ Directorio ${dirPath} eliminado con comando del sistema`);
    return;
  } catch (error: any) {
    console.warn(`⚠️ No se pudo eliminar con comando del sistema: ${error?.message || 'Error desconocido'}`);
  }
  
  // 3. Borrar archivos uno por uno
  try {
    console.log(`Intentando eliminar archivos individuales...`);
    await deleteFilesRecursively(dirPath);
    console.log(`✅ Archivos en ${dirPath} eliminados individualmente`);
  } catch (error: any) {
    console.error(`❌ No se pudieron eliminar todos los archivos: ${error?.message || 'Error desconocido'}`);
    console.log(`Por favor, cierre todas las aplicaciones y vuelva a intentarlo.`);
  }
}

/**
 * Borra archivos de forma recursiva
 */
async function deleteFilesRecursively(dirPath: string) {
  if (!fs.existsSync(dirPath)) return;
  
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  // Primero borrar archivos
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isFile()) {
      try {
        fs.unlinkSync(fullPath);
      } catch (error: any) {
        console.warn(`⚠️ No se pudo eliminar archivo ${fullPath}: ${error?.message || 'Error desconocido'}`);
      }
    }
  }
  
  // Luego procesar directorios
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      await deleteFilesRecursively(fullPath);
      try {
        fs.rmdirSync(fullPath);
      } catch (error: any) {
        console.warn(`⚠️ No se pudo eliminar directorio ${fullPath}: ${error?.message || 'Error desconocido'}`);
      }
    }
  }
  
  // Intentar eliminar el directorio raíz
  try {
    fs.rmdirSync(dirPath);
  } catch (error: any) {
    console.warn(`⚠️ No se pudo eliminar directorio raíz ${dirPath}: ${error?.message || 'Error desconocido'}`);
  }
}

/**
 * Verifica si hay procesos de Chrome que puedan estar bloqueando archivos
 */
async function checkChromeProcesses() {
  console.log('\n📋 Verificando procesos de Chrome...');
  
  try {
    let command = '';
    if (process.platform === 'win32') {
      command = 'tasklist | findstr chrome';
    } else {
      command = 'ps -ef | grep chrome';
    }
    
    const { stdout } = await execAsync(command);
    
    if (stdout && stdout.length > 0) {
      console.log('\n⚠️ Se detectaron procesos de Chrome que podrían estar bloqueando archivos:');
      console.log(stdout);
      
      if (process.platform === 'win32') {
        console.log('\nPara forzar el cierre de estos procesos, puede ejecutar:');
        console.log('taskkill /F /IM chrome.exe /T');
      } else {
        console.log('\nPara forzar el cierre de estos procesos, puede ejecutar:');
        console.log('killall chrome');
      }
    } else {
      console.log('✅ No se detectaron procesos de Chrome activos.');
    }
  } catch (error) {
    // Es normal que falle si no hay procesos de Chrome
    console.log('✅ No se detectaron procesos de Chrome activos.');
  }
}

// Ejecutar el script
main().catch(error => {
  console.error('Error durante la limpieza:', error);
  process.exit(1);
}); 