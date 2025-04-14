import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api';

// Configurar variables de entorno
dotenv.config();

// Crear app Express
const app = express();
const PORT = process.env.PORT || 9876;

// Middleware
app.use(cors());
app.use(express.json());

// Rutas
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Rutas de API
app.use('/api', apiRoutes);

// Iniciar servidor
app.listen(PORT, () => {
  // Determinar la URL base según el entorno
  const isProduction = process.env.NODE_ENV === 'production';
  const publicUrl = process.env.PUBLIC_URL || 'https://wpp-scrapper.onrender.com';
  const baseUrl = isProduction ? publicUrl : `http://localhost:${PORT}`;
  
  console.log(`⚡️ Server is running at ${baseUrl}`);
  console.log(`📑 Health check available at ${baseUrl}/health`);
  console.log(`🚀 API endpoints available at ${baseUrl}/api`);
  console.log('==> Your service is live 🎉');
}); 