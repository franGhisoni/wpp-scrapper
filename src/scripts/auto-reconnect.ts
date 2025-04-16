/**
 * Script de reconexión automática para WhatsApp
 * 
 * Este script puede ser ejecutado periódicamente (ej: con cron) para mantener
 * la sesión de WhatsApp activa y minimizar la necesidad de escaneo QR.
 * 
 * Funcionamiento:
 * 1. Verifica el estado actual de la conexión
 * 2. Si hay sesión disponible pero no está conectado, intenta reconectar
 * 3. Si la reconexión falla, guarda la información para el siguiente intento
 * 4. Solo en último caso, cuando sea absolutamente necesario, genera un QR
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Configuración
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:9877/api';
const LOG_FILE = path.join(__dirname, '../../logs/auto-reconnect.log');
const STATE_FILE = path.join(__dirname, '../../logs/reconnect-state.json');
const MAX_AUTOMATIC_RETRIES = 5;

// Asegurar que el directorio de logs existe
const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Función para escribir logs
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  console.log(message);
  fs.appendFileSync(LOG_FILE, logMessage);
}

// Función para cargar el estado actual
function loadState(): { retries: number, lastAttempt: string } {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    log(`Error al cargar el estado: ${error}`);
  }
  
  return { retries: 0, lastAttempt: new Date().toISOString() };
}

// Función para guardar el estado actual
function saveState(state: { retries: number, lastAttempt: string }) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    log(`Error al guardar el estado: ${error}`);
  }
}

// Función principal
async function main() {
  log('Iniciando proceso de reconexión automática');
  
  // Cargar estado actual
  const state = loadState();
  state.lastAttempt = new Date().toISOString();
  
  try {
    // Verificar el estado actual de la API
    log('Verificando estado de la API...');
    const response = await axios.get(`${API_BASE_URL}/whatsapp/api-status?attempt=${state.retries}`);
    
    if (response.status !== 200) {
      throw new Error(`Error al obtener estado: ${response.status}`);
    }
    
    const { data } = response.data;
    log(`Estado actual: ${data.status}, Acción recomendada: ${data.nextAction}`);
    
    // Verificar si requiere intervención humana
    if (data.requiresHuman) {
      log(`⚠️ Se requiere intervención humana. Razón: ${data.status}`);
      
      if (data.status === 'NEED_SCAN' && data.qrCode) {
        log('Código QR disponible. Se recomienda guardarlo para su uso posterior.');
        // Aquí se podría guardar el QR en un archivo o enviarlo por correo/sistema de notificaciones
      }
      
      // Si hemos superado el máximo de reintentos, parar
      if (state.retries >= MAX_AUTOMATIC_RETRIES) {
        log(`Alcanzado el máximo de ${MAX_AUTOMATIC_RETRIES} reintentos automáticos. Se requiere intervención manual.`);
        saveState({ retries: 0, lastAttempt: state.lastAttempt });
        return;
      }
    }
    
    // Manejar según la acción recomendada
    switch (data.nextAction) {
      case 'CONTINUE':
        log('✅ Sistema ya autenticado y funcionando correctamente. No se requiere acción.');
        saveState({ retries: 0, lastAttempt: state.lastAttempt });
        break;
        
      case 'INITIALIZE':
        log('🔄 Intentando inicializar sistema con sesión existente...');
        await axios.get(`${API_BASE_URL}/whatsapp/qr`);
        log('Inicialización solicitada. Verificar estado en siguiente ejecución.');
        saveState({ retries: state.retries + 1, lastAttempt: state.lastAttempt });
        break;
        
      case 'RESET_SESSION':
        // Solo resetear si llevamos muchos intentos fallidos
        if (state.retries >= MAX_AUTOMATIC_RETRIES - 1) {
          log('🔄 Reseteo de sesión necesario después de múltiples errores.');
          await axios.get(`${API_BASE_URL}/whatsapp/qr?forceNew=true`);
          log('Reseteo solicitado. Se requerirá escaneo de QR en siguiente ejecución.');
          saveState({ retries: 0, lastAttempt: state.lastAttempt });
        } else {
          log('⚠️ Error de autenticación detectado. Aumentando contador de reintentos.');
          saveState({ retries: state.retries + 1, lastAttempt: state.lastAttempt });
        }
        break;
        
      default:
        log(`Estado ${data.status} requiere intervención manual.`);
        state.retries += 1;
        saveState(state);
    }
    
  } catch (error) {
    log(`Error durante la reconexión automática: ${error}`);
    state.retries += 1;
    saveState(state);
  }
  
  log('Proceso de reconexión automática finalizado');
}

// Ejecutar función principal
main().catch(error => {
  log(`Error fatal: ${error}`);
  process.exit(1);
}); 