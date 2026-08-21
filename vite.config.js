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

// Extra Host headers to accept when serving through Vite (dev or `vite preview`)
// behind a reverse proxy / public domain. Vite rejects unknown hosts by default
// (DNS-rebinding protection), so a public URL like machado.limao.uk must be
// listed here. Comma-separated, e.g. VITE_ALLOWED_HOSTS=machado.limao.uk.
// NOTE: the recommended production path serves the built SPA from uvicorn (see
// scripts/setup-prod.sh), where Vite isn't involved and this setting is moot.
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

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
  server: { headers: crossOriginHeaders, allowedHosts },
  preview: { headers: crossOriginHeaders, allowedHosts },
}));
