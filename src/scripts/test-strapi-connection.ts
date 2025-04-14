import axios from 'axios';
import dotenv from 'dotenv';
import dns from 'dns';
import { execSync } from 'child_process';

// Asegurar que las variables de entorno estén cargadas
dotenv.config();

// Set DNS to prefer IPv4
dns.setDefaultResultOrder('ipv4first');

// Force IPv4 lookup for localhost
const testUrls = [
  'http://localhost:1337/api/ping',
  'http://127.0.0.1:1337/api/ping'
];

/**
 * Script para probar la conexión a Strapi usando diferentes métodos
 */
async function testStrapi() {
  console.log('Testing Strapi connection...');
  console.log('Environment variables:');
  console.log(`STRAPI_URL: ${process.env.STRAPI_URL}`);
  console.log(`STRAPI_API_TOKEN length: ${process.env.STRAPI_API_TOKEN?.length || 'not set'}`);
  
  // Try using curl first
  console.log('\nTrying curl:');
  try {
    const curlResult = execSync('curl -I http://127.0.0.1:1337/api/ping', { encoding: 'utf8' });
    console.log(curlResult);
  } catch (error: any) {
    console.error('curl failed:', error.message || 'Unknown error');
  }
  
  // Test each URL with axios
  for (const url of testUrls) {
    try {
      console.log(`\nTesting connection to ${url}`);
      const response = await axios.get(url, {
        timeout: 5000,
        validateStatus: () => true, // Accept any status code
      });
      
      console.log(`Status: ${response.status}`);
      console.log('Response:', response.data);
    } catch (error: any) {
      console.error(`Error connecting to ${url}:`, error.message || 'Unknown error');
    }
  }
  
  console.log('\nConnection test complete.');
}

testStrapi().catch(console.error); 