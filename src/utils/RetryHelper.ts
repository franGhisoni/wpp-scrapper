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
  fn: () => T | Promise<T>,
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
        const result = fn();
        // Si el resultado no es una promesa, convertirlo a una
        return result instanceof Promise ? await result : result;
      }
      
      // Calcular delay según el tipo de backoff
      const currentDelay = useExponentialBackoff
        ? delayMs * Math.pow(2, attempt - 1) // Exponencial: delayMs, delayMs*2, delayMs*4, ...
        : delayMs * attempt; // Lineal: delayMs, delayMs*2, delayMs*3, ...
      
      console.log(`Reintentando operación (intento ${attempt}/${maxRetries}) - ${errorContext || ''}`);
      
      // Esperar antes de reintentar
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      
      // Reintentar la operación
      const result = fn();
      // Si el resultado no es una promesa, convertirlo a una
      return result instanceof Promise ? await result : result;
    } catch (error) {
      lastError = error;
      
      console.warn(`Intento ${attempt}/${maxRetries} falló: ${errorContext || ''}`);
      
      // Si es el último intento, devolvemos null
      if (attempt === maxRetries) {
        console.error(`Operación falló después de ${maxRetries} reintentos: ${errorContext || ''}`);
        return null;
      }
    }
  }
  
  return null;
} 