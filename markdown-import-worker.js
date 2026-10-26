"use strict";

importScripts("markdown-core.js");
self.onmessage = event => {
  try {
    // Pages bundles the pinned reader; local development can fetch it on demand.
    // Workbook contents remain in this worker and are never uploaded.
    try { importScripts("vendor/xlsx.full.min.js"); }
    catch { importScripts("https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"); }
    const { buffer, name, year } = event.data;
    const directory = XLSX.read(buffer, { type: "array", bookSheets: true });
    const sheetNames = directory.SheetNames.filter(sheet => !/^inventory\b/i.test(sheet));
    const workbook = XLSX.read(buffer, { type: "array", sheets: sheetNames, cellFormula: false, cellHTML: false, cellStyles: false });
    const lists = [];
    for (const sheetName of sheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
      const list = MarkdownCore.parseList(rows, sheetName);
      if (list) lists.push({ ...list, fileName: name, launchDate: MarkdownCore.guessLaunch(name, rows, year) });
    }
    if (!lists.length) throw new Error("No markdown list found. Required headers: STYLE ID (or SKU) and ACTION (NEW/FURTHER).");
    self.postMessage({ lists });
  } catch (error) {
    self.postMessage({ error: `${error.message || error}. For an offline import, export the markdown sheet as CSV.` });
  }
};
