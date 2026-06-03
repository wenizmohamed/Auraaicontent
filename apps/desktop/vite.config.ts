import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode, command}) => {
  // Load .env from both desktop dir and root monorepo
  const env = { ...loadEnv(mode, path.resolve(__dirname, '../..'), ''), ...loadEnv(mode, '.', '') };
  const comfyUrl = env.COMFYUI_API_URL || 'http://127.0.0.1:8000';
  return {
    // Electron loads the built app via file://, so its production assets must be
    // RELATIVE ('./'). The WEB build (served by nginx at the domain root) must use
    // ABSOLUTE ('/') — otherwise a cold load of any 2-segment route (e.g.
    // /invite/:token, /settings/billing) resolves assets against /invite/ →
    // /invite/assets/*.js → 404 → SPA fallback returns index.html → MIME error →
    // blank white page. Key off the ELECTRON build flag, NOT `command`.
    base: command === 'build' && process.env.ELECTRON === 'true' ? './' : '/',
    plugins: [react(), tailwindcss()],
    build: {
      // Code-split heavy deps so the main entry stays slim.  Without this the
      // bundle is 1.44MB un-gzipped — slow on mobile.  Manual chunks group
      // related packages so cache hits propagate across deploys.
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-icons': ['lucide-react'],
            'ui-motion': ['framer-motion'],
            'ui-charts': ['recharts'],
            'utils': ['zustand', 'tailwind-merge', 'react-markdown'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    define: {
      // SECURITY: Never inject API keys into the frontend bundle.
      // All provider calls go through the backend server.
      'process.env.GEMINI_API_KEY': JSON.stringify(''),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(''),
      'process.env.COMFYUI_API_URL': JSON.stringify(comfyUrl),
      'process.env.COMFYUI_CLOUD_API_KEY': JSON.stringify(''),
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
