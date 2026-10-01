"use strict";

const client = require("prom-client");

const register = new client.Registry();
register.setDefaultLabels({ app: "skilltrace-api" });
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: "skilltrace_http_requests_total",
  help: "Total HTTP requests handled, by method, route and status code",
  labelNames: ["method", "route", "status"],
  registers: [register]
});

const httpDuration = new client.Histogram({
  name: "skilltrace_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register]
});

const evidenceCreated = new client.Counter({
  name: "skilltrace_evidence_created_total",
  help: "Evidence statements created",
  registers: [register]
});

const endorsements = new client.Counter({
  name: "skilltrace_endorsements_total",
  help: "Endorsement decisions recorded, by outcome",
  labelNames: ["outcome"],
  registers: [register]
});

function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    const route = (req.route && req.route.path) || req.path || "unknown";
    const labels = {
      method: req.method,
      route: typeof route === "string" ? route : "unknown",
      status: String(res.statusCode)
    };
    httpRequests.inc(labels);
    end(labels);
  });
  next();
}

module.exports = {
  register,
  metricsMiddleware,
  httpRequests,
  evidenceCreated,
  endorsements
};
