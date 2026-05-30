// PM2 process configuration for the AWS EC2 (non-Docker) deployment.
//
// This file is ONLY for the EC2 + PM2 + ALB + RDS + S3 deployment described in
// docs/AWS_EC2_NON_DOCKER_DEPLOYMENT.md. It does NOT use Docker.
//
// Assumptions:
//   - The repo is deployed to /var/www/plethora on the EC2 host.
//   - The API has been built (apps/api/dist/index.js exists) via `npm run build:api`.
//   - The web app has been built (apps/web/.next exists) via `npm run build:web`.
//   - Real secrets live in apps/api/.env and apps/web/.env.production on the host,
//     NOT in this file.
//
// Usage on the server (from /var/www/plethora):
//   pm2 start ecosystem.config.cjs       # or: npm run prod:start:pm2
//   pm2 restart ecosystem.config.cjs     # or: npm run prod:restart:pm2
//   pm2 logs                             # or: npm run prod:logs
//   pm2 status                           # or: npm run prod:status

module.exports = {
  apps: [
    {
      // Fastify API — listens on 127.0.0.1/0.0.0.0:3001, reached only by the ALB.
      name: "plethora-api",
      cwd: "/var/www/plethora/apps/api",
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        // PORT / HOST / TRUST_PROXY etc. are read from apps/api/.env by the app.
      },
    },
    {
      // Next.js web app — served on 0.0.0.0:3000, reached only by the ALB.
      name: "plethora-web",
      cwd: "/var/www/plethora/apps/web",
      // Invoke the Next.js CLI directly so PM2 manages the node process.
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3000",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
