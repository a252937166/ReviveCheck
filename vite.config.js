import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { host: '127.0.0.1', watch: { ignored: ['**/video/**', '**/artifacts/**', '**/.revivecheck/**', '**/.hyperframes/**'] } }, build: { outDir: 'dist' } });
