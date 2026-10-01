"use strict";

const express = require("express");
const config = require("../config");
const { register } = require("../metrics");

let buildInfo = { version: "0.0.0", build: "local", commit: "unknown" };
try {
  // Written by scripts/build.js during the pipeline's Build stage.
  buildInfo = require("../build-info.json");
} catch (err) {
  /* running from source without a build stamp */
}

module.exports = function healthRoutes(store) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      env: config.env,
      version: buildInfo.version,
      build: buildInfo.build,
      commit: buildInfo.commit,
      uptimeSeconds: Math.round(process.uptime()),
      counts: { users: store.count("users"), evidence: store.count("evidence") }
    });
  });

  router.get("/metrics", async (req, res) => {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  return router;
};
