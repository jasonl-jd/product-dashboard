"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../markdown-core.js");
const actions = [{ sku: "00000001", product: "Product", action: "NEW", brand: "A", department: "Footwear" }, { sku: "00000002", product: "Second", action: "FURTHER", brand: "B", department: "Apparel" }, { sku: "00000003", product: "Missing", action: "NEW", brand: "A", department: "Footwear" }];
const options = { currentStart: "2026-09-24", currentEnd: "2026-09-24", beforeStart: "2026-09-17", beforeEnd: "2026-09-17" };
function analyze(records, opts = options) { const accumulator = core.createAnalysis(actions, opts); records.forEach(accumulator.add); return accumulator.finish(); }
const sale = (sku, dateKey, netSales, netUnits, rest = {}) => ({ sku, dateKey, netSales, netUnits, region: "ON", productTitle: "Product", ...rest });

test("real list layout, leading zeroes, typo header, and price fields", () => {
  const list = core.parseList([["Title"], [], [], ["STYLE ID", "ACTON", "STYLE NAME", "CURRENT SELL RETAIL", "NEW PRICE"], [], [46411, "FURTHER", "Hoodie", 40, 25]], "All Channels - Permanent");
  assert.equal(list.actions[0].sku, "00046411");
  assert.equal(list.actions[0].oldPrice, 40);
  assert.equal(list.actions[0].newPrice, 25);
  assert.equal(core.sku("[Shippin"), "");
  assert.equal(core.sku("4.6411E+4"), "");
  assert.equal(core.sku("AB-12"), "AB-12");
});
test("duplicates are consolidated; contradictory actions are blocked", () => {
  assert.equal(core.parseList([["SKU", "ACTION"], [1, "NEW"], [1, "NEW"]], "List").duplicates, 1);
  assert.throws(() => core.parseList([["SKU", "ACTION"], [1, "NEW"], [1, "FURTHER"]], "List"), /conflicting/);
  assert.equal(core.parseList([["SKU", "ACTION"], [1, "OTHER"], [2, "NEW"]], "List").issues.length, 1);
  assert.equal(core.parseList([["STYLE ID", "QTY ON HAND"]], "Inventory"), null);
});
test("Thursday launch compares like weekdays with total basis", () => {
  assert.deepEqual(core.presets("2026-09-24", "launch"), { currentStart: "2026-09-24", currentEnd: "2026-09-26", beforeStart: "2026-09-17", beforeEnd: "2026-09-19" });
  assert.equal(core.presets("2026-09-24", "seven").currentEnd, "2026-09-30");
  assert.equal(core.guessLaunch("SEPTEMBER 17TH.xlsb", [], 2026), "2026-09-17");
  assert.throws(() => core.days("2026-02-30", "2026-03-01"), /Invalid/);
  assert.throws(() => core.days("2026-09-24", "2026-09-01"), /366/);
  assert.throws(() => core.createAnalysis(actions, { ...options, beforeEnd: "2026-09-24" }), /overlap/);
});
test("aggregate by SKU across titles and statuses; missing is not zero", () => {
  const report = analyze([sale("1", "2026-09-24", 100, 2), sale("00000001", "2026-09-24", -10, -1, { productTitle: "Renamed", status: "Return" }), sale("1", "2026-09-17", 50, 1), sale("2", "2026-09-24", 60, 3), sale("2", "2026-09-17", 40, 2)]);
  assert.equal(report.rows[0].currentSales, 90);
  assert.equal(report.rows[0].currentUnits, 1);
  assert.equal(report.rows[0].change, 40);
  assert.equal(report.rows[2].currentSales, null);
  assert.equal(report.rows[2].matched, false);
  assert.equal(report.summaries[0].share, 0.6);
  assert.equal(report.summaries[0].review, 1);
});
test("missing dates suppress totals, not silently partial comparisons", () => {
  const report = analyze([sale("1", "2026-09-24", 100, 1)]);
  assert.equal(report.rows[0].currentSales, 100);
  assert.equal(report.rows[0].beforeSales, null);
  assert.equal(report.rows[0].change, null);
  assert.deepEqual(report.missingBefore, ["2026-09-17"]);
});
test("prior-only SKUs and returns stay included; zero baseline has no growth percentage", () => {
  const report = analyze([sale("1", "2026-09-17", 50, 1), sale("2", "2026-09-24", -10, -1)]);
  assert.equal(report.rows[0].currentSales, 0);
  assert.equal(report.rows[0].change, -50);
  assert.equal(report.rows[1].currentSales, -10);
  assert.equal(report.rows[1].changePct, null);
});
test("regional scope preserves known versus unmatched and excludes adjustment rows", () => {
  const report = analyze([sale("1", "2026-09-17", 50, 1), sale("1", "2026-09-24", 20, 1, { region: "BC" }), sale("2", "2026-09-24", 100, 0, { productTitle: "[Refund Adjustment]" })], { ...options, region: "BC", brand: "A" });
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].currentSales, 20);
  assert.equal(report.rows[0].beforeSales, 0);
  assert.equal(report.summaries[1].styles, 0);
});
test("CSV keeps missing cells blank and neutralizes formulas in imported text", () => {
  const csv = core.csv([["=HYPERLINK(\"bad\")", -10, null, "00046411"]]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"-10","","00046411"'));
});
