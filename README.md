# WhatsApp Web API

API simplificada que utiliza whatsapp-web.js para interactuar con WhatsApp Web, escanear grupos y obtener métricas.

## Características

- Sistema de autenticación robusto usando RemoteAuth
- Persistencia de sesiones en Strapi
- Escaneo de grupos de WhatsApp
- Obtención de métricas de grupos
- Manejo eficiente de recursos

## Requisitos

- Node.js 14 o superior
- Strapi CMS (puede estar en un servidor remoto)
- Token de API de Strapi

## Configuración

1. Clona el repositorio
2. Instala las dependencias: `npm install`
3. Crea un archivo `.env` con la siguiente configuración:

```
PORT=3001
STRAPI_URL=http://127.0.0.1:1337
STRAPI_API_TOKEN=tu_token_de_strapi
AUTO_CLOSE_AFTER_SCAN=true
AUTO_CLOSE_TIMEOUT=180000
```

4. Configura Strapi ejecutando: `npm run setup-strapi`
5. Inicia la aplicación: `npm run dev`

## Actualización

Si estás actualizando desde una versión anterior, ejecuta:

```
npm run upgrade
```

Este comando realizará:
- Limpieza de directorios temporales
- Verificación de variables de entorno
- Configuración del esquema en Strapi

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