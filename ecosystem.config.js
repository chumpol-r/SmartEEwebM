// PM2 Ecosystem Configuration for SmartEE Web
// Usage: pm2 start ecosystem.config.js --env production

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
        PORT: 3003
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3002
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002
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
    }
  ]
};
