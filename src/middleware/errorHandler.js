"use strict";

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const body = { error: status === 500 ? "internal server error" : err.message };
  if (status >= 500) {
    // Surfaced in logs for the monitoring stage to pick up.
    console.error("[error]", err.stack || err.message);
  }
  res.status(status).json(body);
}

module.exports = errorHandler;
