import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { createService } from './server/service.mjs';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    watch: { ignored: ['**/.local/**'] },
  },
  plugins: [
    vinext(),
    {
      name: 'nowvibing-local-api',
      configureServer(server) {
        const service = createService();
        server.middlewares.use((req, res, next) => {
          void service.handle(req, res, next);
        });
        server.httpServer?.once('close', () => service.close());
      },
    },
  ],
});
