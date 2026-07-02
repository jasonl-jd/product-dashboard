"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".pages-dist");

const ROOT_FILES = [
  ".nojekyll",
  "index.html",
  "styles.css",
  "app.js"
];

const DATA_FILES = [
  "manifest.json",
  "compiled-data.json"
];

main();

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  ROOT_FILES.forEach((file) => copyFileIfExists(path.join(ROOT, file), path.join(OUT_DIR, file)));

  const outDataDir = path.join(OUT_DIR, "data");
  fs.mkdirSync(outDataDir, { recursive: true });
  DATA_FILES.forEach((file) => copyFileIfExists(path.join(ROOT, "data", file), path.join(outDataDir, file)));

  copyDir(path.join(ROOT, "data", "compiled"), path.join(outDataDir, "compiled"), (entry) => entry.endsWith(".json"));

  const summary = summarizeFiles(OUT_DIR);
  console.log(`Prepared ${path.relative(ROOT, OUT_DIR)} with ${summary.count.toLocaleString()} files (${formatBytes(summary.bytes)}).`);
}

function copyFileIfExists(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(source, target, includeFile) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath, includeFile);
    } else if (!includeFile || includeFile(sourcePath)) {
      copyFileIfExists(sourcePath, targetPath);
    }
  }
}

function summarizeFiles(directory) {
  let count = 0;
  let bytes = 0;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = summarizeFiles(filePath);
      count += child.count;
      bytes += child.bytes;
    } else {
      count += 1;
      bytes += fs.statSync(filePath).size;
    }
  }

  return { count, bytes };
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
