"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");
const core = require("../performance-core.js");
const root = path.resolve(__dirname, "..");

test("single-pass facets match exclusion-of-self scans", () => {
  const keys = ["brand", "status", "region"];
  const rows = Array.from({ length: 1500 }, (_, i) => ({
    brand: ["Nike", "Adidas", "ASICS"][i % 3],
    status: ["Full Price", "Markdown", "Return", ""][i % 4],
    region: ["BC", "ON", "QC + Atlantic", "Prairies", "ON"][i % 5]
  }));
  const encoded = core.encode(rows, keys, "(blank)");
  for (const selections of [[], [["Nike"]], [null, ["Markdown"]], [["Nike", "ASICS"], ["Full Price"], ["ON"]], [[], null, ["BC"]]]) {
    const allowed = keys.map((_, d) => selections[d] ? Uint8Array.from(encoded.values[d], v => +selections[d].includes(v)) : null);
    const counts = core.countFacets(encoded.columns, encoded.values.map(v => v.length), allowed);
    keys.forEach((key, d) => encoded.values[d].forEach((value, code) => {
      const expected = rows.filter(row => (row[key] || "(blank)") === value && keys.every((other, j) => j === d || !selections[j] || selections[j].includes(row[other] || "(blank)"))).length;
      assert.equal(counts[d][code], expected);
    }));
  }
});

test("date index preserves inclusive periods, overlaps, and missing-date exclusion", () => {
  const rows = [{ dateKey: "2026-01-03", netSales: 3 }, { dateKey: "2026-01-01", netSales: 1 }, { dateKey: "2026-01-02", netSales: -2 }, { dateKey: "", netSales: 99 }];
  const index = core.dateIndex(rows);
  assert.deepEqual(index.summary, { min: "2026-01-01", max: "2026-01-03" });
  for (const [start, end] of [["", ""], ["2026-01-01", "2026-01-02"], ["2026-01-02", "2026-01-03"], ["2026-01-03", "2026-01-01"]]) {
    const actual = index.select(start, end, r => r.netSales > 0);
    const expected = rows.filter(r => r.dateKey && (!start || r.dateKey >= start) && (!end || r.dateKey <= end) && r.netSales > 0);
    assert.deepEqual(new Set(actual), new Set(expected));
  }
});

test("bounded loader preserves manifest order and waits for in-flight failures", async () => {
  let active = 0;
  let peak = 0;
  const result = await core.mapLimit([30, 1, 5, 2], 2, async (delay, index) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, delay));
    active--;
    return index;
  });
  assert.deepEqual(result, [0, 1, 2, 3]);
  assert.equal(peak, 2);
  let finished = false;
  await assert.rejects(core.mapLimit([0, 1, 2], 2, async index => {
    if (index === 0) { await new Promise(resolve => setTimeout(resolve, 10)); throw Error("file missing"); }
    await new Promise(resolve => setTimeout(resolve, 30));
    finished = true;
  }), /file missing/);
  assert.equal(finished, true);
});

function loadApp(extra = {}) {
  const app = vm.createContext({ window: { addEventListener() {} }, document: { addEventListener() {} }, ...extra });
  for (const file of ["performance-core.js", "app.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), app);
  return app;
}

test("context cache preserves all comparison modes and invalidates filters/data", () => {
  const app = loadApp();
  vm.runInContext(`
    state.analysisRecords = Array.from({ length: 35 }, (_, i) => ({
      dateKey: '2026-01-' + String(Math.min(i + 1, 31)).padStart(2, '0'),
      brand: i % 2 ? 'Nike' : 'ASICS', netSales: i + 1, netUnits: 1, orderId: String(i)
    }));
    state.periods = { currentStart: '2026-01-25', currentEnd: '2026-01-31', compareStart: '2026-01-01', compareEnd: '2026-01-24' };
  `, app);
  for (const mode of ["total", "average-week", "average-period", "rolling-4-week"]) {
    app.mode = mode;
    vm.runInContext(`state.periods.compareBasis = mode;`, app);
    const context = app.buildRenderContext();
    assert.equal(app.buildRenderContext(), context);
    const expected = vm.runInContext(`(() => {
      const all = applyDimensionFilters(getAnalysisRecords());
      const basis = getComparisonBasis(state.periods);
      return { current: summarize(all.filter(r => inDateRange(r, state.periods.currentStart, state.periods.currentEnd))),
        compare: summarize(applyComparisonBasis(all.filter(r => inDateRange(r, basis.sourceStart, basis.sourceEnd)), basis)) };
    })()`, app);
    assert.deepEqual(context.currentSummary, expected.current);
    assert.deepEqual(context.compareSummary, expected.compare);
    assert.equal(app.getCompareTrendRecords(), context.comparisonSource);
  }
  const before = app.buildRenderContext();
  const counts = app.getFilterCounts("brand");
  assert.equal(app.getFilterCounts("brand"), counts);
  vm.runInContext(`state.filters.brand.add('Nike');`, app);
  const filtered = app.buildRenderContext();
  assert.notEqual(filtered, before);
  assert.ok(filtered.current.every(r => r.brand === "Nike"));
  vm.runInContext(`state.filters.brand.clear(); state.filterAllSelected.brand = true; state.filterExclusions.brand.add('Nike');`, app);
  assert.ok(app.buildRenderContext().current.every(r => r.brand !== "Nike"));
  vm.runInContext(`state.analysisRecords = [...state.analysisRecords];`, app);
  assert.notEqual(app.getFilterCounts("brand"), counts);
});

test("product pagination keeps full totals and exports every row", () => {
  const elements = {};
  const app = loadApp({ document: { addEventListener() {}, querySelectorAll: () => [], getElementById: id => elements[id] ||= { innerHTML: "" } } });
  vm.runInContext(`
    dom.productTbody = { innerHTML: '' }; dom.productThead = { innerHTML: '' }; dom.productHeading = {};
    state.productRows = Array.from({ length: 251 }, (_, i) => ({ productTitle: 'Product ' + i, sku: String(i), netSales: 10, netUnits: 1, salesShare: 1 / 251 }));
    getTableColumns = () => [{ key: 'productTitle', label: 'Product' }, { key: 'netSales', label: 'Net Sales' }];
    renderTableHeader = () => '<th>Header</th>';
    state.periods = { currentStart: '2026-01-01', currentEnd: '2026-01-07' };
    downloadFile = (name, text) => { globalThis.exported = text; };
    renderProductTable(state.productRows);
  `, app);
  assert.equal(vm.runInContext(`(dom.productTbody.innerHTML.match(/<tr/g) || []).length`, app), 101);
  vm.runInContext(`productPage = 2; renderProductTable(state.productRows); exportProductCsv();`, app);
  assert.equal(vm.runInContext(`(dom.productTbody.innerHTML.match(/<tr/g) || []).length`, app), 52);
  assert.equal(app.exported.split("\n").length, 252);
  assert.match(vm.runInContext(`dom.productTbody.innerHTML`, app), /2,510/);
});

test("actual worker script returns facet counts", async () => {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const fs = require('node:fs'); const vm = require('node:vm');
    global.self = global;
    global.importScripts = file => vm.runInThisContext(fs.readFileSync(file, 'utf8'));
    global.postMessage = data => parentPort.postMessage(data);
    vm.runInThisContext(fs.readFileSync('filter-count-worker.js', 'utf8'));
    parentPort.on('message', data => self.onmessage({data}));
  `, { eval: true });
  try {
    const reply = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    worker.postMessage({ type: "init", columns: [new Uint32Array([0, 1, 0])], sizes: [2] });
    worker.postMessage({ signature: "test", allowed: [new Uint8Array([1, 0])] });
    const result = await reply;
    assert.equal(result.signature, "test");
    assert.deepEqual([...result.counts[0]], [2, 1]);
  } finally { await worker.terminate(); }
});

test("late worker replies cannot replace counts for the current filters or dataset", () => {
  const workers = [];
  class FakeWorker {
    constructor() { this.sent = []; workers.push(this); }
    postMessage(data) { this.sent.push(data); }
    terminate() { this.terminated = true; }
  }
  const app = loadApp({ Worker: FakeWorker });
  vm.runInContext(`
    state.analysisRecords = [{ brand: 'Nike', status: 'Full Price' }, { brand: 'ASICS', status: 'Markdown' }];
    refreshVisibleFilterOptions = () => { getFilterCounts('status'); };
  `, app);
  app.getFilterCounts("status");
  const first = workers[0].sent[1];
  vm.runInContext(`state.filters.brand.add('Nike');`, app);
  assert.ok([...app.getFilterCounts("status").values()].every(value => value === null));
  const data = workers[0].sent[0];
  workers[0].onmessage({ data: { signature: first.signature, counts: core.countFacets(data.columns, data.sizes, first.allowed) } });
  const second = workers[0].sent[2];
  assert.notEqual(second.signature, first.signature);
  workers[0].onmessage({ data: { signature: second.signature, counts: core.countFacets(data.columns, data.sizes, second.allowed) } });
  assert.equal(app.getFilterCounts("status").get("Markdown"), 0);
  vm.runInContext(`state.analysisRecords = [{ brand: 'Nike', status: 'Return' }];`, app);
  app.getFilterCounts("status");
  workers[0].onmessage({ data: { signature: first.signature, counts: [] } });
  assert.equal(workers[0].terminated, true);
  workers[1].onerror();
  assert.equal(app.getFilterCounts("status").get("Return"), 1);
});

test("optional local CSV matches legacy range/filter totals", { skip: !process.env.PERFORMANCE_TEST_CSV }, async () => {
  const app = loadApp({ setTimeout, window: { addEventListener() {}, setTimeout } });
  const parsed = await app.parseSalesCsv(fs.readFileSync(process.env.PERFORMANCE_TEST_CSV, "utf8"), "local.csv", "test", () => {});
  app.fixture = parsed.records;
  app.minDate = parsed.minDate;
  app.maxDate = parsed.maxDate;
  vm.runInContext(`
    state.analysisRecords = filterAnalysisRecords(fixture);
    state.periods = { currentStart: minDate, currentEnd: maxDate, compareStart: minDate, compareEnd: maxDate, compareBasis: 'total' };
  `, app);
  for (const status of [null, "Full Price", "Markdown", "Return"]) {
    app.statusChoice = status;
    vm.runInContext(`state.filters.status.clear(); if (statusChoice) state.filters.status.add(statusChoice);`, app);
    const context = app.buildRenderContext();
    const expected = vm.runInContext(`summarize(applyDimensionFilters(getAnalysisRecords()).filter(r => inDateRange(r, minDate, maxDate)))`, app);
    assert.ok(Math.abs(context.currentSummary.netSales - expected.netSales) < 0.000001);
    assert.equal(context.currentSummary.netUnits, expected.netUnits);
    assert.equal(context.currentSummary.orders, expected.orders);
    assert.equal(context.compareSummary.netUnits, expected.netUnits);
  }
});
