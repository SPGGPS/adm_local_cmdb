import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))
const frtVersion = process.env.VITE_APP_VERSION || version
export default defineConfig({
  plugins: [react()],
  define: { __FRT_VERSION__: JSON.stringify(frtVersion) },
  server: { port: 5173, proxy: { '/v1': { target: 'http://localhost:8000', changeOrigin: true } } },
})
