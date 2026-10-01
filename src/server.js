"use strict";

const createApp = require("./app");
const config = require("./config");

// Fail fast rather than serve traffic with an insecure configuration.
config.assertProductionConfig(config);

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(
    "[skilltrace] listening on port " + config.port + " (env=" + config.env + ")"
  );
});

function shutdown(signal) {
  console.log("[skilltrace] " + signal + " received, shutting down");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = server;
