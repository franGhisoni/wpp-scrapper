import { logger } from './Logger';

/**
 * Error personalizado para timeouts
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Ejecuta una función asíncrona con un timeout
 * @param fn Función a ejecutar
 * @param timeoutMs Tiempo máximo de ejecución en milisegundos
 * @param errorMessage Mensaje de error personalizado
 * @returns Resultado de la función
 * @throws TimeoutError si la función supera el timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      logger.warn({ timeoutMs }, errorMessage);
      reject(new TimeoutError(errorMessage));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Helper para ejecutar múltiples promesas en paralelo con límite de concurrencia
 * @param items Array de elementos a procesar
 * @param fn Función que procesa cada elemento
 * @param maxConcurrent Número máximo de operaciones concurrentes
 * @returns Array con los resultados
 */
export async function withConcurrencyLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  maxConcurrent: number
): Promise<R[]> {
  const results: R[] = [];
  let currentIndex = 0;
  
  logger.debug({ 
    totalItems: items.length, 
    maxConcurrent 
  }, 'Iniciando procesamiento con control de concurrencia');

  async function processNext(): Promise<void> {
    const index = currentIndex++;
    
    if (index >= items.length) {
      return;
    }
    
    try {
      const result = await fn(items[index], index);
      results[index] = result;
    } catch (error) {
      logger.error({ error, index }, 'Error en procesamiento concurrente');
      results[index] = null as unknown as R;
    }
    
    // Procesar el siguiente elemento
    return processNext();
  }

  // Iniciar procesadores según el límite de concurrencia
  const processors = Array(Math.min(items.length, maxConcurrent))
    .fill(null)
    .map(() => processNext());
  
  // Esperar a que todos los procesadores terminen
  await Promise.all(processors);
  
  logger.debug({ 
    totalProcessed: results.length 
  }, 'Procesamiento concurrente completado');
  
  return results;
} 