import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import electron from 'vite-plugin-electron/simple';
import react from '@vitejs/plugin-react';

const DEV_SERVER_PORT = 5173;

// Email frames inherit this policy and add their own stricter one, so remote images are allowed here
// and blocked (or allowed per message) by the frame's policy instead
function appCsp(dev: boolean): string {
  return [
    "default-src 'self'",
    // Dev only: React refresh injects an inline preamble and HMR talks over a websocket
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: cid: https: http:",
    "font-src 'self' data:",
    dev ? `connect-src 'self' ws://localhost:${DEV_SERVER_PORT}` : "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function contentSecurityPolicy(): Plugin {
  return {
    name: 'enclave-csp',
    transformIndexHtml: (_html, ctx) => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: appCsp(!!ctx.server) }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  plugins: [
    contentSecurityPolicy(),
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
      },
      preload: {
        input: path.join(__dirname, 'src/main/preload.ts'),
        // Preloads run as CommonJS; a .mjs name makes Electron load it as ESM and `require` fails
        vite: {
          build: {
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: '[name].cjs', inlineDynamicImports: true },
            },
          },
        },
      },
    }),
  ],
  server: {
    port: DEV_SERVER_PORT,
  },
});
