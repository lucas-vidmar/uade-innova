import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, '../shared'),
        },
    },
    server: {
        proxy: {
            '/api': {
                target: 'https://func-dashboard-ingest-q47bia47kk3na.azurewebsites.net',
                changeOrigin: true,
            },
        },
    },
});
