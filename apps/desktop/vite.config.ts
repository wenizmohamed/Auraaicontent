import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // Load .env from both desktop dir and root monorepo
  const env = { ...loadEnv(mode, path.resolve(__dirname, '../..'), ''), ...loadEnv(mode, '.', '') };
  const isElectron = process.env.ELECTRON === 'true';
  const comfyUrl = env.COMFYUI_API_URL || 'http://127.0.0.1:8000';
  return {
    base: isElectron ? './' : '/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
      'process.env.COMFYUI_API_URL': JSON.stringify(comfyUrl),
      'process.env.COMFYUI_CLOUD_API_KEY': JSON.stringify(env.COMFYUI_CLOUD_API_KEY || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/comfyui-api': {
          target: comfyUrl,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/comfyui-api/, ''),
        },
      },
    },
  };
});
