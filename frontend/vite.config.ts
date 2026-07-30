import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
  ],
  base: "/",
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // No dev proxy needed — the frontend talks to the FastAPI backend directly via
  // VITE_API_BASE_URL (see src/app/api/client.ts), defaulting to http://localhost:8000.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
