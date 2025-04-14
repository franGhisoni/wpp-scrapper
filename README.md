# WhatsApp API

API REST para WhatsApp Web con soporte para escaneo de grupos y gestión de sesiones en Strapi.

## Características

- Autenticación con QR Code para WhatsApp Web
- Escaneo de grupos y miembros de WhatsApp
- Almacenamiento de sesiones en Strapi CMS
- Gestión de métricas de grupos

## Requisitos

- Node.js 16+
- Strapi CMS instancia (opcional, pero recomendado)
- Navegador compatible con Puppeteer

## Instalación

```bash
npm install
```

## Variables de entorno

Crea un archivo `.env` con las siguientes variables:

```
PORT=9877
NODE_ENV=development
STRAPI_URL=http://127.0.0.1:1337
STRAPI_API_TOKEN=your-token-here
USE_STRAPI=true
BROWSER_HEADLESS=true
SESSION_STORAGE_PATH=./sessions
AUTO_CLOSE_AFTER_SCAN=true
AUTO_CLOSE_TIMEOUT=300000
```

## Ejecutar en desarrollo

```bash
npm run dev
```

## Compilar para producción

```bash
npm run build
```

## Ejecutar en producción

```bash
npm start
```

## Configuración de Strapi

Para configurar el esquema en Strapi:

```bash
npm run setup-strapi
```

## Despliegue en Render

### Configuración para Render

1. **Tipo de Servicio**: Web Service
2. **Environment**: Node
3. **Build Command**: `npm run render-build`
4. **Start Command**: `npm run render-start`
5. **Root Directory**: `/` (raíz del repositorio)

### Variables de Entorno en Render

Configura las siguientes variables de entorno en la consola de Render:

- `PORT`: 9877 (Render asignará automáticamente un puerto)
- `NODE_ENV`: production
- `STRAPI_URL`: URL de tu instancia de Strapi
- `STRAPI_API_TOKEN`: Token de API de Strapi
- `USE_STRAPI`: true
- `BROWSER_HEADLESS`: true
- `SESSION_STORAGE_PATH`: ./sessions
- `AUTO_CLOSE_AFTER_SCAN`: true
- `AUTO_CLOSE_TIMEOUT`: 300000

### Requisitos Adicionales

En la configuración de Render, asegúrate de:

1. Seleccionar un plan con recursos suficientes para ejecutar Puppeteer
2. Asignar suficiente memoria para el servicio (mínimo 512MB)
3. Configurar Puppeteer para ejecutarse en entorno serverless (ya está incluido en la configuración)

### Problemas Conocidos

- Puppeteer puede requerir ajustes adicionales en entornos sin interfaz gráfica
- El QR code debe ser escaneado rápidamente cuando se genera en entornos cloud
- Las sesiones pueden expirar más rápido en entornos de producción

## Endpoints API

### Obtener estado de autenticación

```
GET /api/whatsapp/status
```

### Generar código QR para autenticación

```
GET /api/whatsapp/qr
```

### Escanear grupos

```
POST /api/whatsapp/scan
```
Cuerpo:
```json
{
  "groupNames": ["Nombre Grupo 1", "Nombre Grupo 2"]
}
```

### Obtener información de un grupo

```
GET /api/whatsapp/group/:groupName
```

### Obtener métricas de un grupo

```
GET /api/whatsapp/group/:groupName/metrics
```

### Obtener métricas de múltiples grupos

```
POST /api/whatsapp/metrics
```
Cuerpo:
```json
{
  "groupNames": ["Nombre Grupo 1", "Nombre Grupo 2"]
}
```

### Cerrar sesión

```
POST /api/whatsapp/logout
```

## Manejo de sesiones

Esta API utiliza RemoteAuth de whatsapp-web.js para manejar la persistencia de sesiones:

1. En la primera ejecución, se genera un código QR para escanear.
2. Después de escanear, la sesión se guarda en Strapi.
3. En ejecuciones posteriores, la sesión se recupera automáticamente.

## Manejo de archivos temporales

La aplicación crea algunos archivos temporales:

- `./.wwebjs_auth/`: Directorio utilizado por RemoteAuth
- Archivos temporales ZIP durante la autenticación

Estos archivos son necesarios para el funcionamiento pero se manejan automáticamente.

## Contribución

Si deseas contribuir a este proyecto, por favor haz un fork del repositorio y crea un pull request. 