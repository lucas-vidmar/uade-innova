import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        {
            name: 'mock-guard',
            configResolved(config) {
                if (config.mode === 'production' && process.env.VITE_USE_MOCK) {
                    throw new Error(
                        'ERROR: VITE_USE_MOCK is set in production. Remove it before deploying.'
                    );
                }
            },
        },
    ],
});
