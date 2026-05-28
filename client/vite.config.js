import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        host: true, // listen on all interfaces so tunnels/LAN can reach it
        // Allow ngrok tunnel domains (Vite 7 blocks unknown Host headers by default).
        // ngrok free now issues *.ngrok-free.dev URLs.
        allowedHosts: ['.ngrok-free.dev', '.ngrok.dev', '.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
        proxy: {
            '/api': {
                target: 'http://localhost:3003',
                changeOrigin: true,
                secure: false,
            }
        }
    },
    resolve: {
        alias: {
            // Fix for xlsx package in Vite
            './cptable': './cptable.js'
        }
    },
    optimizeDeps: {
        include: ['xlsx'],
        esbuildOptions: {
            // Node.js global to browser globalThis
            define: {
                global: 'globalThis'
            }
        }
    },
    build: {
        commonjsOptions: {
            transformMixedEsModules: true
        },
        rollupOptions: {
            output: {
                manualChunks: {
                    // Split vendor chunks for better caching
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'chart-vendor': ['recharts'],
                    'flow-vendor': ['reactflow'],
                    'xlsx-vendor': ['xlsx'],
                    'mqtt-vendor': ['mqtt']
                }
            }
        },
        chunkSizeWarningLimit: 1000 // Increase limit to 1000 kB
    }
})
