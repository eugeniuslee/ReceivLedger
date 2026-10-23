import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', exclude: [...configDefaults.exclude, 'test/v2/**'] },
  build: { rollupOptions: { input: { main: 'index.html', v2: 'v2.html' }, output: { manualChunks: {
    supabase: ['@supabase/supabase-js'], ethereum: ['ethers'], react: ['react', 'react-dom'],
  } } } },
});
