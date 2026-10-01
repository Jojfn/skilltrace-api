"use strict";

const { scoreText, proposeLevel, mapContributions } = require("../../src/lib/skillMapper");

describe("skillMapper.scoreText", () => {
  test("returns nothing for empty or blank input", () => {
    expect(scoreText("")).toEqual([]);
    expect(scoreText("   ")).toEqual([]);
    expect(scoreText(null)).toEqual([]);
    expect(scoreText(undefined)).toEqual([]);
  });

  test("maps a security commit to SCTY", () => {
    const [top] = scoreText("Add JWT authentication and rate limit to the API");
    expect(top.code).toBe("SCTY");
    expect(top.matchedKeywords).toEqual(expect.arrayContaining(["jwt", "auth"]));
  });

  test("maps a testing commit to TEST", () => {
    const codes = scoreText("Add jest tests and improve coverage").map((m) => m.code);
    expect(codes).toContain("TEST");
  });

  test("confidence saturates at three keyword hits", () => {
    const [top] = scoreText("security auth jwt encrypt hash token vulnerability");
    expect(top.confidence).toBe(1);
  });

  test("a single keyword gives partial confidence", () => {
    const [top] = scoreText("write documentation");
    expect(top.code).toBe("KNOW");
    expect(top.confidence).toBeLessThan(1);
    expect(top.confidence).toBeGreaterThan(0);
  });

  test("results are ranked by confidence", () => {
    const results = scoreText("deploy pipeline jenkins release and one test");
    const confidences = results.map((r) => r.confidence);
    const sorted = [...confidences].sort((a, b) => b - a);
    expect(confidences).toEqual(sorted);
  });

  test("unrelated text matches nothing", () => {
    expect(scoreText("bought milk on the way home")).toEqual([]);
  });
});

describe("skillMapper.proposeLevel", () => {
  test("floors at level 2 for a small amount of routine work", () => {
    expect(proposeLevel(["fix typo"])).toBe(2);
  });

  test("volume lifts the level", () => {
    const many = new Array(12).fill("implement endpoint");
    expect(proposeLevel(many)).toBe(3);
  });

  test("seniority signals lift the level", () => {
    expect(proposeLevel(["reviewed pull request from teammate"])).toBe(3);
  });

  test("caps at level 4 even with volume and seniority", () => {
    const many = new Array(50).fill("reviewed and designed the architecture");
    expect(proposeLevel(many)).toBe(4);
  });

  test("handles non-array input defensively", () => {
    expect(proposeLevel(null)).toBe(2);
    expect(proposeLevel("not an array")).toBe(2);
  });
});

describe("skillMapper.mapContributions", () => {
  const contributions = [
    "Implement evidence CRUD endpoints",
    "Add jest tests for the skill mapper",
    "Add JWT authentication middleware",
    "Add supertest integration tests",
    "Document the API in the readme"
  ];

  test("aggregates hits across contributions", () => {
    const matches = mapContributions(contributions);
    const codes = matches.map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(["PROG", "TEST", "SCTY", "KNOW"]));
  });

  test("ranks the most frequently evidenced skill first", () => {
    const matches = mapContributions(contributions);
    expect(matches[0].hits).toBeGreaterThanOrEqual(matches[matches.length - 1].hits);
  });

  test("reports the level alongside every match", () => {
    const matches = mapContributions(contributions);
    for (const m of matches) {
      expect(m.level).toBeGreaterThanOrEqual(1);
      expect(m.level).toBeLessThanOrEqual(4);
    }
  });

  test("deduplicates matched keywords", () => {
    const matches = mapContributions(["add test", "add test", "add test"]);
    const test = matches.find((m) => m.code === "TEST");
    expect(test.matchedKeywords).toEqual(Array.from(new Set(test.matchedKeywords)));
  });

  test("returns an empty list for no contributions", () => {
    expect(mapContributions([])).toEqual([]);
  });
});
