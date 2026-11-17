import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The pre-boarding portal: a standalone page for candidates (offer link → end of week 1).
// VITE_API_BASE_URL points at the backend (default http://localhost:4000).
// VITE_MOCK=1 (dev only) serves fixture data for every state; production builds drop it.
// Production lives at <company>.getsowaka.com/onboarding/ (CloudFront routes /onboarding to it); dev at the root.
export default defineConfig(({ mode }) => ({
  base: process.env.PORTAL_BASE_PATH ?? (mode === 'production' ? '/onboarding/' : '/'),
  plugins: [react()],
  server: { port: 5181, strictPort: true },
  // pdf.js loads on demand; pre-bundle it so the first PDF doesn't trigger a dev reload.
  optimizeDeps: { include: ['pdfjs-dist'] },
  preview: { port: 5181 },
  build: { target: 'es2022', sourcemap: false },
}));
