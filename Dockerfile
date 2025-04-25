FROM node:16-slim

# Configure apt to be more resilient
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && \
    echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80-retries && \
    echo 'APT::Get::Assume-Yes "true";' > /etc/apt/apt.conf.d/90assumeyes && \
    apt-get clean

# Install latest chrome dev package and fonts with robust retry logic
RUN for retry in $(seq 1 5); do \
    apt-get update --fix-missing && \
    apt-get install -y --no-install-recommends wget gnupg2 ca-certificates apt-transport-https && break; \
    echo "Retrying apt update... attempt $retry"; \
    sleep 10; \
    done

# Add Google Chrome repository and key
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'

# Install Chrome and fonts
RUN apt-get update --fix-missing && \
    apt-get install -y --no-install-recommends google-chrome-stable \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Create utils directory structure
RUN mkdir -p ./src/utils

# Create logger.ts with proper implementation
RUN echo "/**\n * Simple console-based logger\n */\nconst logger = {\n  info: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.log('[INFO] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.log('[INFO] ' + messageOrContext);\n      }\n    } else {\n      console.log('[INFO]', messageOrContext);\n    }\n  },\n  warn: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.warn('[WARN] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.warn('[WARN] ' + messageOrContext);\n      }\n    } else {\n      console.warn('[WARN]', messageOrContext);\n    }\n  },\n  error: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.error('[ERROR] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.error('[ERROR] ' + messageOrContext);\n      }\n    } else {\n      console.error('[ERROR]', messageOrContext);\n    }\n  },\n  debug: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.debug('[DEBUG] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.debug('[DEBUG] ' + messageOrContext);\n      }\n    } else {\n      console.debug('[DEBUG]', messageOrContext);\n    }\n  }\n};\n\nexport default logger;" > ./src/utils/logger.ts

# Create a case-insensitive alias file
RUN echo "/**\n * Simple console-based logger\n */\nconst logger = {\n  info: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.log('[INFO] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.log('[INFO] ' + messageOrContext);\n      }\n    } else {\n      console.log('[INFO]', messageOrContext);\n    }\n  },\n  warn: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.warn('[WARN] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.warn('[WARN] ' + messageOrContext);\n      }\n    } else {\n      console.warn('[WARN]', messageOrContext);\n    }\n  },\n  error: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.error('[ERROR] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.error('[ERROR] ' + messageOrContext);\n      }\n    } else {\n      console.error('[ERROR]', messageOrContext);\n    }\n  },\n  debug: (messageOrContext: string | any, contextOrEmpty?: any) => {\n    if (typeof messageOrContext === 'string') {\n      if (contextOrEmpty) {\n        console.debug('[DEBUG] ' + messageOrContext, contextOrEmpty);\n      } else {\n        console.debug('[DEBUG] ' + messageOrContext);\n      }\n    } else {\n      console.debug('[DEBUG]', messageOrContext);\n    }\n  }\n};\n\nexport default logger;" > ./src/utils/Logger.ts

# Create RetryHelper for group operations
RUN echo "/**\n * Retry helper que permite reintentar operaciones con backoff exponencial o lineal\n * @param fn Función a reintentar\n * @param maxRetries Número máximo de reintentos\n * @param delayMs Delay base en milisegundos entre reintentos\n * @param errorContext Contexto de error para logging\n * @param useExponentialBackoff Si se usa backoff exponencial (por defecto) o lineal\n * @returns El resultado de la función o null si falla después de todos los reintentos\n */\nexport async function retry<T>(\n  fn: () => T | Promise<T>,\n  maxRetries: number,\n  delayMs: number,\n  errorContext?: string,\n  useExponentialBackoff = true\n): Promise<T | null> {\n  let lastError: unknown;\n  \n  for (let attempt = 0; attempt <= maxRetries; attempt++) {\n    try {\n      // En el primer intento (attempt 0) ejecutamos directamente\n      if (attempt === 0) {\n        const result = fn();\n        // Si el resultado no es una promesa, convertirlo a una\n        return result instanceof Promise ? await result : result;\n      }\n      \n      // Calcular delay según el tipo de backoff\n      const currentDelay = useExponentialBackoff\n        ? delayMs * Math.pow(2, attempt - 1) // Exponencial: delayMs, delayMs*2, delayMs*4, ...\n        : delayMs * attempt; // Lineal: delayMs, delayMs*2, delayMs*3, ...\n      \n      console.log('Reintentando operación (intento ' + attempt + '/' + maxRetries + ') - ' + (errorContext || ''));\n      \n      // Esperar antes de reintentar\n      await new Promise(resolve => setTimeout(resolve, currentDelay));\n      \n      // Reintentar la operación\n      const result = fn();\n      // Si el resultado no es una promesa, convertirlo a una\n      return result instanceof Promise ? await result : result;\n    } catch (error) {\n      lastError = error;\n      \n      console.warn('Intento ' + attempt + '/' + maxRetries + ' falló: ' + (errorContext || ''));\n      \n      // Si es el último intento, devolvemos null\n      if (attempt === maxRetries) {\n        console.error('Operación falló después de ' + maxRetries + ' reintentos: ' + (errorContext || ''));\n        return null;\n      }\n    }\n  }\n  \n  return null;\n}" > ./src/utils/RetryHelper.ts

# Copy all source files
COPY . .

# Create a custom tsconfig for the build
RUN echo '{\n  "extends": "./tsconfig.json",\n  "compilerOptions": {\n    "sourceMap": false,\n    "removeComments": true,\n    "forceConsistentCasingInFileNames": false\n  },\n  "exclude": [\n    "node_modules",\n    "**/*.test.ts",\n    "**/*.spec.ts",\n    "**/*.e2e-spec.ts",\n    "src/routes/whatsapp.routes.ts", \n    "src/routes/strapi.routes.ts",\n    "src/controllers/WhatsAppController.ts"\n  ],\n  "include": [\n    "src/**/*.ts"\n  ]\n}' > ./tsconfig.prod.json

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
ENV BROWSER_HEADLESS=true
ENV AUTO_CLOSE_AFTER_SCAN=false
ENV AUTO_CLOSE_TIMEOUT=300000

# Open port
EXPOSE 3001

# Start app
CMD ["node", "build/index.js"] 