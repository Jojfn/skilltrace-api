"use strict";

const { assertProductionConfig, DEV_SECRET } = require("../../src/config");

const strongSecret = "x".repeat(48);

describe("assertProductionConfig", () => {
  test("allows development to run with the default secret", () => {
    expect(
      assertProductionConfig({ env: "development", jwtSecret: DEV_SECRET, allowChaos: true })
    ).toBe(true);
  });

  test("allows staging to enable fault injection", () => {
    expect(
      assertProductionConfig({ env: "staging", jwtSecret: DEV_SECRET, allowChaos: true })
    ).toBe(true);
  });

  test("refuses production with the development secret", () => {
    expect(() =>
      assertProductionConfig({ env: "production", jwtSecret: DEV_SECRET, allowChaos: false })
    ).toThrow(/JWT_SECRET must be set/);
  });

  test("refuses production with a short secret", () => {
    expect(() =>
      assertProductionConfig({ env: "production", jwtSecret: "tooshort", allowChaos: false })
    ).toThrow(/at least 32 characters/);
  });

  test("refuses production with fault injection enabled", () => {
    expect(() =>
      assertProductionConfig({ env: "production", jwtSecret: strongSecret, allowChaos: true })
    ).toThrow(/ALLOW_CHAOS/);
  });

  test("accepts a correctly configured production process", () => {
    expect(
      assertProductionConfig({ env: "production", jwtSecret: strongSecret, allowChaos: false })
    ).toBe(true);
  });

  test("reports every problem at once", () => {
    try {
      assertProductionConfig({ env: "production", jwtSecret: "short", allowChaos: true });
    } catch (err) {
      expect(err.message).toMatch(/JWT_SECRET/);
      expect(err.message).toMatch(/ALLOW_CHAOS/);
    }
  });
});
