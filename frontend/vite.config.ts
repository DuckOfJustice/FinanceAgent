import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Leitet /api-Aufrufe im Dev-Server an das Backend weiter (analog zur
      // nginx-Route in production). Backend muss dafuer per Docker mit
      // Port 8081 laufen, siehe docker-compose.yml.
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
})
