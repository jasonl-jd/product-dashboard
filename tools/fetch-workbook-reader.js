"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

async function main() {
  const base = "https://cdn.sheetjs.com/xlsx-0.20.3/package/";
  const directory = path.resolve(__dirname, "..", "vendor");
  const files = [["dist/xlsx.full.min.js", "xlsx.full.min.js"], ["LICENSE", "sheetjs-LICENSE.txt"]];
  await fs.mkdir(directory, { recursive: true });
  for (const [source, target] of files) {
    const response = await fetch(base + source, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Workbook reader download failed: ${source} (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const content = bytes.toString("utf8");
    if (/^\s*</.test(content) || (target.endsWith(".js") && (bytes.length < 500000 || !content.includes("0.20.3")))) throw new Error(`Unexpected workbook reader response for ${source}.`);
    await fs.writeFile(path.join(directory, target), bytes);
    console.log(`${target}: ${bytes.length} bytes, SHA-256 ${crypto.createHash("sha256").update(bytes).digest("hex")}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
