"use strict";

const express = require("express");
const crypto = require("crypto");
const { hashPassword, verifyPassword, issueToken } = require("../lib/auth");
const { authenticate } = require("../middleware/authenticate");

const VALID_ROLES = ["student", "owner"];

module.exports = function authRoutes(store) {
  const router = express.Router();

  router.post("/register", (req, res) => {
    const { email, password, name, role } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: "email, password and name are required" });
    }
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: "role must be student or owner" });
    }
    if (store.findOne("users", (u) => u.email === email)) {
      return res.status(409).json({ error: "email already registered" });
    }
    let hash;
    try {
      hash = hashPassword(password);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const user = {
      id: crypto.randomUUID(),
      email,
      name,
      role: role || "student",
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };
    store.insert("users", user);
    return res.status(201).json({
      id: user.id, email: user.email, name: user.name, role: user.role
    });
  });

  router.post("/login", (req, res) => {
    const { email, password } = req.body || {};
    const user = store.findOne("users", (u) => u.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      // Same response whether the user exists or the password is wrong, so the
      // endpoint cannot be used to enumerate registered accounts.
      return res.status(401).json({ error: "invalid credentials" });
    }
    return res.json({ token: issueToken(user), role: user.role });
  });

  router.get("/me", authenticate, (req, res) => {
    const user = store.findOne("users", (u) => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: "user not found" });
    return res.json({
      id: user.id, email: user.email, name: user.name, role: user.role
    });
  });

  return router;
};
