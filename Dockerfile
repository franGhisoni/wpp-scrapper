FROM node:16-slim

# Configure apt to be more resilient
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && \
    echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80-retries && \
    echo 'APT::Get::Assume-Yes "true";' > /etc/apt/apt.conf.d/90assumeyes && \
    # Use Cloudflare mirror instead of default Debian repository
    sed -i 's/deb.debian.org/cloudfront.debian.net/g' /etc/apt/sources.list && \
    apt-get clean

# Install latest chrome dev package and fonts with robust retry logic
RUN for retry in $(seq 1 5); do \
    apt-get update --fix-missing && \
    apt-get install -y --no-install-recommends wget gnupg2 ca-certificates apt-transport-https && break; \
    echo "Retrying apt update... attempt $retry"; \
    sleep 10; \
    done && \
    # Add retry mechanism for unreliable connections
    for retry in $(seq 1 5); do \
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && break || \
    echo "Retrying download... attempt $retry"; \
    sleep 10; \
    done && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    # Update with retry and more delay
    for retry in $(seq 1 5); do \
    apt-get update --fix-missing && break || \
    echo "Retrying apt-get update... attempt $retry"; \
    sleep 15; \
    done && \
    # Install with retry and more delay
    for retry in $(seq 1 5); do \
    apt-get install -y --no-install-recommends google-chrome-stable \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 || { \
        echo "Retrying apt-get install... attempt $retry"; \
        sleep 15; \
        continue; \
    }; \
    break; \
    done && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source - first create the necessary directory structure
RUN mkdir -p ./src/utils

# Ensure logger exists - create a simple logger implementation
RUN echo "/**\n * Simple console-based logger\n */\nconst logger = {\n  info: (contextOrMessage, messageOrEmpty) => {\n    if (messageOrEmpty) {\n      console.log('[INFO] ' + messageOrEmpty, contextOrMessage);\n    } else {\n      console.log('[INFO] ' + contextOrMessage);\n    }\n  },\n  warn: (contextOrMessage, messageOrEmpty) => {\n    if (messageOrEmpty) {\n      console.warn('[WARN] ' + messageOrEmpty, contextOrMessage);\n    } else {\n      console.warn('[WARN] ' + contextOrMessage);\n    }\n  },\n  error: (contextOrMessage, messageOrEmpty) => {\n    if (messageOrEmpty) {\n      console.error('[ERROR] ' + messageOrEmpty, contextOrMessage);\n    } else {\n      console.error('[ERROR] ' + contextOrMessage);\n    }\n  },\n  debug: (contextOrMessage, messageOrEmpty) => {\n    if (messageOrEmpty) {\n      console.debug('[DEBUG] ' + messageOrEmpty, contextOrMessage);\n    } else {\n      console.debug('[DEBUG] ' + contextOrMessage);\n    }\n  }\n};\n\nexport default logger;" > ./src/utils/logger.ts

# Ensure RetryHelper.ts exists - Using string concatenation instead of template literals
RUN echo "/**\n * Retry helper que permite reintentar operaciones con backoff exponencial o lineal\n * @param fn Función a reintentar\n * @param maxRetries Número máximo de reintentos\n * @param delayMs Delay base en milisegundos entre reintentos\n * @param errorContext Contexto de error para logging\n * @param useExponentialBackoff Si se usa backoff exponencial (por defecto) o lineal\n * @returns El resultado de la función o null si falla después de todos los reintentos\n */\nexport async function retry<T>(\n  fn: () => T | Promise<T>,\n  maxRetries: number,\n  delayMs: number,\n  errorContext?: string,\n  useExponentialBackoff = true\n): Promise<T | null> {\n  let lastError: unknown;\n  \n  for (let attempt = 0; attempt <= maxRetries; attempt++) {\n    try {\n      // En el primer intento (attempt 0) ejecutamos directamente\n      if (attempt === 0) {\n        const result = fn();\n        // Si el resultado no es una promesa, convertirlo a una\n        return result instanceof Promise ? await result : result;\n      }\n      \n      // Calcular delay según el tipo de backoff\n      const currentDelay = useExponentialBackoff\n        ? delayMs * Math.pow(2, attempt - 1) // Exponencial: delayMs, delayMs*2, delayMs*4, ...\n        : delayMs * attempt; // Lineal: delayMs, delayMs*2, delayMs*3, ...\n      \n      console.log('Reintentando operación (intento ' + attempt + '/' + maxRetries + ') - ' + (errorContext || ''));\n      \n      // Esperar antes de reintentar\n      await new Promise(resolve => setTimeout(resolve, currentDelay));\n      \n      // Reintentar la operación\n      const result = fn();\n      // Si el resultado no es una promesa, convertirlo a una\n      return result instanceof Promise ? await result : result;\n    } catch (error) {\n      lastError = error;\n      \n      console.warn('Intento ' + attempt + '/' + maxRetries + ' falló: ' + (errorContext || ''));\n      \n      // Si es el último intento, devolvemos null\n      if (attempt === maxRetries) {\n        console.error('Operación falló después de ' + maxRetries + ' reintentos: ' + (errorContext || ''));\n        return null;\n      }\n    }\n  }\n  \n  return null;\n}" > ./src/utils/RetryHelper.ts

# Copy all source files
COPY . .

# Create directories for session storage
RUN mkdir -p ./.wwebjs_auth
RUN mkdir -p ./tmp
RUN chmod -R 777 ./.wwebjs_auth
RUN chmod -R 777 ./tmp

# Build app
RUN npm run build

# Add additional dependencies for puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Setup environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV AUTO_CLOSE_AFTER_SCAN=true
ENV AUTO_CLOSE_TIMEOUT=300000

# Open port
EXPOSE 3001

# Start app
CMD npm start 