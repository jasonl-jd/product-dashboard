"use strict";

// Shared by the browser, workbook worker, and regression tests.
const MarkdownCore = (() => {
  const text = value => String(value ?? "").trim();
  const header = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  function sku(value) {
    const key = text(value);
    if (!key || /^(\(blank\)|false|#|\[)/i.test(key) || /^[\d.]+e[+-]?\d+$/i.test(key)) return "";
    return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "").padStart(8, "0") : key.toUpperCase();
  }
  function number(value) {
    if (value === null || value === undefined || text(value) === "") return null;
    const parsed = Number(text(value).replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  function parseList(rows, sheetName) {
    const headerRow = rows.findIndex(row => {
      const keys = row.map(header);
      return (keys.includes("styleid") || keys.includes("sku")) && (keys.includes("action") || keys.includes("acton"));
    });
    if (headerRow < 0) return null;
    const keys = rows[headerRow].map(header);
    const col = (...names) => keys.findIndex(key => names.includes(key));
    const indexes = { sku: col("styleid", "sku"), action: col("action", "acton"), product: col("stylename", "product", "producttitle"), brand: col("brand"), department: col("dept", "department"), oldPrice: col("currentsellretail", "previousprice"), newPrice: col("newprice"), msrp: col("msrp") };
    const actions = new Map();
    const issues = [];
    let duplicates = 0;
    rows.slice(headerRow + 1).forEach((row, index) => {
      if (!row.some(value => text(value))) return;
      const action = text(row[indexes.action]).toUpperCase();
      const key = sku(row[indexes.sku]);
      if (!key || !["NEW", "FURTHER"].includes(action)) {
        issues.push(`Row ${headerRow + index + 2}: invalid STYLE ID or ACTION.`);
        return;
      }
      const item = { sku: key, action, product: text(row[indexes.product]) || key, brand: text(row[indexes.brand]) || "Unassigned", department: text(row[indexes.department]) || "Unassigned", oldPrice: number(row[indexes.oldPrice]), newPrice: number(row[indexes.newPrice]), msrp: number(row[indexes.msrp]) };
      if (actions.has(key)) {
        const prior = actions.get(key);
        if (prior.action !== item.action || prior.oldPrice !== item.oldPrice || prior.newPrice !== item.newPrice) throw new Error(`${sheetName}: conflicting markdown actions for SKU ${key}.`);
        duplicates += 1;
      } else actions.set(key, item);
    });
    if (!actions.size) throw new Error(`${sheetName}: no valid NEW or FURTHER rows.`);
    return { sheetName, actions: Array.from(actions.values()), issues, duplicates, retailOnly: /retail\s*only/i.test(sheetName) };
  }
  function day(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("Enter all four period dates.");
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid period date.");
    return date;
  }
  function shift(value, days) { const date = day(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
  function presets(date, mode) {
    const weekday = day(date).getUTCDay();
    const currentEnd = mode === "seven" ? shift(date, 6) : shift(date, 6 - weekday);
    return { currentStart: date, currentEnd, beforeStart: shift(date, -7), beforeEnd: shift(currentEnd, -7) };
  }
  function days(start, end) {
    const length = Math.round((day(end) - day(start)) / 86400000) + 1;
    if (length < 1 || length > 366) throw new Error("Each period must be between 1 and 366 days, with start before end.");
    return Array.from({ length }, (_, index) => shift(start, index));
  }
  function guessLaunch(name, rows, year) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const content = `${name} ${rows.slice(0, 4).flat().join(" ")}`.toLowerCase();
    const iso = content.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    for (let index = 0; index < months.length; index += 1) {
      const match = content.match(new RegExp(`${months[index]}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[ ,]+(20\\d{2}))?`));
      if (match) return `${match[2] || year}-${String(index + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    }
    return "";
  }
  function createAnalysis(actions, options) {
    const currentDays = days(options.currentStart, options.currentEnd);
    const beforeDays = days(options.beforeStart, options.beforeEnd);
    if (options.currentStart <= options.beforeEnd && options.beforeStart <= options.currentEnd) throw new Error("Current and before periods must not overlap.");
    const rows = new Map(actions.filter(item => (!options.brand || item.brand === options.brand) && (!options.department || item.department === options.department)).map(item => [item.sku, { ...item, currentSales: 0, currentUnits: 0, beforeSales: 0, beforeUnits: 0, currentRows: 0, beforeRows: 0, known: false }]));
    const loadedDays = new Set();
    function add(record) {
      const title = text(record.productTitle).toLowerCase().replace(/^\[(.*)\]$/, "$1");
      if (title === "refund adjustment" || (title === "shipping" && Number(record.netSales) === 0 && Number(record.netUnits) === 0)) return;
      const date = record.dateKey;
      if (!date) return;
      loadedDays.add(date);
      const row = rows.get(sku(record.sku));
      if (!row) return;
      row.known = true;
      if (options.region && record.region !== options.region) return;
      const period = date >= options.currentStart && date <= options.currentEnd ? "current" : date >= options.beforeStart && date <= options.beforeEnd ? "before" : "";
      if (!period) return;
      row[`${period}Sales`] += Number(record.netSales) || 0;
      row[`${period}Units`] += Number(record.netUnits) || 0;
      row[`${period}Rows`] += 1;
    }
    function finish() {
      const missingCurrent = currentDays.filter(date => !loadedDays.has(date));
      const missingBefore = beforeDays.filter(date => !loadedDays.has(date));
      const currentComplete = missingCurrent.length === 0;
      const beforeComplete = missingBefore.length === 0;
      const result = Array.from(rows.values()).map(row => {
        const matched = row.currentRows > 0 || row.beforeRows > 0;
        const currentSales = matched && currentComplete ? row.currentSales : null;
        const currentUnits = matched && currentComplete ? row.currentUnits : null;
        const beforeSales = matched && beforeComplete ? row.beforeSales : null;
        const beforeUnits = matched && beforeComplete ? row.beforeUnits : null;
        const change = currentSales !== null && beforeSales !== null ? currentSales - beforeSales : null;
        return { ...row, currentSales, currentUnits, beforeSales, beforeUnits, matched, review: !matched ? (row.known ? "No activity in selected scope/periods" : "SKU not found in loaded sales") : (!currentComplete || !beforeComplete ? "Incomplete date coverage" : "Matched"), change, unitChange: currentUnits !== null && beforeUnits !== null ? currentUnits - beforeUnits : null, changePct: change !== null && beforeSales > 0 ? change / beforeSales : null };
      });
      const summaries = ["NEW", "FURTHER"].map(action => {
        const subset = result.filter(row => row.action === action);
        const matched = subset.filter(row => row.matched);
        const total = key => matched.length && matched.every(row => row[key] !== null) ? matched.reduce((n, row) => n + row[key], 0) : null;
        const currentSales = total("currentSales");
        const beforeSales = total("beforeSales");
        const change = currentSales !== null && beforeSales !== null ? currentSales - beforeSales : null;
        return { action, styles: subset.length, matched: matched.length, review: subset.length - matched.length, currentSales, currentUnits: total("currentUnits"), beforeSales, beforeUnits: total("beforeUnits"), change, unitChange: total("unitChange"), changePct: change !== null && beforeSales > 0 ? change / beforeSales : null };
      });
      const totalSales = result.reduce((total, row) => total + (row.currentSales || 0), 0);
      for (const row of [...result, ...summaries]) row.share = row.currentSales !== null && totalSales > 0 ? row.currentSales / totalSales : null;
      return { rows: result, summaries, totalSales, missingCurrent, missingBefore, currentDays: currentDays.length, beforeDays: beforeDays.length, options };
    }
    return { add, finish };
  }
  function csv(rows) {
    return "\uFEFF" + rows.map(row => row.map(value => {
      let valueText = value === null || value === undefined ? "" : String(value);
      if (typeof value === "string" && /^[\s]*[=+@-]/.test(valueText)) valueText = "'" + valueText;
      return '"' + valueText.replace(/"/g, '""') + '"';
    }).join(",")).join("\r\n");
  }
  return { sku, parseList, presets, days, guessLaunch, createAnalysis, csv };
})();
if (typeof module !== "undefined") module.exports = MarkdownCore;
