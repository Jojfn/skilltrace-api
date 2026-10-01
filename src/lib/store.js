"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Minimal persistent document store.
 *
 * Deliberately file-backed rather than a database: the project has to build
 * and test on any agent without native modules or a running database server.
 * Writes are atomic (write to a temp file, then rename) so a crash mid-write
 * cannot leave a half-written file behind.
 */
class Store {
  constructor(file, { persist = true } = {}) {
    this.file = file;
    this.persist = persist;
    this.data = { users: [], evidence: [] };
    if (this.persist) this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, "utf8");
        const parsed = JSON.parse(raw);
        this.data = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence : []
        };
      }
    } catch (err) {
      // A corrupt store must not take the service down on boot.
      this.data = { users: [], evidence: [] };
    }
  }

  _flush() {
    if (!this.persist) return;
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  reset() {
    this.data = { users: [], evidence: [] };
    this._flush();
  }

  insert(collection, doc) {
    this.data[collection].push(doc);
    this._flush();
    return doc;
  }

  find(collection, predicate) {
    return this.data[collection].filter(predicate);
  }

  findOne(collection, predicate) {
    return this.data[collection].find(predicate) || null;
  }

  update(collection, id, patch) {
    const item = this.findOne(collection, (d) => d.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    this._flush();
    return item;
  }

  remove(collection, id) {
    const before = this.data[collection].length;
    this.data[collection] = this.data[collection].filter((d) => d.id !== id);
    const removed = before !== this.data[collection].length;
    if (removed) this._flush();
    return removed;
  }

  count(collection) {
    return this.data[collection].length;
  }
}

module.exports = Store;
