import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Mediabunny and the optional AAC encoder are large by nature; the AAC encoder is lazy loaded.
    chunkSizeWarningLimit: 1200,
  },
})
