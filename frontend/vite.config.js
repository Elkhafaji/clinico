import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const fileStorageEnabled = process.env.VERCEL !== '1' && process.env.FILE_STORAGE_ENABLED !== 'false' && process.env.VITE_FILE_STORAGE_ENABLED !== 'false';

export default defineConfig({
  define:{__CLINICO_FILE_STORAGE_ENABLED__:JSON.stringify(fileStorageEnabled)},
  plugins:[react()],
  server:{host:'0.0.0.0',port:5173,strictPort:true,allowedHosts:true,proxy:{'/api':{target:'http://127.0.0.1:4000',changeOrigin:true}}},
  preview:{host:'0.0.0.0',allowedHosts:true},
  build:{rollupOptions:{output:{manualChunks(id){if(id.includes('/node_modules/recharts/'))return'charts';if(id.includes('/node_modules/react-router'))return'router';if(id.includes('/node_modules/lucide-react/'))return'icons';if(id.includes('/node_modules/react-dom/')||id.includes('/node_modules/react/'))return'react-vendor';}}}}
});
