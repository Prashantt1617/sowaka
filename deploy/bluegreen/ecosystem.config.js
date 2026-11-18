// PM2 apps for the Sowaka backend, blue/green (docs/deploy/bluegreen.md).
//
// Two copies of the same server, each from its own build directory and on its own port. Only one
// runs at rest; during a deploy the other is started beside it, nginx is pointed at it once it is
// ready, and the old one is stopped (bluegreen.sh). Start one with:
//   pm2 start deploy/bluegreen/ecosystem.config.js --only sowaka-green
// dotenv loads backend/.env (cwd) for everything else; PORT here wins over the file's (dotenv does
// not override what is already set).
const common = {
  cwd: "/home/ubuntu/app/sowaka/backend",
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  // Shutdown: up to SHUTDOWN_DRAIN_MS for requests in progress, alongside the background jobs'
  // last runs (JOBS_STOP_WAIT_MS); pm2 must wait longer than both before it kills.
  kill_timeout: 75000,
};

const env = (port, color) => ({
  PORT: String(port),
  APP_COLOR: color,
  // The old copy is out of nginx when it is stopped, so a long drain keeps nobody waiting.
  SHUTDOWN_DRAIN_MS: "25000",
  JOBS_STOP_WAIT_MS: "45000",
});

module.exports = {
  apps: [
    { ...common, name: "sowaka-blue", script: "dist-blue/server.js", env: env(4000, "blue") },
    { ...common, name: "sowaka-green", script: "dist-green/server.js", env: env(4001, "green") },
  ],
};
