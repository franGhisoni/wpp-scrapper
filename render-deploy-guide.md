# Deploying to Render without Docker

This guide explains how to deploy this WhatsApp service directly to Render without using Docker.

## Deployment Steps

1. **Create a new Web Service in Render**
   - Sign in to your Render account
   - Click "New +" and select "Web Service"
   - Connect your GitHub repository
   - Give the service a name (e.g., "wpp-scrapper")

2. **Configure Build Settings**
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

3. **Environment Variables**
   Set the following environment variables in the Render dashboard:

   ```
   NODE_ENV=production
   PORT=3001
   BROWSER_HEADLESS=true
   AUTO_CLOSE_AFTER_SCAN=false
   AUTO_CLOSE_TIMEOUT=300000
   ```

   Add any other app-specific environment variables your service needs.

4. **Advanced Settings**
   - Health Check Path: `/health`
   - Auto-Deploy: Enable (for automatic deployments when you push to the repository)

## Important Notes

- The service is configured to use the `NoAuth` strategy for WhatsApp Web, which maintains an always-on connection without session files.
- The `forceConsistentCasingInFileNames: false` option in `tsconfig.prod.json` resolves case sensitivity issues that can occur when deploying from Windows to Linux.
- The logger implementation supports both calling styles (`logger.info(message, context)` and `logger.info(context)`).

## Troubleshooting

If you encounter any issues with the deployment:

1. Check the Render logs for specific error messages
2. Verify that all environment variables are correctly set
3. Ensure your repository has the latest version of `tsconfig.prod.json` with the `forceConsistentCasingInFileNames: false` option
4. Check that both `logger.ts` and `Logger.ts` files are present in the `src/utils` directory and have the same content 