"use strict";

/**
 * Rule-based SFIA 8 skill mapper.
 *
 * Takes raw contribution text (commit messages, pull request titles, task
 * names) and maps it onto SFIA skill codes with a confidence score and a
 * proposed responsibility level.
 *
 * Deliberately deterministic rather than probabilistic: the mapping has to be
 * explainable to the student whose evidence it produces, and testable in CI.
 */

const SKILLS = [
  {
    code: "PROG",
    name: "Programming/software development",
    keywords: ["implement", "refactor", "endpoint", "api", "feature", "module",
               "function", "bugfix", "bug fix", "build", "component"]
  },
  {
    code: "TEST",
    name: "Testing",
    keywords: ["test", "tests", "jest", "spec", "coverage", "assertion",
               "regression", "supertest", "fixture"]
  },
  {
    code: "SCTY",
    name: "Information security",
    keywords: ["security", "auth", "authentication", "authorisation", "jwt",
               "vulnerability", "cve", "encrypt", "hash", "sanitise",
               "sanitize", "rate limit", "token"]
  },
  {
    code: "DBDS",
    name: "Database design",
    keywords: ["schema", "migration", "index", "query", "database", "store",
               "persistence"]
  },
  {
    code: "HSIN",
    name: "Systems installation/decommissioning",
    keywords: ["deploy", "deployment", "pipeline", "ci", "cd", "release",
               "jenkins", "rollout", "provision", "infrastructure"]
  },
  {
    code: "KNOW",
    name: "Knowledge management",
    keywords: ["document", "documentation", "readme", "guide", "comment",
               "diagram", "runbook"]
  }
];

const SENIORITY_SIGNALS = ["review", "reviewed", "design", "designed",
                           "architecture", "lead", "mentor", "refactor"];

function normalise(text) {
  return String(text || "").toLowerCase();
}

/**
 * Score a single contribution string against every known skill.
 * @returns {Array} ranked matches, highest confidence first
 */
function scoreText(text) {
  const haystack = normalise(text);
  if (!haystack.trim()) return [];

  const results = [];
  for (const skill of SKILLS) {
    const matched = skill.keywords.filter((kw) => haystack.includes(kw));
    if (matched.length === 0) continue;
    // Confidence saturates at three distinct keyword hits: one hit is a weak
    // signal, three or more is about as certain as keyword matching can be.
    const confidence = Math.min(1, matched.length / 3);
    results.push({
      code: skill.code,
      name: skill.name,
      confidence: Number(confidence.toFixed(2)),
      matchedKeywords: matched
    });
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Propose a SFIA responsibility level.
 * Level 2 is the floor for evidenced work; volume and seniority signals lift
 * it, and it is capped at 4 because nothing in a capstone context evidences
 * the organisational influence SFIA requires above that.
 */
function proposeLevel(contributions) {
  const list = Array.isArray(contributions) ? contributions : [];
  const volume = list.length;
  const joined = normalise(list.join(" "));
  const hasSeniority = SENIORITY_SIGNALS.some((s) => joined.includes(s));

  let level = 2;
  if (volume >= 10) level += 1;
  if (hasSeniority) level += 1;
  return Math.max(1, Math.min(4, level));
}

/**
 * Map a batch of contributions to a ranked set of evidenced skills.
 */
function mapContributions(contributions) {
  const list = Array.isArray(contributions) ? contributions : [];
  const totals = new Map();

  for (const item of list) {
    for (const match of scoreText(item)) {
      const current = totals.get(match.code);
      if (current) {
        current.hits += 1;
        current.confidence = Math.max(current.confidence, match.confidence);
        for (const kw of match.matchedKeywords) current.keywords.add(kw);
      } else {
        totals.set(match.code, {
          code: match.code,
          name: match.name,
          hits: 1,
          confidence: match.confidence,
          keywords: new Set(match.matchedKeywords)
        });
      }
    }
  }

  const level = proposeLevel(list);
  return Array.from(totals.values())
    .map((t) => ({
      code: t.code,
      name: t.name,
      level,
      hits: t.hits,
      confidence: t.confidence,
      matchedKeywords: Array.from(t.keywords).sort()
    }))
    .sort((a, b) => b.hits - a.hits || b.confidence - a.confidence);
}

module.exports = { SKILLS, scoreText, proposeLevel, mapContributions };
