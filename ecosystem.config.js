"use strict";

/**
 * PM2 process definitions - the infrastructure-as-code for this project.
 *
 * Staging and production are the same artefact with different configuration:
 * different ports, different data files, and fault injection enabled only on
 * staging so the monitoring stage can simulate an incident without touching
 * production.
 */

module.exports = {
  apps: [
    {
      name: "skilltrace-staging",
      script: "src/server.js",
      cwd: "C:/skilltrace/staging/current",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "staging",
        PORT: "3101",
        DATA_FILE: "C:/skilltrace/staging/data/skilltrace.json",
        ALLOW_CHAOS: "1"
      },
      out_file: "C:/skilltrace/staging/logs/out.log",
      error_file: "C:/skilltrace/staging/logs/err.log",
      time: true
    },
    {
      name: "skilltrace-prod",
      script: "src/server.js",
      cwd: "C:/skilltrace/prod/current",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "3100",
        DATA_FILE: "C:/skilltrace/prod/data/skilltrace.json",
        ALLOW_CHAOS: "0"
      },
      out_file: "C:/skilltrace/prod/logs/out.log",
      error_file: "C:/skilltrace/prod/logs/err.log",
      time: true
    }
  ]
};
