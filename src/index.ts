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
  console.log(`⚡️ Server is running at http://localhost:${PORT}`);
  console.log(`📑 Health check available at http://localhost:${PORT}/health`);
  console.log(`🚀 API endpoints available at http://localhost:${PORT}/api`);
}); 