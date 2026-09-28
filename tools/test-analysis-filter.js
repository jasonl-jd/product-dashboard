"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadApp() {
  const app = vm.createContext({
    window: { addEventListener() {} },
    document: { addEventListener() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), app);
  vm.runInContext("dom.status = { textContent: '', classList: { toggle() {} } };", app);
  return app;
}

function record(productTitle, netSales, netUnits, orderId = "7181580009654", status = "Full Price") {
  return { productTitle, netSales, netUnits, orderId, orderKey: orderId, status, dateKey: "2026-09-22" };
}

test("only zero-sales, zero-unit shipping rows are newly excluded", () => {
  const app = loadApp();
  for (const title of ["[Shipping]", " [sHiPpInG] ", "Shipping"]) {
    assert.equal(app.isExcludedAnalysisRecord(record(title, 0, 0)), true);
  }
  for (const [sales, units] of [[10, 0], [-10, 0], [0, 1], [0, -1]]) {
    assert.equal(app.isExcludedAnalysisRecord(record("[Shipping]", sales, units)), false);
  }
  assert.equal(app.isExcludedAnalysisRecord(record("Shipping Jacket", 0, 0)), false);
  assert.equal(app.isExcludedAnalysisRecord(record("Product", 0, 0)), false);
  assert.equal(app.isExcludedAnalysisRecord(record("[Refund Adjustment]", 10, 0)), true);
});

test("shipping does not add Full Price orders and sales/units stay unchanged", () => {
  const app = loadApp();
  const rows = [
    record("[Shipping]", 0, 0),
    record("Markdown product", 50, 1, "7181580009654", "Markdown"),
    record("Full Price product", 100, 2, "7186265276598"),
    record("[Shipping]", 0, 0, "shipping-only")
  ];
  const eligible = app.filterAnalysisRecords(rows);
  const before = app.summarize(rows);
  const after = app.summarize(eligible);
  assert.equal(after.netSales, before.netSales);
  assert.equal(after.netUnits, before.netUnits);
  assert.equal(after.orders, 2);
  const split = app.buildStatusSplit(eligible, [], false);
  assert.equal(split.rows.find(row => row.value === "Full Price").orders, 1);
  assert.equal(split.rows.find(row => row.value === "Markdown").orders, 1);
  assert.equal(rows.length, 4);
});

test("hydrated cached records and compiled records use the same exclusion", () => {
  const app = loadApp();
  const rows = [record("[Shipping]", 0, 0), record("Product", 50, 1)];
  assert.equal(app.filterAnalysisRecords(rows.map(app.hydrateRecord)).length, 1);
  const fields = Object.keys(rows[0]);
  app.applyCompiledRepositoryData({
    fields,
    records: rows.map(row => fields.map(field => row[field])),
    files: []
  });
  assert.equal(app.getAnalysisRecords().length, 1);
  assert.equal(app.getAnalysisRecords()[0].productTitle, "Product");
  assert.equal(vm.runInContext("state.records.length", app), 2);
});
