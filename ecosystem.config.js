// PM2 Ecosystem Configuration for SmartEE Web
//
// Three independent processes / three ports — if any one dies, the others keep
// running:
//   ① smartee-frontend  static SPA  (FRONTEND_PORT)  dev 5173* / prod 4173
//   ② smartee-backend   REST API    (PORT)           dev 3003  / prod 3002
//   ③ smartee-worker    MQTT/push   (WORKER_PORT)    dev 3005  / prod 3004
//
// *In dev the frontend is normally run with `vite` (port 5173); the PM2
//  frontend app serves the built dist and is meant for staging/production.
//
// Usage:
//   pm2 start ecosystem.config.js --env production
//   pm2 start ecosystem.config.js --only smartee-worker --env production
//
// Build the frontend first:  cd client && npm run build

module.exports = {
  apps: [
    {
      name: 'smartee-backend',
      script: './server/index.js',
      instances: 1, // Single instance for Windows + IIS deployment
      exec_mode: 'fork', // Use fork mode instead of cluster for simplicity
      cwd: './', // Set working directory to root
      env: {
        NODE_ENV: 'development',
        PORT: 3003,
        // Keep the worker OUT of the API process — it runs as its own app below.
        // Setting this to true would re-merge the fault domains.
        ENABLE_MQTT_WORKER: 'false'
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3002,
        ENABLE_MQTT_WORKER: 'false'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002,
        ENABLE_MQTT_WORKER: 'false'
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 10000,
      kill_timeout: 5000
    },

    {
      name: 'smartee-worker',
      script: './worker/worker.js',
      instances: 1,
      exec_mode: 'fork',
      cwd: './',
      env: {
        NODE_ENV: 'development',
        WORKER_PORT: 3005
      },
      env_staging: {
        NODE_ENV: 'staging',
        WORKER_PORT: 3004
      },
      env_production: {
        NODE_ENV: 'production',
        WORKER_PORT: 3004
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 10000,
      kill_timeout: 5000
    },

    {
      name: 'smartee-frontend',
      script: './client/serve.js',
      instances: 1,
      exec_mode: 'fork',
      cwd: './',
      env: {
        NODE_ENV: 'development',
        FRONTEND_PORT: 4173
      },
      env_staging: {
        NODE_ENV: 'staging',
        FRONTEND_PORT: 4173
      },
      env_production: {
        NODE_ENV: 'production',
        FRONTEND_PORT: 4173
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 10000,
      kill_timeout: 5000
    }
  ]
};
