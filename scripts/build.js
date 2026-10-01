"use strict";

/**
 * Build stage: stamps the build with version, CI build number and git commit,
 * then assembles a clean dist/app folder containing only what production
 * needs. Jenkins zips that folder into the versioned artefact.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function gitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
  } catch (err) {
    return "unknown";
  }
}

const buildInfo = {
  name: pkg.name,
  version: pkg.version,
  build: process.env.BUILD_NUMBER || "local",
  commit: process.env.GIT_COMMIT_SHORT || gitCommit(),
  builtAt: new Date().toISOString(),
  node: process.version
};

fs.writeFileSync(
  path.join(root, "src", "build-info.json"),
  JSON.stringify(buildInfo, null, 2),
  "utf8"
);

const dist = path.join(root, "dist", "app");
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

fs.cpSync(path.join(root, "src"), path.join(dist, "src"), { recursive: true });
fs.copyFileSync(path.join(root, "package.json"), path.join(dist, "package.json"));
fs.copyFileSync(
  path.join(root, "package-lock.json"),
  path.join(dist, "package-lock.json")
);
fs.writeFileSync(
  path.join(dist, "build-info.json"),
  JSON.stringify(buildInfo, null, 2),
  "utf8"
);

console.log("[build] artefact assembled at dist/app");
console.log("[build] " + JSON.stringify(buildInfo));
