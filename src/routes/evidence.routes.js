"use strict";

const express = require("express");
const crypto = require("crypto");
const { authenticate, requireRole } = require("../middleware/authenticate");
const { evidenceCreated, endorsements } = require("../metrics");

const STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  ENDORSED: "endorsed",
  DECLINED: "declined"
};

module.exports = function evidenceRoutes(store) {
  const router = express.Router();
  router.use(authenticate);

  router.post("/", (req, res) => {
    const { title, skillCode, situation, task, action, result, artefacts } = req.body || {};
    if (!title || !skillCode) {
      return res.status(400).json({ error: "title and skillCode are required" });
    }
    const doc = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      title,
      skillCode,
      situation: situation || "",
      task: task || "",
      action: action || "",
      result: result || "",
      artefacts: Array.isArray(artefacts) ? artefacts : [],
      status: STATUS.DRAFT,
      endorsedBy: null,
      endorsedAt: null,
      declineReason: null,
      createdAt: new Date().toISOString()
    };
    store.insert("evidence", doc);
    evidenceCreated.inc();
    return res.status(201).json(doc);
  });

  router.get("/", (req, res) => {
    const mine = store.find("evidence", (e) => e.userId === req.user.id);
    return res.json({ count: mine.length, items: mine });
  });

  router.get("/:id", (req, res) => {
    const doc = store.findOne("evidence", (e) => e.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "evidence not found" });
    if (doc.userId !== req.user.id && req.user.role !== "owner") {
      return res.status(403).json({ error: "not your evidence" });
    }
    return res.json(doc);
  });

  router.put("/:id", (req, res) => {
    const doc = store.findOne("evidence", (e) => e.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "evidence not found" });
    if (doc.userId !== req.user.id) {
      return res.status(403).json({ error: "not your evidence" });
    }
    if (doc.status === STATUS.ENDORSED) {
      // An endorsement vouches for specific wording; editing afterwards would
      // let a student alter a claim someone else has already signed.
      return res.status(409).json({ error: "endorsed evidence cannot be edited" });
    }
    const editable = ["title", "situation", "task", "action", "result", "artefacts"];
    const patch = {};
    for (const key of editable) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        patch[key] = req.body[key];
      }
    }
    return res.json(store.update("evidence", doc.id, patch));
  });

  router.delete("/:id", (req, res) => {
    const doc = store.findOne("evidence", (e) => e.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "evidence not found" });
    if (doc.userId !== req.user.id) {
      return res.status(403).json({ error: "not your evidence" });
    }
    store.remove("evidence", doc.id);
    return res.status(204).send();
  });

  router.post("/:id/submit", (req, res) => {
    const doc = store.findOne("evidence", (e) => e.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "evidence not found" });
    if (doc.userId !== req.user.id) {
      return res.status(403).json({ error: "not your evidence" });
    }
    if (!doc.result || !doc.result.trim()) {
      return res.status(400).json({ error: "result is required before submission" });
    }
    return res.json(store.update("evidence", doc.id, { status: STATUS.SUBMITTED }));
  });

  router.post("/:id/endorse", requireRole("owner"), (req, res) => {
    const doc = store.findOne("evidence", (e) => e.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "evidence not found" });
    if (doc.status !== STATUS.SUBMITTED) {
      return res.status(409).json({ error: "only submitted evidence can be endorsed" });
    }
    endorsements.inc({ outcome: "endorsed" });
    return res.json(store.update("evidence", doc.id, {
      status: STATUS.ENDORSED,
      endorsedBy: req.user.email,
      endorsedAt: new Date().toISOString()
    }));
  });

  router.post("/:id/decline", requireRole("owner"), (req, res) => {
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ error: "reason is required" });
    const doc = store.findOne("evidence", (e) => e.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "evidence not found" });
    if (doc.status !== STATUS.SUBMITTED) {
      return res.status(409).json({ error: "only submitted evidence can be declined" });
    }
    endorsements.inc({ outcome: "declined" });
    return res.json(store.update("evidence", doc.id, {
      status: STATUS.DECLINED,
      declineReason: reason
    }));
  });

  return router;
};
