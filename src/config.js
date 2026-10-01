"use strict";

const path = require("path");

const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  env: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "dev-only-insecure-secret-change-me",
  tokenTtl: process.env.TOKEN_TTL || "2h",
  dataFile:
    process.env.DATA_FILE || path.join(__dirname, "..", "data", "skilltrace.json"),
  // Guarded fault-injection endpoint, used by the pipeline's incident
  // simulation. Disabled unless explicitly switched on.
  allowChaos: process.env.ALLOW_CHAOS === "1"
};

module.exports = config;
