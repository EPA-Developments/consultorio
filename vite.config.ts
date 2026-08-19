import react from '@vitejs/plugin-react';
import dns from 'dns';
import { copyFileSync, existsSync } from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

dns.setDefaultResultOrder('verbatim');

if (!existsSync(path.join(__dirname, '.env'))) {
  copyFileSync(path.join(__dirname, '.env.defaults'), path.join(__dirname, '.env'));
}

// https://vitejs.dev/config/
export default defineConfig({
  envPrefix: ['MEDPLUM_', 'GOOGLE_'],
  plugins: [react()],
  preview: {
    port: 3008,
    allowedHosts: true,
    host: 'consultorio.medplum.com.ar',
  },
  server: {
    host: 'localhost',
    port: 3008,
  },
});
