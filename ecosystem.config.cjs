// pm2 start ecosystem.config.cjs   (the server reads .env itself)
module.exports = {
  apps: [
    {
      name: 'antwen-music',
      script: 'apps/server/dist/index.js',
      cwd: __dirname,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
    },
  ],
}
