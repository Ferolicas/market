module.exports = {
  apps: [{
    name: "market", cwd: "/var/www/market", script: "pnpm", args: "start",
    env: { NODE_ENV: "production", PORT: "4010" },
    max_restarts: 10, restart_delay: 3000, max_memory_restart: "700M",
    kill_timeout: 8000, listen_timeout: 10000,
  }],
};
