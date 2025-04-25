import { logger } from './Logger';

/**
 * Retry helper que permite reintentar operaciones con backoff exponencial o lineal
 * @param fn Función a reintentar
 * @param maxRetries Número máximo de reintentos
 * @param delayMs Delay base en milisegundos entre reintentos
 * @param errorContext Contexto de error para logging
 * @param useExponentialBackoff Si se usa backoff exponencial (por defecto) o lineal
 * @returns El resultado de la función o null si falla después de todos los reintentos
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
  errorContext?: string,
  useExponentialBackoff = true
): Promise<T | null> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // En el primer intento (attempt 0) ejecutamos directamente
      if (attempt === 0) {
        return await fn();
      }
      
      // Calcular delay según el tipo de backoff
      const currentDelay = useExponentialBackoff
        ? delayMs * Math.pow(2, attempt - 1) // Exponencial: delayMs, delayMs*2, delayMs*4, ...
        : delayMs * attempt; // Lineal: delayMs, delayMs*2, delayMs*3, ...
      
      logger.debug({
        attempt,
        maxRetries,
        delay: currentDelay,
        context: errorContext
      }, 'Reintentando operación...');
      
      // Esperar antes de reintentar
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      
      // Reintentar la operación
      return await fn();
    } catch (error) {
      lastError = error;
      
      logger.warn({
        attempt,
        maxRetries,
        error,
        context: errorContext
      }, `Intento ${attempt}/${maxRetries} falló`);
      
      // Si es el último intento, devolvemos null
      if (attempt === maxRetries) {
        logger.error({
          maxRetries,
          error,
          context: errorContext
        }, 'Operación falló después de todos los reintentos');
        return null;
      }
    }
  }
  
  return null;
} 