import dotenv from 'dotenv';
import path from 'path';

// Cargar variables de entorno
dotenv.config();

/**
 * Configuración centralizada de la aplicación
 */
export const config = {
  // Configuración general
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || 'localhost',
  
  // Configuración de WhatsApp
  whatsapp: {
    authStrategy: process.env.AUTH_STRATEGY || 'remote',
    qrMaxRetries: parseInt(process.env.QR_MAX_RETRIES || '5', 10),
    inactivityTimeoutMs: parseInt(process.env.INACTIVITY_TIMEOUT_MS || '300000', 10), // 5 minutos por defecto
    clientReconnectMs: parseInt(process.env.CLIENT_RECONNECT_MS || '10000', 10), // 10 segundos por defecto
  },
  
  // Configuración de PostgreSQL
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'whatsapp_api',
    synchronize: process.env.DB_SYNCHRONIZE === 'true' || false,
    logging: process.env.DB_LOGGING === 'true' || false,
  },
  
  // Configuración de Strapi
  strapi: {
    url: process.env.STRAPI_URL || 'http://localhost:1337',
    apiToken: process.env.STRAPI_API_TOKEN || '',
    enabled: true, // Cambiar a true ya que ahora siempre usamos Strapi
    whatsappGroupsEndpoint: '/api/whatsapp-groups',
    campaignsEndpoint: '/api/campaigns',
  },
  
  // Configuración de seguridad
  security: {
    apiKey: process.env.API_KEY || '',
    enableApiKey: process.env.ENABLE_API_KEY === 'true' || false,
  },
  
  // Configuración de logging
  logging: {
    level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    format: (process.env.LOG_FORMAT as 'json' | 'text') || 'json',
    dir: process.env.LOG_DIR || path.join(process.cwd(), 'logs'),
    file: process.env.LOG_FILE || 'whatsapp-api.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '7', 10),
  },
  
  // Configuración del servidor
  server: {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: process.env.CORS_METHODS || 'GET,HEAD,PUT,PATCH,POST,DELETE',
      preflightContinue: process.env.CORS_PREFLIGHT_CONTINUE === 'true',
      optionsSuccessStatus: parseInt(process.env.CORS_OPTIONS_SUCCESS_STATUS || '204')
    },
    // Configuración de rate limiting
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
      max: parseInt(process.env.RATE_LIMIT_MAX || '60')
    }
  },
  
  // Modo de entorno
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isLocal: process.env.NODE_ENV === 'local',
  isTest: process.env.NODE_ENV === 'test'
}; 