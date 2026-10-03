module.exports = {
  apps: [{
    name: 'shengben-review-api',
    script: './index.mjs',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    time: true,
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    merge_logs: true,
    env: { NODE_ENV: 'production' },
  }],
};
