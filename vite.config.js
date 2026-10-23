import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          katex: ['katex'],
          prosemirror: [
            'prosemirror-state',
            'prosemirror-view',
            'prosemirror-model',
            'prosemirror-keymap',
            'prosemirror-commands',
            'prosemirror-history',
            'prosemirror-inputrules',
            'prosemirror-schema-list',
            'prosemirror-tables',
            'prosemirror-markdown',
          ],
        },
      },
    },
  },
});
