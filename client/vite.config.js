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
                target: 'http://localhost:3002',
                changeOrigin: true,
                secure: false,
            }
        }
    }
})
