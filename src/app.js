"use strict";

const express = require("express");
const config = require("./config");
const Store = require("./lib/store");
const { metricsMiddleware } = require("./metrics");
const errorHandler = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth.routes");
const evidenceRoutes = require("./routes/evidence.routes");
const skillRoutes = require("./routes/skills.routes");
const healthRoutes = require("./routes/health.routes");

function createApp(options = {}) {
  const store = options.store || new Store(config.dataFile, { persist: true });
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(metricsMiddleware);

  app.use("/api/auth", authRoutes(store));
  app.use("/api/evidence", evidenceRoutes(store));
  app.use("/api/skills", skillRoutes());
  app.use("/", healthRoutes(store));

  // Fault injection for the pipeline's monitoring/incident-simulation stage.
  // Never reachable unless ALLOW_CHAOS=1 is set on the process.
  if (config.allowChaos) {
    app.get("/debug/boom", () => {
      throw new Error("simulated failure for monitoring validation");
    });
  }

  app.use((req, res) => res.status(404).json({ error: "not found" }));
  app.use(errorHandler);

  app.locals.store = store;
  return app;
}

module.exports = createApp;
