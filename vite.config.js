import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

// Read dev token from huggingface.token file if present.
// Only injected in development; production builds get an empty string.
let devHfToken = '';
try {
  devHfToken = readFileSync('./huggingface.token', 'utf-8').trim();
} catch { /* file absent — no default token */ }

const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: {
    include: ['@xenova/transformers'],
  },
  define: {
    // Inject token only in dev; empty string in production.
    __DEV_HF_TOKEN__: JSON.stringify(mode === 'development' ? devHfToken : ''),
  },
  server: { headers: crossOriginHeaders },
  preview: { headers: crossOriginHeaders },
}));
