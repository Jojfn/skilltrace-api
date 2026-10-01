"use strict";

const path = require("path");

const DEV_SECRET = "dev-only-insecure-secret-change-me";

const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  env: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  tokenTtl: process.env.TOKEN_TTL || "2h",
  dataFile:
    process.env.DATA_FILE || path.join(__dirname, "..", "data", "skilltrace.json"),
  // Guarded fault-injection endpoint used by the pipeline's incident
  // simulation. Disabled unless explicitly switched on.
  allowChaos: process.env.ALLOW_CHAOS === "1"
};

/**
 * Refuse to start a production process with the development signing key.
 *
 * Without this the service would boot happily using a secret that is public
 * in the repository, so every token it issued could be forged by anyone who
 * read the source.
 */
function assertProductionConfig(cfg = config) {
  const problems = [];
  if (cfg.env === "production") {
    if (!cfg.jwtSecret || cfg.jwtSecret === DEV_SECRET) {
      problems.push("JWT_SECRET must be set to a non-default value in production");
    }
    if (cfg.jwtSecret && cfg.jwtSecret.length < 32) {
      problems.push("JWT_SECRET must be at least 32 characters in production");
    }
    if (cfg.allowChaos) {
      problems.push("ALLOW_CHAOS must not be enabled in production");
    }
  }
  if (problems.length) {
    throw new Error("insecure configuration: " + problems.join("; "));
  }
  return true;
}

module.exports = config;
module.exports.assertProductionConfig = assertProductionConfig;
module.exports.DEV_SECRET = DEV_SECRET;
