"use strict";

const express = require("express");
const { mapContributions, SKILLS } = require("../lib/skillMapper");
const { authenticate } = require("../middleware/authenticate");

module.exports = function skillRoutes() {
  const router = express.Router();

  router.get("/catalogue", (req, res) => {
    res.json({ count: SKILLS.length, skills: SKILLS.map((s) => ({ code: s.code, name: s.name })) });
  });

  router.post("/map", authenticate, (req, res) => {
    const { contributions } = req.body || {};
    if (!Array.isArray(contributions)) {
      return res.status(400).json({ error: "contributions must be an array of strings" });
    }
    if (contributions.length > 500) {
      return res.status(413).json({ error: "too many contributions in one request (max 500)" });
    }
    const matches = mapContributions(contributions);
    return res.json({ analysed: contributions.length, matches });
  });

  return router;
};
