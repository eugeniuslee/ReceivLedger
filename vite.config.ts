import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node' },
  build: { rollupOptions: { output: { manualChunks: {
    supabase: ['@supabase/supabase-js'], ethereum: ['ethers'], react: ['react', 'react-dom'],
  } } } },
});
