"use strict";
// Optional local smoke test: requires Playwright and its Chromium browser.
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => {
      if (error) { res.writeHead(404).end(); return; }
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type }).end(body);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/data/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [] }) }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof state !== "undefined" && !state.loading);
    const metrics = await page.evaluate(() => {
      state.records = Array.from({ length: 30000 }, (_, i) => hydrateRecord({
        dateKey: '2026-09-' + String(1 + i % 28).padStart(2, '0'), date: '2026-09-01',
        netSales: i % 7 ? 100 : -10, netUnits: i % 7 ? 1 : -1,
        productTitle: 'Test Product ' + (i % 601), sku: String(i % 601).padStart(8, '0'), orderId: String(i),
        brand: i % 2 ? 'Nike' : 'ASICS', status: i % 3 ? 'Full Price' : 'Markdown',
        region: i % 2 ? 'BC' : 'ON', shippingProvince: i % 2 ? 'British Columbia' : 'Ontario',
        group: 'Footwear', department: 'Mens', color: 'Black', className: 'Shoes', subClass: 'Lifestyle', collection: 'Test Collection', customerType: 'Returning Customer'
      }));
      state.analysisRecords = filterAnalysisRecords(state.records);
      state.periods = { currentStart: '2026-09-22', currentEnd: '2026-09-28', compareStart: '2026-09-15', compareEnd: '2026-09-21', compareBasis: 'total' };
      const start = performance.now(); renderAll();
      return { firstRenderMs: Math.round(performance.now() - start), products: state.productRows.length };
    });
    await page.waitForFunction(() => performanceCache.facets.has(filterSignature()));
    assert.equal(await page.locator("#product-tbody tr").count(), 101);
    await page.locator('[data-product-page="1"]').click();
    assert.match(await page.locator("#product-pagination").innerText(), /101-200/);
    await page.locator("#toggle-product-results").click();
    await page.evaluate(() => { state.filters.brand.add('Nike'); renderAll(); });
    await page.waitForFunction(() => performanceCache.facets.has(filterSignature()));
    assert.equal(await page.evaluate(() => productContext !== state.renderContext), true);
    await page.locator("#show-product-results").click();
    assert.equal(await page.evaluate(() => productContext === state.renderContext), true);
    await page.locator("#collapse-filters").click();
    await page.locator('[data-filter-group="collection"] summary').click();
    await page.locator('[data-filter-search="collection"]').fill("Test");
    await page.waitForTimeout(350);
    assert.equal(await page.locator('[data-filter-group="collection"]').getAttribute("open"), "");
    assert.ok(await page.locator('[data-filter-options="collection"] input').count());
    const dates = await page.evaluate(() => {
      const start = performance.now();
      state.periods.currentStart = '2026-09-01'; renderAll();
      return { dateChangeMs: Math.round(performance.now() - start), workerEnabled: Boolean(performanceCache.worker) };
    });
    assert.equal(dates.workerEnabled, true);
    await page.locator('[data-collapse-target="trend-chart"]').click();
    await page.evaluate(() => { state.periods.currentEnd = '2026-09-07'; renderAll(); });
    await page.locator('[data-collapse-target="trend-chart"]').click();
    assert.ok(await page.locator('#trend-chart svg').count());
    await page.screenshot({ path: path.join(os.tmpdir(), "dashboard-performance-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(os.tmpdir(), "dashboard-performance-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...metrics, ...dates, errors, screenshots: os.tmpdir() }));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
