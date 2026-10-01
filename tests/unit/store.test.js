"use strict";

const Store = require("../../src/lib/store");

describe("Store (in-memory mode)", () => {
  let store;
  beforeEach(() => {
    store = new Store("unused.json", { persist: false });
  });

  test("starts empty", () => {
    expect(store.count("users")).toBe(0);
    expect(store.count("evidence")).toBe(0);
  });

  test("inserts and finds documents", () => {
    store.insert("users", { id: "1", email: "a@b.com" });
    expect(store.count("users")).toBe(1);
    expect(store.findOne("users", (u) => u.id === "1").email).toBe("a@b.com");
  });

  test("findOne returns null when nothing matches", () => {
    expect(store.findOne("users", (u) => u.id === "nope")).toBeNull();
  });

  test("find returns every match", () => {
    store.insert("evidence", { id: "1", userId: "u1" });
    store.insert("evidence", { id: "2", userId: "u1" });
    store.insert("evidence", { id: "3", userId: "u2" });
    expect(store.find("evidence", (e) => e.userId === "u1")).toHaveLength(2);
  });

  test("updates an existing document", () => {
    store.insert("evidence", { id: "1", status: "draft" });
    const updated = store.update("evidence", "1", { status: "submitted" });
    expect(updated.status).toBe("submitted");
  });

  test("update returns null for an unknown id", () => {
    expect(store.update("evidence", "missing", { status: "x" })).toBeNull();
  });

  test("removes a document and reports whether it removed anything", () => {
    store.insert("evidence", { id: "1" });
    expect(store.remove("evidence", "1")).toBe(true);
    expect(store.remove("evidence", "1")).toBe(false);
    expect(store.count("evidence")).toBe(0);
  });

  test("reset clears every collection", () => {
    store.insert("users", { id: "1" });
    store.insert("evidence", { id: "1" });
    store.reset();
    expect(store.count("users")).toBe(0);
    expect(store.count("evidence")).toBe(0);
  });
});
