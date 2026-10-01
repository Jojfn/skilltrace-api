"use strict";

const { verifyToken } = require("../lib/auth");

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  const claims = verifyToken(token);
  if (!claims) {
    return res.status(401).json({ error: "invalid or expired token" });
  }
  req.user = { id: claims.sub, email: claims.email, role: claims.role };
  return next();
}

function requireRole(role) {
  return function roleGuard(req, res, next) {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "requires role: " + role });
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
