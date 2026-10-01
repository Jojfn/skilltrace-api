"use strict";

const createApp = require("../../src/app");
const Store = require("../../src/lib/store");

/** Build an app backed by a throwaway in-memory store. */
function buildTestApp() {
  const store = new Store("unused.json", { persist: false });
  return { app: createApp({ store }), store };
}

module.exports = { buildTestApp };
