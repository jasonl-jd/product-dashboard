"use strict";

window.__PRODUCT_DASHBOARD_APP_LOADED__ = true;
window.addEventListener("error", (event) => reportGlobalError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => reportGlobalError(event.reason));

const DATA_MANIFEST_URL = "data/manifest.json";
const DATA_CACHE_DB = "product-performance-dashboard";
const DATA_CACHE_STORE = "parsed-files";
const DATA_CACHE_VERSION = "parsed-csv-v5";
const BLANK = "(blank)";
const MAX_FILTER_OPTIONS = 180;
const SKU_DISPLAY_WIDTH = 8;
const TREND_SUGGESTION_LIMIT = 20;
const TREND_SKU_SUGGESTION_MIN = 5;
const TREND_TEXT_SUGGESTION_MIN = 4;
const PRICE_STATUS_LABELS = ["Full Price", "Markdown"];
const STATUS_DISPLAY_ORDER = ["Full Price", "Markdown", "Return"];

const DIMENSIONS = [
  { key: "shippingProvince", label: "Shipping Province", headers: ["Shipping Province"] },
  { key: "region", label: "Region", headers: ["Region"] },
  { key: "status", label: "Status", headers: ["Status"] },
  { key: "group", label: "Group", headers: ["Group"] },
  { key: "department", label: "Department", headers: ["Department"] },
  { key: "color", label: "Color", headers: ["Color"] },
  { key: "brand", label: "Brand", headers: ["Brand"] },
  { key: "className", label: "Class", headers: ["Class"] },
  { key: "subClass", label: "Sub-Class", headers: ["Sub-Class", "Sub Class", "Subclass"] },
  { key: "collection", label: "Collection", headers: ["Collection"] },
  { key: "customerType", label: "Customer Type", headers: ["Customer Type"] }
];

const REGION_DEFS = [
  { key: "BC", label: "BC", provinces: ["British Columbia"] },
  { key: "ON", label: "ON", provinces: ["Ontario"] },
  { key: "Prairies", label: "Prairies", provinces: ["Alberta", "Saskatchewan", "Manitoba"] },
  { key: "QC + Atlantic", label: "QC + Atlantic", provinces: ["Quebec", "Prince Edward Island", "Newfoundland and Labrador", "Nova Scotia", "New Brunswick"] }
];

const PROVINCE_TO_REGION = new Map(
  REGION_DEFS.flatMap((region) => region.provinces.map((province) => [normalizeRegionProvince(province), region.label]))
);

const FIELD_DEFS = [
  { key: "sku", label: "SKU", headers: ["SKU"] },
  { key: "productTitle", label: "Product Title", headers: ["Product Title", "Product"] },
  { key: "orderId", label: "Order ID", headers: ["Order ID", "Order"] },
  { key: "date", label: "Date", headers: ["Date", "Order Date"] },
  { key: "netSales", label: "Net Sales", headers: ["Net Sales"] },
  { key: "netUnits", label: "Net Quantity", headers: ["Net Quantity", "Net Units", "Net Units Sold"] },
  ...DIMENSIONS
];

const SORTERS = {
  value: (row) => row.value.toLocaleLowerCase(),
  status: (row) => row.status,
  netSales: (row) => row.netSales,
  salesShare: (row) => row.salesShare,
  netUnits: (row) => row.netUnits,
  unitsShare: (row) => row.unitsShare,
  compareSales: (row) => row.compareSales,
  change: (row) => row.change,
  changePct: (row) => row.changePct ?? Number.NEGATIVE_INFINITY
};

const PIVOT_COLUMN_DEFS = [
  { key: "value", label: "Name" },
  { key: "status", label: "Status" },
  { key: "netSales", label: "Net Sales", numeric: true },
  { key: "salesShare", label: "% Sales", numeric: true },
  { key: "netUnits", label: "Net Units", numeric: true },
  { key: "unitsShare", label: "% Units", numeric: true },
  { key: "compareSales", label: "Compare Sales", numeric: true },
  { key: "change", label: "Change", numeric: true },
  { key: "changePct", label: "Change %", numeric: true }
];

const PRODUCT_COLUMN_DEFS = [
  { key: "productTitle", label: "Product" },
  { key: "sku", label: "SKU" },
  { key: "status", label: "Status" },
  { key: "netSales", label: "Net Sales", numeric: true },
  { key: "netUnits", label: "Net Units Sold", numeric: true },
  { key: "salesShare", label: "% Sales", numeric: true },
  { key: "change", label: "Sales Change", numeric: true },
  { key: "unitChange", label: "Units Change", numeric: true },
  { key: "changePct", label: "Change %", numeric: true }
];

const COLUMN_DEFS_BY_TABLE = {
  pivot: PIVOT_COLUMN_DEFS,
  product: PRODUCT_COLUMN_DEFS
};

const DEFAULT_COLUMN_ORDERS = {
  pivot: PIVOT_COLUMN_DEFS.map((column) => column.key),
  product: PRODUCT_COLUMN_DEFS.map((column) => column.key)
};

const state = {
  records: [],
  files: [],
  rowKeys: new Set(),
  filters: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, new Set()])),
  filterSearch: {},
  filterOpen: {},
  productSort: {
    key: "netSales",
    dir: "desc"
  },
  pivotRows: [],
  productRows: [],
  regionalProductRows: [],
  trendProductQuery: "",
  trendGrain: "week",
  columnOrders: {
    pivot: [],
    product: []
  },
  dateTouched: false,
  loading: false
};

const dom = {};
const currencyFormat = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const compactCurrencyFormat = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1 });
const numberFormat = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 });
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
let filterSearchTimer = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  collectDom();
  initializeColumnOrders();
  populateDimensionSelect();
  renderColumnSettings();
  bindEvents();
  await refreshRepositoryData({ preserveDates: false });
}

function collectDom() {
  Object.assign(dom, {
    currentStart: document.querySelector("#current-start"),
    currentEnd: document.querySelector("#current-end"),
    compareStart: document.querySelector("#compare-start"),
    compareEnd: document.querySelector("#compare-end"),
    allDates: document.querySelector("#all-dates"),
    previousPeriod: document.querySelector("#previous-period"),
    refreshData: document.querySelector("#refresh-data"),
    dimensionSelect: document.querySelector("#dimension-select"),
    sortSelect: document.querySelector("#sort-select"),
    sortDir: document.querySelector("#sort-dir"),
    rowLimit: document.querySelector("#row-limit"),
    exportCsv: document.querySelector("#export-csv"),
    exportProductCsv: document.querySelector("#export-product-csv"),
    clearFilters: document.querySelector("#clear-filters"),
    filters: document.querySelector("#filters"),
    status: document.querySelector("#status"),
    dataRange: document.querySelector("#data-range"),
    recordCount: document.querySelector("#record-count"),
    kpiSales: document.querySelector("#kpi-sales"),
    kpiSalesDelta: document.querySelector("#kpi-sales-delta"),
    kpiUnits: document.querySelector("#kpi-units"),
    kpiUnitsDelta: document.querySelector("#kpi-units-delta"),
    kpiOrders: document.querySelector("#kpi-orders"),
    kpiOrdersDelta: document.querySelector("#kpi-orders-delta"),
    chartHeading: document.querySelector("#chart-heading"),
    activeDimension: document.querySelector("#active-dimension"),
    barChart: document.querySelector("#bar-chart"),
    trendHeading: document.querySelector("#trend-heading"),
    trendGrain: document.querySelector("#trend-grain"),
    trendProductInput: document.querySelector("#trend-product-input"),
    trendProductOptions: document.querySelector("#trend-product-options"),
    clearTrendProduct: document.querySelector("#clear-trend-product"),
    trendChart: document.querySelector("#trend-chart"),
    fileTbody: document.querySelector("#file-tbody"),
    pivotHeading: document.querySelector("#pivot-heading"),
    pivotThead: document.querySelector("#pivot-thead"),
    pivotTbody: document.querySelector("#pivot-tbody"),
    productHeading: document.querySelector("#product-heading"),
    productThead: document.querySelector("#product-thead"),
    productTbody: document.querySelector("#product-tbody"),
    pivotColumnList: document.querySelector("#pivot-column-list"),
    productColumnList: document.querySelector("#product-column-list"),
    regionalProductSort: document.querySelector("#regional-product-sort"),
    regionalProductsTbody: document.querySelector("#regional-products-tbody"),
    viewTabs: document.querySelector(".view-tabs")
  });
}

function bindEvents() {
  dom.refreshData?.addEventListener("click", () => refreshRepositoryData({ preserveDates: true, forceRefresh: true }));
  dom.allDates.addEventListener("click", setAllDates);
  dom.previousPeriod.addEventListener("click", setPreviousPeriod);
  dom.dimensionSelect.addEventListener("change", renderAll);
  dom.sortSelect.addEventListener("change", renderAll);
  dom.sortDir.addEventListener("change", renderAll);
  dom.rowLimit.addEventListener("change", renderAll);
  dom.regionalProductSort.addEventListener("change", renderAll);
  dom.exportCsv.addEventListener("click", exportPivotCsv);
  dom.exportProductCsv.addEventListener("click", exportProductCsv);
  dom.clearFilters.addEventListener("click", clearAllFilters);
  dom.trendGrain.addEventListener("change", handleTrendGrainChange);
  dom.trendProductInput.addEventListener("input", handleTrendProductInput);
  dom.clearTrendProduct.addEventListener("click", clearTrendProduct);

  [dom.currentStart, dom.currentEnd, dom.compareStart, dom.compareEnd].forEach((input) => {
    input.addEventListener("change", () => {
      state.dateTouched = true;
      renderAll();
    });
  });

  dom.filters.addEventListener("input", handleFilterInput);
  dom.filters.addEventListener("change", handleFilterChange);
  dom.filters.addEventListener("click", handleFilterClick);
  dom.filters.addEventListener("toggle", handleFilterToggle, true);
  document.addEventListener("click", handleViewTabClick);
  document.addEventListener("click", handleSettingsTabClick);
  document.addEventListener("click", handleTableSortClick);
  document.addEventListener("click", handleColumnOrderClick);

}

function handleViewTabClick(event) {
  const button = event.target.closest("[data-view-tab]");
  if (!button) return;

  const view = button.dataset.viewTab;
  document.querySelectorAll("[data-view-tab]").forEach((tab) => {
    const isActive = tab.dataset.viewTab === view;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const isActive = panel.dataset.viewPanel === view;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

function handleSettingsTabClick(event) {
  const button = event.target.closest("[data-settings-tab]");
  if (!button) return;

  const panelName = button.dataset.settingsTab;
  document.querySelectorAll("[data-settings-tab]").forEach((tab) => {
    const isActive = tab.dataset.settingsTab === panelName;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    const isActive = panel.dataset.settingsPanel === panelName;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

function handleTableSortClick(event) {
  const button = event.target.closest("[data-table-sort]");
  if (!button) return;

  const table = button.dataset.tableSort;
  const key = button.dataset.sortKey;

  if (table === "pivot") {
    if (dom.sortSelect.value === key) {
      dom.sortDir.value = dom.sortDir.value === "desc" ? "asc" : "desc";
    } else {
      dom.sortSelect.value = key;
      dom.sortDir.value = key === "value" || key === "status" ? "asc" : "desc";
    }
    renderAll();
    return;
  }

  if (table === "product") {
    if (state.productSort.key === key) {
      state.productSort.dir = state.productSort.dir === "desc" ? "asc" : "desc";
    } else {
      state.productSort.key = key;
      state.productSort.dir = key === "productTitle" || key === "sku" || key === "status" ? "asc" : "desc";
    }
    renderProductTable(state.productRows);
  }
}

function handleColumnOrderClick(event) {
  const moveButton = event.target.closest("[data-column-move]");
  if (moveButton) {
    moveColumn(moveButton.dataset.columnTable, moveButton.dataset.columnKey, moveButton.dataset.columnMove);
    return;
  }

  const resetButton = event.target.closest("[data-column-reset]");
  if (resetButton) {
    resetColumnOrder(resetButton.dataset.columnReset);
  }
}

function updateSortHeaderStates() {
  document.querySelectorAll("[data-table-sort]").forEach((button) => {
    const table = button.dataset.tableSort;
    const key = button.dataset.sortKey;
    const isActive = table === "pivot"
      ? dom.sortSelect.value === key
      : state.productSort.key === key;
    const direction = table === "pivot" ? dom.sortDir.value : state.productSort.dir;

    button.classList.toggle("active", isActive);
    button.setAttribute("aria-sort", isActive ? (direction === "asc" ? "ascending" : "descending") : "none");
    if (isActive) {
      button.dataset.sortDir = direction;
    } else {
      delete button.dataset.sortDir;
    }
  });
}

function populateDimensionSelect() {
  dom.dimensionSelect.innerHTML = DIMENSIONS
    .map((dimension) => `<option value="${dimension.key}">${escapeHtml(dimension.label)}</option>`)
    .join("");
}

function initializeColumnOrders() {
  state.columnOrders.pivot = loadColumnOrder("pivot");
  state.columnOrders.product = loadColumnOrder("product");
}

function loadColumnOrder(table) {
  const defaults = DEFAULT_COLUMN_ORDERS[table] || [];
  try {
    const stored = JSON.parse(localStorage.getItem(columnOrderStorageKey(table)) || "[]");
    if (Array.isArray(stored)) return normalizeColumnOrder(table, stored);
  } catch (error) {
    console.warn(`Could not load ${table} column order.`, error);
  }
  return normalizeColumnOrder(table, defaults);
}

function saveColumnOrder(table) {
  try {
    localStorage.setItem(columnOrderStorageKey(table), JSON.stringify(state.columnOrders[table] || []));
  } catch (error) {
    console.warn(`Could not save ${table} column order.`, error);
  }
}

function columnOrderStorageKey(table) {
  return `product-dashboard:${table}-columns`;
}

function normalizeColumnOrder(table, order) {
  const defaults = DEFAULT_COLUMN_ORDERS[table] || [];
  const validKeys = new Set(defaults);
  const normalized = order.filter((key, index) => validKeys.has(key) && order.indexOf(key) === index);
  defaults.forEach((key) => {
    if (normalized.includes(key)) return;
    let insertAt = normalized.length;
    for (let index = defaults.indexOf(key) - 1; index >= 0; index -= 1) {
      const previousIndex = normalized.indexOf(defaults[index]);
      if (previousIndex >= 0) {
        insertAt = previousIndex + 1;
        break;
      }
    }
    normalized.splice(insertAt, 0, key);
  });
  return normalized;
}

function getTableColumns(table) {
  const defs = COLUMN_DEFS_BY_TABLE[table] || [];
  const byKey = new Map(defs.map((column) => [column.key, column]));
  const order = normalizeColumnOrder(table, state.columnOrders[table] || []);
  state.columnOrders[table] = order;
  return order.map((key) => byKey.get(key)).filter(Boolean);
}

function moveColumn(table, key, direction) {
  const order = normalizeColumnOrder(table, state.columnOrders[table] || []);
  const index = order.indexOf(key);
  const offset = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;

  order.splice(index, 1);
  order.splice(nextIndex, 0, key);
  state.columnOrders[table] = order;
  saveColumnOrder(table);
  renderColumnSettings();
  renderPivotTable(state.pivotRows);
  renderProductTable(state.productRows);
}

function resetColumnOrder(table) {
  if (!DEFAULT_COLUMN_ORDERS[table]) return;
  state.columnOrders[table] = [...DEFAULT_COLUMN_ORDERS[table]];
  saveColumnOrder(table);
  renderColumnSettings();
  renderPivotTable(state.pivotRows);
  renderProductTable(state.productRows);
}

function renderColumnSettings() {
  renderColumnOrderList("pivot", dom.pivotColumnList);
  renderColumnOrderList("product", dom.productColumnList);
}

function renderColumnOrderList(table, target) {
  if (!target) return;
  const columns = getTableColumns(table);
  target.innerHTML = columns.map((column, index) => `
    <div class="column-order-row">
      <span>${escapeHtml(column.label)}</span>
      <div class="column-order-actions">
        <button class="button compact" type="button" data-column-table="${table}" data-column-key="${column.key}" data-column-move="up" ${index === 0 ? "disabled" : ""}>Up</button>
        <button class="button compact" type="button" data-column-table="${table}" data-column-key="${column.key}" data-column-move="down" ${index === columns.length - 1 ? "disabled" : ""}>Down</button>
      </div>
    </div>
  `).join("");
}

async function refreshRepositoryData({ preserveDates, forceRefresh } = { preserveDates: true, forceRefresh: false }) {
  if (state.loading) return;
  state.loading = true;
  setStatus("Loading repository data...", "busy");

  try {
    await loadRepositoryData({ forceRefresh });
    ensureDateDefaults(!preserveDates || !state.dateTouched);
    renderAll();

    if (!state.files.length) {
      setStatus("Ready. Add CSV files to data/manifest.json to populate the shared dashboard.");
    } else {
      setStatus(`Ready. Loaded ${numberFormat.format(state.records.length)} shared rows from ${numberFormat.format(state.files.length)} repository file${state.files.length === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to load repository data.", "error");
  } finally {
    state.loading = false;
  }
}

async function loadRepositoryData({ forceRefresh = false } = {}) {
  const manifest = await fetchRepositoryManifest();
  const files = normalizeManifestFiles(manifest);
  const records = [];
  const fileMetas = [];
  const cacheKeys = [];

  for (const file of files) {
    const sourceHash = `repo:${file.path}`;
    setStatus(`Checking ${file.name}...`, "busy");
    const signature = await getRepositoryFileSignature(file);
    const cacheKey = signature ? getParsedFileCacheKey(file, signature) : "";
    if (cacheKey) cacheKeys.push(cacheKey);

    let parsed = cacheKey && !forceRefresh ? await readCachedParsedFile(cacheKey) : null;
    if (parsed) {
      setStatus(`Using cached data for ${file.name}...`, "busy");
      await pause();
    } else {
      setStatus(`Loading ${file.name}...`, "busy");
      const response = await fetch(withCacheBust(file.path), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Could not load ${file.path} (${response.status}). Check data/manifest.json and the file path.`);
      }

      const buffer = await response.arrayBuffer();
      parsed = await parseRepositoryFile(buffer, file, response, sourceHash, (message) => setStatus(message, "busy"));
      if (cacheKey) await writeCachedParsedFile(cacheKey, parsed);
    }

    const addedRecords = parsed.records.map(hydrateRecord);
    records.push(...addedRecords);

    fileMetas.push({
      hash: sourceHash,
      name: file.name,
      path: file.path,
      source: "Repository",
      rowsRead: parsed.records.length,
      rowsAdded: addedRecords.length,
      rowsSkipped: 0,
      minDate: parsed.minDate,
      maxDate: parsed.maxDate,
      netSales: sum(addedRecords, "netSales"),
      netUnits: sum(addedRecords, "netUnits")
    });
  }

  state.records = records;
  state.files = fileMetas;
  state.rowKeys = new Set(records.map((record) => record.rowKey));
  pruneParsedFileCache(cacheKeys);
}

async function fetchRepositoryManifest() {
  const response = await fetch(withCacheBust(DATA_MANIFEST_URL), { cache: "no-store" });
  if (response.status === 404) {
    return { files: [] };
  }
  if (!response.ok) {
    throw new Error(`Could not load ${DATA_MANIFEST_URL} (${response.status}).`);
  }
  return response.json();
}

function normalizeManifestFiles(manifest) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  return files
    .map((entry) => {
      if (typeof entry === "string") {
        return { path: entry, name: fileNameFromPath(entry), enabled: true };
      }
      return {
        path: cleanText(entry?.path),
        name: cleanText(entry?.name) || fileNameFromPath(entry?.path),
        version: cleanText(entry?.version || entry?.updated || entry?.hash || entry?.revision),
        enabled: entry?.enabled !== false
      };
    })
    .filter((entry) => entry.enabled && entry.path);
}

function withCacheBust(path) {
  const url = new URL(path, window.location.href);
  url.searchParams.set("v", Date.now().toString());
  return url.toString();
}

function fileNameFromPath(path) {
  const text = cleanText(path);
  return decodeURIComponent(text.split("/").pop() || text || "Data file");
}

async function getRepositoryFileSignature(file) {
  if (file.version) return `manifest-version:${file.version}`;

  try {
    const response = await fetch(withCacheBust(file.path), { method: "HEAD", cache: "no-store" });
    if (!response.ok) return "";

    const etag = response.headers.get("etag") || "";
    const lastModified = response.headers.get("last-modified") || "";
    const contentLength = response.headers.get("content-length") || "";
    const contentType = response.headers.get("content-type") || "";
    return [
      `etag:${etag}`,
      `last-modified:${lastModified}`,
      `content-length:${contentLength}`,
      `content-type:${contentType}`
    ].join("|");
  } catch (error) {
    console.warn(`Could not read cache signature for ${file.path}.`, error);
    return "";
  }
}

function getParsedFileCacheKey(file, signature) {
  return [DATA_CACHE_VERSION, file.path, file.name, signature].join("||");
}

let parsedCacheDbPromise = null;

function getParsedCacheDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (parsedCacheDbPromise) return parsedCacheDbPromise;

  parsedCacheDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DATA_CACHE_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DATA_CACHE_STORE)) {
        db.createObjectStore(DATA_CACHE_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn("Parsed data cache is unavailable.", request.error);
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });

  return parsedCacheDbPromise;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCachedParsedFile(key) {
  try {
    const db = await getParsedCacheDb();
    if (!db) return null;
    const entry = await idbRequest(db.transaction(DATA_CACHE_STORE, "readonly").objectStore(DATA_CACHE_STORE).get(key));
    return entry?.parsed || null;
  } catch (error) {
    console.warn("Could not read parsed data cache.", error);
    return null;
  }
}

async function writeCachedParsedFile(key, parsed) {
  try {
    const db = await getParsedCacheDb();
    if (!db) return;
    const transaction = db.transaction(DATA_CACHE_STORE, "readwrite");
    transaction.objectStore(DATA_CACHE_STORE).put({
      key,
      parsed,
      savedAt: new Date().toISOString()
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("Could not write parsed data cache.", error);
  }
}

async function pruneParsedFileCache(validKeys) {
  try {
    const db = await getParsedCacheDb();
    if (!db) return;
    const valid = new Set(validKeys);
    const transaction = db.transaction(DATA_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(DATA_CACHE_STORE);
    const keys = await idbRequest(store.getAllKeys());
    keys.forEach((key) => {
      if (!valid.has(key)) store.delete(key);
    });
  } catch (error) {
    console.warn("Could not prune parsed data cache.", error);
  }
}

async function parseRepositoryFile(buffer, file, response, sourceHash, onProgress) {
  if (isCsvFile(file, response)) {
    const bytes = new Uint8Array(buffer);
    if (isZipBytes(bytes)) {
      throw new Error(`${file.name} is an Excel workbook, but data/manifest.json points to it as a CSV file. Export the sales sheet as .csv and update the manifest path.`);
    }
    if (isOldExcelBytes(bytes)) {
      throw new Error(`${file.name} is an old binary Excel file. Export the sales sheet as .csv and update data/manifest.json.`);
    }
    return parseSalesCsv(decodeCsvBuffer(buffer), file.name, sourceHash, onProgress);
  }

  validateWorkbookResponse(buffer, file, response);
  return parseSalesWorkbook(buffer, file, sourceHash, onProgress);
}

function isCsvFile(file, response) {
  const path = cleanText(file?.path).split("?")[0].toLowerCase();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const hasWorkbookExtension = /\.(xlsx|xlsm|xls)$/i.test(path);
  return path.endsWith(".csv") || contentType.includes("text/csv") || contentType.includes("application/csv") || (contentType.includes("text/plain") && !hasWorkbookExtension);
}

function decodeCsvBuffer(buffer) {
  return new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
}

async function parseSalesCsv(text, fileName, sourceHash, onProgress) {
  onProgress(`Opening ${fileName}...`);
  validateCsvText(text, fileName);

  onProgress(`Parsing CSV rows in ${fileName}...`);
  const rows = parseCsvRows(text);
  const headerIndex = rows.findIndex((row) => row.some((cell) => cleanText(cell)));
  if (headerIndex < 0) {
    throw new Error(`${fileName} is empty. Export the sales sheet as a CSV file with headers.`);
  }

  const headers = rows[headerIndex].slice();
  headers[0] = toText(headers[0]).replace(/^\uFEFF/, "");
  const fieldIndex = {};
  const records = [];
  let minDate = "";
  let maxDate = "";

  mapHeaders(headers, fieldIndex);
  validateRequiredHeaders(fieldIndex);

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (!cells.some((cell) => cleanText(cell))) continue;

    const record = normalizeRecord(cells, fieldIndex, fileName, sourceHash, index + 1);
    if (record) {
      records.push(record);
      if (!minDate || record.dateKey < minDate) minDate = record.dateKey;
      if (!maxDate || record.dateKey > maxDate) maxDate = record.dateKey;
    }

    if ((index - headerIndex) % 2500 === 0) {
      onProgress(`Parsed ${numberFormat.format(index - headerIndex)} rows from ${fileName}...`);
      await pause();
    }
  }

  if (!records.length) {
    throw new Error(`${fileName} did not contain usable CSV rows.`);
  }

  return { records, minDate, maxDate };
}

function validateCsvText(text, fileName) {
  const preview = text.slice(0, 500).trim();
  const lowerPreview = preview.toLowerCase();

  if (lowerPreview.startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(`${fileName} is a Git LFS pointer, not the actual CSV file. Store the real .csv file in the repo/Pages deployment, or use a raw downloadable file URL in data/manifest.json.`);
  }

  if (lowerPreview.startsWith("<!doctype html") || lowerPreview.startsWith("<html") || lowerPreview.includes("<title>")) {
    throw new Error(`${fileName} loaded as HTML instead of a CSV file. In data/manifest.json, use a Pages-relative file path like "data/file.csv" or a raw download URL, not a GitHub "blob" page URL.`);
  }

  if (/^(404|not found)\b/.test(lowerPreview)) {
    throw new Error(`${fileName} was not found. Check the file path, capitalization, and GitHub Pages deployment.`);
  }
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          value += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char === "\r") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      if (text[index + 1] === "\n") index += 1;
    } else {
      value += char;
    }
  }

  if (value || row.length || text.endsWith(",")) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function validateWorkbookResponse(buffer, file, response) {
  const bytes = new Uint8Array(buffer);
  if (isZipBytes(bytes)) return;

  const preview = new TextDecoder("utf-8").decode(bytes.slice(0, 500)).trim();
  const lowerPreview = preview.toLowerCase();
  const contentType = response.headers.get("content-type") || "unknown content type";
  const firstBytes = Array.from(bytes.slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");

  if (lowerPreview.startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(`${file.name} is a Git LFS pointer, not the actual Excel file. Store the real .xlsx in the repo/Pages deployment, or use a raw downloadable file URL in data/manifest.json.`);
  }

  if (isOldExcelBytes(bytes)) {
    throw new Error(`${file.name} is an old binary .xls workbook or a file saved in the wrong Excel format. Export the sales sheet as .csv and update data/manifest.json if the filename changes.`);
  }

  if (lowerPreview.startsWith("<!doctype html") || lowerPreview.startsWith("<html") || lowerPreview.includes("<title>")) {
    throw new Error(`${file.name} loaded as HTML instead of a data file. In data/manifest.json, use a Pages-relative file path like "data/file.csv" or a raw download URL, not a GitHub "blob" page URL.`);
  }

  if (/^(404|not found)\b/.test(lowerPreview)) {
    throw new Error(`${file.name} was not found at ${file.path}. Check the file path, capitalization, and GitHub Pages deployment.`);
  }

  throw new Error(`${file.name} did not load as a valid data file. Expected a .csv file or ZIP-based .xlsx bytes starting with PK, got ${contentType}; first bytes: ${firstBytes || "empty file"}. Check that the manifest path points to the real file, not a renamed .xls/html file or Git LFS pointer.`);
}

function isZipBytes(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isOldExcelBytes(bytes) {
  return bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
}

async function parseSalesWorkbook(buffer, file, sourceHash, onProgress) {
  const fileName = file.name;
  onProgress(`Opening ${fileName}...`);
  const zip = new ZipArchive(buffer);
  const sharedStrings = await readSharedStrings(zip);
  const sheet = await findSheetPath(zip, workbookSheetCandidates(file));

  onProgress(`Parsing ${sheet.name} sheet in ${fileName}...`);
  const sheetXml = await zip.text(sheet.path);
  const parsed = await parseSalesSheet(sheetXml, sharedStrings, fileName, sourceHash, onProgress);

  if (!parsed.records.length) {
    throw new Error(`${fileName} did not contain usable rows on the ${sheet.name} sheet.`);
  }

  return parsed;
}

function workbookSheetCandidates(file) {
  return uniqueCleanTexts([
    stripExtension(fileNameFromPath(file.path)),
    stripExtension(file.name),
    "Detail"
  ]);
}

function stripExtension(value) {
  return cleanText(value).replace(/\.[^.]+$/, "");
}

function uniqueCleanTexts(values) {
  const seen = new Set();
  return values
    .map(cleanText)
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function readSharedStrings(zip) {
  if (!zip.has("xl/sharedStrings.xml")) return [];
  const xml = await zip.text("xl/sharedStrings.xml");
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) => {
    const textRuns = Array.from(match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g));
    if (!textRuns.length) return "";
    return decodeXml(textRuns.map((textMatch) => textMatch[1]).join(""));
  });
}

async function findSheetPath(zip, sheetNames) {
  const workbook = await zip.text("xl/workbook.xml");
  const sheets = Array.from(workbook.matchAll(/<sheet\b([^>]*)\/?>/g)).map((match) => match[1]);
  const normalizedNames = sheetNames.map((name) => name.toLowerCase());
  const sheet = sheets.find((attributes) => normalizedNames.includes(cleanText(getXmlAttribute(attributes, "name")).toLowerCase()));
  if (!sheet) {
    throw new Error(`Workbook is missing a supported sales sheet. Expected one of: ${sheetNames.join(", ")}.`);
  }

  const sheetName = cleanText(getXmlAttribute(sheet, "name"));
  const relationshipId = getXmlAttribute(sheet, "r:id") || getXmlAttribute(sheet, "id");
  const rels = await zip.text("xl/_rels/workbook.xml.rels");
  const relationships = Array.from(rels.matchAll(/<Relationship\b([^>]*)\/?>/g)).map((match) => match[1]);
  const relationship = relationships.find((attributes) => getXmlAttribute(attributes, "Id") === relationshipId);
  if (!relationship) {
    throw new Error(`Workbook relationship for "${sheetName}" could not be found.`);
  }

  return {
    name: sheetName,
    path: normalizeZipPath("xl/workbook.xml", getXmlAttribute(relationship, "Target"))
  };
}

async function parseSalesSheet(sheetXml, sharedStrings, fileName, sourceHash, onProgress) {
  const sheetDataMatch = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) {
    throw new Error("Sales sheet has no sheetData section.");
  }

  const fieldIndex = {};
  const records = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let headerReady = false;
  let rowMatch;
  let parsedRows = 0;
  let minDate = "";
  let maxDate = "";

  while ((rowMatch = rowRegex.exec(sheetDataMatch[1])) !== null) {
    parsedRows += 1;
    const cells = parseCells(rowMatch[1], sharedStrings);

    if (!headerReady) {
      mapHeaders(cells, fieldIndex);
      validateRequiredHeaders(fieldIndex);
      headerReady = true;
      continue;
    }

    const record = normalizeRecord(cells, fieldIndex, fileName, sourceHash, parsedRows);
    if (record) {
      records.push(record);
      if (!minDate || record.dateKey < minDate) minDate = record.dateKey;
      if (!maxDate || record.dateKey > maxDate) maxDate = record.dateKey;
    }

    if (parsedRows % 2500 === 0) {
      onProgress(`Parsed ${numberFormat.format(parsedRows - 1)} rows from ${fileName}...`);
      await pause();
    }
  }

  return { records, minDate, maxDate };
}

function parseCells(rowXml, sharedStrings) {
  const cells = [];
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  let match;

  while ((match = cellRegex.exec(rowXml)) !== null) {
    const attributes = match[1] || match[3] || "";
    const body = match[2] || "";
    const reference = getXmlAttribute(attributes, "r");
    const index = reference ? columnIndex(reference) : cells.length;
    const type = getXmlAttribute(attributes, "t");
    const valueMatch = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
    let value = "";

    if (type === "inlineStr") {
      value = decodeXml(Array.from(body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((item) => item[1]).join(""));
    } else if (valueMatch) {
      const raw = decodeXml(valueMatch[1]);
      if (type === "s") {
        value = sharedStrings[Number(raw)] ?? "";
      } else if (type === "b") {
        value = raw === "1";
      } else if (type === "str") {
        value = raw;
      } else {
        const numeric = Number(raw);
        value = Number.isFinite(numeric) ? numeric : raw;
      }
    }

    cells[index] = value;
  }

  return cells;
}

function mapHeaders(cells, fieldIndex) {
  const normalizedHeaders = cells.map((cell) => normalizeHeader(toText(cell)));
  FIELD_DEFS.forEach((field) => {
    const aliases = field.headers.map(normalizeHeader);
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index >= 0) fieldIndex[field.key] = index;
  });
}

function validateRequiredHeaders(fieldIndex) {
  const required = ["date", "netSales", "netUnits"];
  const missing = required
    .filter((key) => fieldIndex[key] === undefined)
    .map((key) => FIELD_DEFS.find((field) => field.key === key)?.label || key);

  if (missing.length) {
    throw new Error(`Data file is missing required columns: ${missing.join(", ")}.`);
  }
}

function normalizeRecord(cells, fieldIndex, fileName, sourceHash, rowNumber) {
  const dateInfo = parseDateValue(cells[fieldIndex.date]);
  if (!dateInfo) return null;

  const record = {
    sku: cleanText(cells[fieldIndex.sku]),
    productTitle: cleanText(cells[fieldIndex.productTitle]),
    orderId: cleanText(cells[fieldIndex.orderId]),
    dateTime: dateInfo.dateTime,
    dateKey: dateInfo.dateKey,
    netSales: toNumber(cells[fieldIndex.netSales]),
    netUnits: toNumber(cells[fieldIndex.netUnits]),
    sourceFile: fileName,
    sourceHash,
    sourceRow: rowNumber,
    rowKey: `${sourceHash}|row:${rowNumber}`
  };

  for (const dimension of DIMENSIONS) {
    record[dimension.key] = cleanDimension(cells[fieldIndex[dimension.key]]);
  }
  record.status = normalizeStatus(record.status);
  record.region = getRegion(record.shippingProvince);

  record.orderKey = getOrderKey(record);

  return record;
}

function renderAll() {
  const dateSummary = getDatasetDateSummary();
  dom.dataRange.textContent = dateSummary ? `${dateSummary.min} to ${dateSummary.max}` : "No data loaded";
  dom.recordCount.textContent = `${numberFormat.format(state.records.length)} rows`;

  renderFilters();
  const filtered = applyDimensionFilters(state.records);
  const current = filtered.filter((record) => inDateRange(record, dom.currentStart.value, dom.currentEnd.value));
  const hasComparison = hasComparisonPeriod();
  const comparison = hasComparison ? filtered.filter((record) => inDateRange(record, dom.compareStart.value, dom.compareEnd.value)) : [];
  const currentSummary = summarize(current);
  const compareSummary = summarize(comparison);

  renderKpis(currentSummary, compareSummary, hasComparison);
  renderTrendTable(current);
  state.pivotRows = buildPivot(current, comparison, hasComparison);
  state.productRows = buildProductResults(current, comparison, hasComparison);
  state.regionalProductRows = buildRegionalTopProducts(current, comparison, hasComparison);
  renderChart(state.pivotRows);
  renderFiles();
  renderPivotTable(state.pivotRows);
  renderProductTable(state.productRows);
  renderRegionalTopProducts(state.regionalProductRows);
}

function renderKpis(current, comparison, hasComparison) {
  setKpi(dom.kpiSales, dom.kpiSalesDelta, formatCurrency(current.netSales), hasComparison ? percentChange(current.netSales, comparison.netSales) : null, hasComparison);
  setKpi(dom.kpiUnits, dom.kpiUnitsDelta, formatNumber(current.netUnits), hasComparison ? percentChange(current.netUnits, comparison.netUnits) : null, hasComparison);
  setKpi(dom.kpiOrders, dom.kpiOrdersDelta, formatNumber(current.orders), hasComparison ? percentChange(current.orders, comparison.orders) : null, hasComparison);
}

function setKpi(valueElement, deltaElement, value, delta, hasComparison = true) {
  valueElement.textContent = value;
  deltaElement.classList.remove("positive", "negative", "no-compare");

  if (!hasComparison) {
    deltaElement.textContent = "";
    deltaElement.classList.add("no-compare");
    return;
  }

  if (delta === null) {
    deltaElement.textContent = "n/a";
    return;
  }

  deltaElement.textContent = `${delta >= 0 ? "+" : ""}${formatPercent(delta)}`;
  if (delta > 0) deltaElement.classList.add("positive");
  if (delta < 0) deltaElement.classList.add("negative");
}

function renderFilters() {
  if (!state.records.length) {
    dom.filters.innerHTML = `<div class="empty-state">No filters</div>`;
    return;
  }

  dom.filters.innerHTML = DIMENSIONS.map((dimension, index) => {
    const selected = state.filters[dimension.key];
    removeHiddenFilterSelections(selected);
    const search = state.filterSearch[dimension.key] || "";
    const selectedLabel = selected.size ? numberFormat.format(selected.size) : "All";
    const isOpen = state.filterOpen[dimension.key] ?? (index < 5 || selected.size > 0);

    return `
      <details class="filter-group" data-filter-group="${dimension.key}" ${isOpen ? "open" : ""}>
        <summary>
          <span>${escapeHtml(dimension.label)}</span>
          <span class="filter-count">${selectedLabel}</span>
        </summary>
        <div class="filter-body">
          <input type="search" data-filter-search="${dimension.key}" value="${escapeHtml(search)}" placeholder="Search">
          <button class="text-button" data-filter-clear="${dimension.key}" type="button">All</button>
          <div class="filter-options" data-filter-options="${dimension.key}">${renderFilterOptionMarkup(dimension)}</div>
        </div>
      </details>
    `;
  }).join("");
}

function renderFilterOptionMarkup(dimension) {
  const selected = state.filters[dimension.key];
  const search = state.filterSearch[dimension.key] || "";
  const counts = getFilterCounts(dimension.key);
  const options = Array.from(counts.keys())
    .filter((value) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort(collator.compare)
    .slice(0, MAX_FILTER_OPTIONS);

  const optionMarkup = options.map((value) => {
    const id = `${dimension.key}-${hashString(value)}`;
    return `
      <label class="filter-option" for="${id}" title="${escapeHtml(value)}">
        <input id="${id}" type="checkbox" data-filter-option="${dimension.key}" value="${escapeHtml(value)}" ${selected.has(value) ? "checked" : ""}>
        <span>${escapeHtml(value)}</span>
        <em>${numberFormat.format(counts.get(value) || 0)}</em>
      </label>
    `;
  }).join("");

  return optionMarkup || `<div class="empty-state">No matches</div>`;
}

function getFilterCounts(key) {
  const counts = new Map();
  for (const record of state.records) {
    const value = record[key] || BLANK;
    if (isHiddenFilterValue(value)) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function renderFilterOptions(key) {
  const dimension = DIMENSIONS.find((item) => item.key === key);
  const container = dom.filters.querySelector(`[data-filter-options="${key}"]`);
  if (!dimension || !container) return;
  container.innerHTML = renderFilterOptionMarkup(dimension);
}

function handleFilterInput(event) {
  const input = event.target.closest("[data-filter-search]");
  if (!input) return;
  const key = input.dataset.filterSearch;
  state.filterSearch[key] = input.value;
  state.filterOpen[key] = true;
  window.clearTimeout(filterSearchTimer);
  filterSearchTimer = window.setTimeout(() => renderFilterOptions(key), 120);
}

function handleFilterChange(event) {
  const checkbox = event.target.closest("[data-filter-option]");
  if (!checkbox) return;
  const key = checkbox.dataset.filterOption;
  if (!state.filters[key]) state.filters[key] = new Set();
  state.filterOpen[key] = true;
  if (checkbox.checked) {
    state.filters[key].add(checkbox.value);
  } else {
    state.filters[key].delete(checkbox.value);
  }
  updateFilterCountLabel(key);
  renderAll();
}

function handleFilterClick(event) {
  const button = event.target.closest("[data-filter-clear]");
  if (!button) return;
  const key = button.dataset.filterClear;
  state.filters[key].clear();
  state.filterOpen[key] = true;
  updateFilterCountLabel(key);
  renderAll();
}

function clearAllFilters() {
  for (const dimension of DIMENSIONS) {
    state.filters[dimension.key].clear();
  }
  renderAll();
}

function handleFilterToggle(event) {
  const group = event.target.closest("[data-filter-group]");
  if (!group) return;
  state.filterOpen[group.dataset.filterGroup] = group.open;
}

function updateFilterCountLabel(key) {
  const group = dom.filters.querySelector(`[data-filter-group="${key}"]`);
  const label = group?.querySelector(".filter-count");
  if (!label) return;
  const selected = state.filters[key];
  label.textContent = selected?.size ? numberFormat.format(selected.size) : "All";
}

function handleTrendProductInput() {
  state.trendProductQuery = dom.trendProductInput.value;
  renderTrendTable(getCurrentTrendRecords());
}

function handleTrendGrainChange() {
  state.trendGrain = dom.trendGrain.value || "week";
  renderTrendTable(getCurrentTrendRecords());
}

function clearTrendProduct() {
  state.trendProductQuery = "";
  dom.trendProductInput.value = "";
  renderTrendTable(getCurrentTrendRecords());
}

function getCurrentTrendRecords() {
  return applyDimensionFilters(state.records)
    .filter((record) => inDateRange(record, dom.currentStart.value, dom.currentEnd.value));
}

function renderTrendTable(filteredRecords) {
  if (!dom.trendChart) return;

  state.trendGrain = dom.trendGrain.value || state.trendGrain || "week";
  renderTrendProductOptions(filteredRecords);
  const trendRecords = filterTrendProductRecords(filteredRecords);
  const rows = buildTrendRows(trendRecords, state.trendGrain, dom.currentStart.value, dom.currentEnd.value);
  const grainLabel = getTrendGrainLabel(state.trendGrain);
  dom.trendHeading.textContent = state.trendProductQuery ? `${grainLabel} Trend by Product` : `${grainLabel} Trend`;

  if (!rows.length) {
    dom.trendChart.innerHTML = `<div class="empty-state">No trend results</div>`;
    return;
  }

  dom.trendChart.innerHTML = renderTrendLineChart(rows);
}

function renderTrendLineChart(rows) {
  const width = 760;
  const height = 310;
  const pad = { top: 24, right: 28, bottom: 58, left: 82 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = rows.map((row) => row.netSales);
  let minValue = Math.min(0, ...values);
  let maxValue = Math.max(0, ...values);
  if (minValue === maxValue) {
    minValue -= 1;
    maxValue += 1;
  }

  const xForIndex = (index) => {
    if (rows.length === 1) return pad.left + plotWidth / 2;
    return pad.left + (index / (rows.length - 1)) * plotWidth;
  };
  const yForValue = (value) => pad.top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight;
  const points = rows.map((row, index) => ({
    ...row,
    x: xForIndex(index),
    y: yForValue(row.netSales)
  }));
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const baselineY = yForValue(0);
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
  const ticks = buildTrendYAxisTicks(minValue, maxValue, 4);
  const xLabelIndexes = getTrendXLabelIndexes(rows.length);
  const latest = rows[rows.length - 1];
  const latestChange = latest.salesChange === null ? "" : `${latest.salesChange >= 0 ? "+" : ""}${formatCurrency(latest.salesChange)}`;

  return `
    <div class="trend-summary">
      <div>
        <span>Latest Period</span>
        <strong>${escapeHtml(latest.periodLabel)}</strong>
      </div>
      <div>
        <span>Net Sales</span>
        <strong>${formatCurrency(latest.netSales)}</strong>
      </div>
      <div>
        <span>Net Units</span>
        <strong>${formatNumber(latest.netUnits)}</strong>
      </div>
      <div>
        <span>Sales Change</span>
        <strong class="${latest.salesChange > 0 ? "delta-positive" : latest.salesChange < 0 ? "delta-negative" : ""}">${latestChange}</strong>
      </div>
    </div>
    <svg class="trend-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Net sales trend">
      <rect x="0" y="0" width="${width}" height="${height}" class="trend-svg-bg"></rect>
      ${ticks.map((tick) => {
        const y = yForValue(tick);
        return `
          <line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${width - pad.right}" y2="${y.toFixed(2)}" class="trend-grid-line"></line>
          <text x="${pad.left - 12}" y="${(y + 4).toFixed(2)}" class="trend-axis-label" text-anchor="end">${escapeHtml(formatCompactCurrency(tick))}</text>
        `;
      }).join("")}
      <line x1="${pad.left}" y1="${baselineY.toFixed(2)}" x2="${width - pad.right}" y2="${baselineY.toFixed(2)}" class="trend-zero-line"></line>
      <path d="${areaPath}" class="trend-area"></path>
      <path d="${linePath}" class="trend-line"></path>
      ${points.map((point) => `
        <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4.5" class="trend-point">
          <title>${escapeHtml(`${point.periodLabel}: ${formatCurrency(point.netSales)} | ${formatNumber(point.netUnits)} units`)}</title>
        </circle>
      `).join("")}
      ${xLabelIndexes.map((index) => {
        const point = points[index];
        return `<text x="${point.x.toFixed(2)}" y="${height - 22}" class="trend-axis-label trend-x-label" text-anchor="middle">${escapeHtml(shortTrendLabel(point.periodLabel, state.trendGrain))}</text>`;
      }).join("")}
    </svg>
  `;
}

function buildTrendYAxisTicks(minValue, maxValue, count) {
  const ticks = [];
  for (let index = 0; index <= count; index += 1) {
    ticks.push(minValue + ((maxValue - minValue) * index / count));
  }
  return ticks;
}

function getTrendXLabelIndexes(length) {
  if (length <= 1) return [0];
  if (length <= 6) return Array.from({ length }, (_, index) => index);
  const indexes = new Set();
  const maxLabels = 6;
  for (let index = 0; index < maxLabels; index += 1) {
    indexes.add(Math.round(index * (length - 1) / (maxLabels - 1)));
  }
  return Array.from(indexes).sort((a, b) => a - b);
}

function shortTrendLabel(label, grain) {
  if (grain === "week") return label.slice(0, 10);
  return label;
}

function renderTrendProductOptions(records) {
  if (!dom.trendProductOptions) return;
  const query = cleanText(dom.trendProductInput.value);
  if (!shouldShowTrendSuggestions(query)) {
    dom.trendProductOptions.innerHTML = "";
    return;
  }

  const products = aggregateTrendProducts(records)
    .filter((product) => productMatchesTrendQuery(product, query))
    .sort((a, b) => b.netSales - a.netSales || collator.compare(a.optionLabel, b.optionLabel))
    .slice(0, TREND_SUGGESTION_LIMIT);

  dom.trendProductOptions.innerHTML = products.map((product) => `
    <option value="${escapeHtml(product.optionLabel)}"></option>
  `).join("");
}

function filterTrendProductRecords(records) {
  const query = cleanText(state.trendProductQuery);
  if (!query) return records;
  if (!shouldShowTrendSuggestions(query)) return records;

  const products = aggregateTrendProducts(records);
  const exact = resolveTrendProduct(query, products);
  if (exact) return records.filter((record) => getProductKey(record) === exact.productKey);

  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedSkuQuery = normalizeSkuKey(query);
  return records.filter((record) => {
    const displaySku = formatDisplaySku(record.sku).toLocaleLowerCase();
    const rawSku = cleanText(record.sku).toLocaleLowerCase();
    const skuKey = normalizeSkuKey(record.sku);
    const title = cleanText(record.productTitle).toLocaleLowerCase();
    return title.includes(normalizedQuery)
      || displaySku.includes(normalizedQuery)
      || rawSku.includes(normalizedQuery)
      || (normalizedSkuQuery && skuKey.includes(normalizedSkuQuery));
  });
}

function shouldShowTrendSuggestions(query) {
  const text = cleanText(query);
  if (!text) return false;
  const digits = text.replace(/\D/g, "");
  const isSkuLike = digits && text.replace(/[0-9\s-]/g, "") === "";
  return isSkuLike ? digits.length >= TREND_SKU_SUGGESTION_MIN : text.length >= TREND_TEXT_SUGGESTION_MIN;
}

function productMatchesTrendQuery(product, query) {
  const text = cleanText(query).toLocaleLowerCase();
  const skuQuery = normalizeSkuKey(query);
  const displaySku = product.sku.toLocaleLowerCase();
  const rawProductTitle = product.productTitle.toLocaleLowerCase();
  const optionLabel = product.optionLabel.toLocaleLowerCase();
  return optionLabel.includes(text)
    || rawProductTitle.includes(text)
    || displaySku.includes(text)
    || (skuQuery && normalizeSkuKey(product.sku).includes(skuQuery));
}

function resolveTrendProduct(query, products) {
  const normalizedQuery = cleanText(query).toLocaleLowerCase();
  const skuQuery = normalizeSkuKey(query);
  return products.find((product) => {
    return product.optionLabel.toLocaleLowerCase() === normalizedQuery
      || product.productTitle.toLocaleLowerCase() === normalizedQuery
      || product.sku.toLocaleLowerCase() === normalizedQuery
      || normalizeSkuKey(product.sku) === skuQuery;
  }) || null;
}

function aggregateTrendProducts(records) {
  const products = Array.from(aggregateProducts(records).values());
  return products.map((product) => ({
    ...product,
    optionLabel: `${product.sku} | ${product.productTitle}`
  }));
}

function buildTrendRows(records, grain = "week", rangeStart = "", rangeEnd = "") {
  const map = new Map();
  for (const record of records) {
    const bucket = getTrendBucketForDateKey(record.dateKey, grain, rangeStart, rangeEnd);
    if (!bucket) continue;
    if (!map.has(bucket.start)) {
      map.set(bucket.start, {
        periodStart: bucket.start,
        periodEnd: bucket.end,
        periodLabel: bucket.label,
        netSales: 0,
        netUnits: 0,
        orders: new Set(),
        salesChange: null,
        unitsChange: null
      });
    }

    const row = map.get(bucket.start);
    row.netSales += record.netSales;
    row.netUnits += record.netUnits;
    if (record.orderKey) row.orders.add(record.orderKey);
  }

  const chronological = Array.from(map.values()).sort((a, b) => collator.compare(a.periodStart, b.periodStart));
  chronological.forEach((row, index) => {
    const previous = chronological[index - 1];
    row.orders = row.orders.size;
    if (previous) {
      row.salesChange = row.netSales - previous.netSales;
      row.unitsChange = row.netUnits - previous.netUnits;
    }
  });

  return chronological;
}

function buildWeeklyTrendRows(records) {
  return buildTrendRows(records, "week");
}

function getTrendBucketForDateKey(key, grain, rangeStart = "", rangeEnd = "") {
  if (!key) return null;
  if (grain === "day") {
    return {
      start: key,
      end: key,
      label: key
    };
  }

  if (grain === "month") {
    const [year, month] = key.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = dateKey(new Date(Date.UTC(year, month, 0)));
    const display = clampTrendBucketRange(start, end, rangeStart, rangeEnd);
    return {
      start,
      end,
      label: display.start === start && display.end === end
        ? `${year}-${String(month).padStart(2, "0")}`
        : `${display.start} to ${display.end}`
    };
  }

  const date = dateFromKey(key);
  const start = addDays(date, -date.getUTCDay());
  const end = addDays(start, 6);
  const bucketStart = dateKey(start);
  const bucketEnd = dateKey(end);
  const display = clampTrendBucketRange(bucketStart, bucketEnd, rangeStart, rangeEnd);
  return {
    start: bucketStart,
    end: bucketEnd,
    label: `${display.start} to ${display.end}`
  };
}

function clampTrendBucketRange(start, end, rangeStart, rangeEnd) {
  const displayStart = rangeStart && rangeStart > start ? rangeStart : start;
  const displayEnd = rangeEnd && rangeEnd < end ? rangeEnd : end;
  return {
    start: displayStart,
    end: displayEnd
  };
}

function getTrendGrainLabel(grain) {
  if (grain === "day") return "Daily";
  if (grain === "month") return "Monthly";
  return "Weekly";
}

function buildPivot(currentRecords, comparisonRecords, hasComparison) {
  const dimension = getActiveDimension();
  const currentPivotRecords = currentRecords.filter((record) => !isHiddenResultValue(record[dimension.key]));
  const comparisonPivotRecords = comparisonRecords.filter((record) => !isHiddenResultValue(record[dimension.key]));
  const currentMap = aggregateByDimension(currentPivotRecords, dimension.key);
  const compareMap = aggregateByDimension(comparisonPivotRecords, dimension.key);
  const totalSales = sum(currentPivotRecords, "netSales");
  const totalUnits = sum(currentPivotRecords, "netUnits");
  const values = hasComparison ? new Set([...currentMap.keys(), ...compareMap.keys()]) : new Set(currentMap.keys());

  const rows = Array.from(values).map((value) => {
    const current = currentMap.get(value) || emptyAggregate();
    const comparison = compareMap.get(value) || emptyAggregate();
    const change = hasComparison ? current.netSales - comparison.netSales : null;

    return {
      value,
      status: current.status || comparison.status || "",
      netSales: current.netSales,
      netUnits: current.netUnits,
      orders: current.orders.size,
      salesShare: totalSales ? current.netSales / totalSales : 0,
      unitsShare: totalUnits ? current.netUnits / totalUnits : 0,
      hasComparison,
      compareSales: hasComparison ? comparison.netSales : null,
      compareUnits: hasComparison ? comparison.netUnits : null,
      change,
      changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null
    };
  });

  return sortRows(rows);
}

function aggregateByDimension(records, key) {
  const map = new Map();
  for (const record of records) {
    const value = record[key] || BLANK;
    if (isHiddenResultValue(value)) continue;
    if (!map.has(value)) map.set(value, emptyAggregate());
    const aggregate = map.get(value);
    aggregate.netSales += record.netSales;
    aggregate.netUnits += record.netUnits;
    if (record.orderKey) aggregate.orders.add(record.orderKey);
    addStatusBreakdown(aggregate.statusBreakdown, record);
  }
  map.forEach((aggregate) => {
    aggregate.status = getStatusLabel(aggregate.statusBreakdown);
  });
  return map;
}

function emptyAggregate() {
  return {
    status: "",
    netSales: 0,
    netUnits: 0,
    orders: new Set(),
    statusBreakdown: new Map()
  };
}

function sortRows(rows) {
  const sortKey = dom.sortSelect.value;
  const direction = dom.sortDir.value === "asc" ? 1 : -1;
  const getter = SORTERS[sortKey] || SORTERS.netSales;

  return rows.sort((a, b) => {
    const aValue = getter(a);
    const bValue = getter(b);
    if (typeof aValue === "string" || typeof bValue === "string") {
      return collator.compare(String(aValue), String(bValue)) * direction;
    }
    return ((aValue || 0) - (bValue || 0)) * direction;
  });
}

function renderChart(rows) {
  const dimension = getActiveDimension();
  dom.chartHeading.textContent = `Net Sales by ${dimension.label}`;
  dom.activeDimension.textContent = dimension.label;

  const limit = getRowLimit();
  const chartRows = rows
    .slice(0, Number.isFinite(limit) ? limit : 25)
    .filter((row) => row.netSales !== 0)
    .slice(0, 18);

  if (!chartRows.length) {
    dom.barChart.innerHTML = `<div class="empty-state">No current-period results</div>`;
    return;
  }

  const max = Math.max(...chartRows.map((row) => Math.abs(row.netSales)), 1);
  dom.barChart.innerHTML = chartRows.map((row) => {
    const width = Math.max(2, Math.abs(row.netSales) / max * 100);
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</div>
        <div class="bar-track">
          <div class="bar-fill ${row.netSales < 0 ? "negative" : ""}" style="--bar-width:${width.toFixed(2)}%"></div>
        </div>
        <div class="bar-value">${formatCurrency(row.netSales)}</div>
      </div>
    `;
  }).join("");
}

function renderFiles() {
  if (!state.files.length) {
    dom.fileTbody.innerHTML = `<tr><td colspan="4">No repository files listed</td></tr>`;
    return;
  }

  dom.fileTbody.innerHTML = state.files
    .slice()
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((file) => `
      <tr>
        <td><div class="clip" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div></td>
        <td class="numeric">${numberFormat.format(file.rowsAdded || 0)}</td>
        <td>${escapeHtml(compactDateRange(file.minDate, file.maxDate))}</td>
        <td><div class="clip" title="${escapeHtml(file.path || file.source || "")}">${escapeHtml(file.source || "Repository")}</div></td>
      </tr>
    `).join("");
}

function renderPivotTable(rows) {
  const dimension = getActiveDimension();
  const limit = getRowLimit();
  const visibleRows = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
  const columns = getTableColumns("pivot");

  dom.pivotHeading.textContent = `Performance by ${dimension.label}`;
  dom.pivotThead.innerHTML = `<tr>${columns.map((column) => renderTableHeader("pivot", column)).join("")}</tr>`;
  updateSortHeaderStates();

  if (!visibleRows.length) {
    dom.pivotTbody.innerHTML = `<tr><td colspan="${columns.length}">No rows for the selected period and filters</td></tr>`;
    return;
  }

  dom.pivotTbody.innerHTML = visibleRows.map((row) => `
    <tr>
      ${columns.map((column) => renderPivotCell(row, column)).join("")}
    </tr>
  `).join("");
}

function renderTableHeader(table, column) {
  return `
    <th class="${column.numeric ? "numeric" : ""}">
      <button data-table-sort="${table}" data-sort-key="${column.key}" type="button">
        <span>${escapeHtml(column.label)}</span>
        <span class="sort-icon" aria-hidden="true"></span>
      </button>
    </th>
  `;
}

function renderPivotCell(row, column) {
  if (column.key === "value" || column.key === "status") {
    const value = row[column.key] || "";
    return renderTextCell(value);
  }

  const value = formatPivotCellValue(row, column.key);
  return `<td class="numeric ${getDeltaClass(row, column.key)}">${value}</td>`;
}

function renderTextCell(value) {
  return `<td><div class="clip" title="${escapeHtml(value)}">${escapeHtml(value)}</div></td>`;
}

function formatPivotCellValue(row, key) {
  if (key === "netSales") return formatCurrency(row.netSales);
  if (key === "salesShare") return formatPercent(row.salesShare);
  if (key === "netUnits") return formatNumber(row.netUnits);
  if (key === "unitsShare") return formatPercent(row.unitsShare);
  if (key === "compareSales") return row.hasComparison ? formatCurrency(row.compareSales) : "";
  if (key === "change") return row.hasComparison ? formatCurrency(row.change) : "";
  if (key === "changePct") return row.hasComparison ? (row.changePct === null ? "n/a" : formatPercent(row.changePct)) : "";
  return "";
}

function getDeltaClass(row, key) {
  if (!row.hasComparison) return "";
  const value = key === "unitChange" ? row.unitChange : row.change;
  if (key !== "change" && key !== "changePct" && key !== "unitChange") return "";
  if (value > 0) return "delta-positive";
  if (value < 0) return "delta-negative";
  return "";
}

function buildProductResults(records, comparisonRecords = [], hasComparison = false) {
  const totalSales = sum(records, "netSales");
  const currentMap = aggregateProducts(records);
  const compareMap = hasComparison ? aggregateProducts(comparisonRecords) : new Map();
  const productKeys = hasComparison ? new Set([...currentMap.keys(), ...compareMap.keys()]) : new Set(currentMap.keys());

  return Array.from(productKeys)
    .map((key) => {
      const current = currentMap.get(key) || emptyProduct();
      const comparison = compareMap.get(key) || emptyProduct();
      const displayProduct = currentMap.get(key) || compareMap.get(key) || emptyProduct();
      const change = hasComparison ? current.netSales - comparison.netSales : null;
      const unitChange = hasComparison ? current.netUnits - comparison.netUnits : null;

      return {
        ...displayProduct,
        netSales: current.netSales,
        netUnits: current.netUnits,
        salesShare: totalSales ? current.netSales / totalSales : 0,
        hasComparison,
        compareSales: hasComparison ? comparison.netSales : null,
        compareUnits: hasComparison ? comparison.netUnits : null,
        change,
        unitChange,
        changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null
      };
    })
    .sort((a, b) => b.netSales - a.netSales || collator.compare(a.productTitle, b.productTitle));
}

function aggregateProducts(records) {
  const map = new Map();
  for (const record of records) {
    const title = record.productTitle || BLANK;
    const sku = formatDisplaySku(record.sku) || BLANK;
    const key = getProductKey(record);
    if (!map.has(key)) {
      map.set(key, {
        productKey: key,
        sku,
        productTitle: title,
        status: BLANK,
        statusBreakdown: new Map(),
        netSales: 0,
        netUnits: 0,
        salesShare: 0
      });
    }

    const product = map.get(key);
    product.netSales += record.netSales;
    product.netUnits += record.netUnits;
    addStatusBreakdown(product.statusBreakdown, record);
  }

  map.forEach((product) => {
    product.status = getStatusLabel(product.statusBreakdown);
  });

  return map;
}

function addStatusBreakdown(statusBreakdown, record) {
  const status = normalizeStatus(record.status);
  if (isBlankValue(status) || isReferenceErrorValue(status)) return;
  const metrics = statusBreakdown.get(status) || { netSales: 0, netUnits: 0 };
  metrics.netSales += record.netSales;
  metrics.netUnits += record.netUnits;
  statusBreakdown.set(status, metrics);
}

function getStatusLabel(statusBreakdown) {
  if (!statusBreakdown || !statusBreakdown.size) return "";
  const statuses = Array.from(statusBreakdown.entries())
    .filter(([, metrics]) => (Number(metrics.netSales) || 0) !== 0 || (Number(metrics.netUnits) || 0) !== 0)
    .map(([status]) => status)
    .sort(compareStatusLabels);
  const priceStatuses = statuses.filter((status) => PRICE_STATUS_LABELS.includes(status));
  const displayStatuses = priceStatuses.length ? priceStatuses : statuses;

  return displayStatuses.length ? displayStatuses.join(" + ") : "";
}

function compareStatusLabels(a, b) {
  const aIndex = STATUS_DISPLAY_ORDER.indexOf(a);
  const bIndex = STATUS_DISPLAY_ORDER.indexOf(b);
  const aRank = aIndex >= 0 ? aIndex : STATUS_DISPLAY_ORDER.length;
  const bRank = bIndex >= 0 ? bIndex : STATUS_DISPLAY_ORDER.length;
  if (aRank !== bRank) return aRank - bRank;
  return collator.compare(a, b);
}

function getProductKey(record) {
  const skuKey = normalizeSkuKey(record.sku);
  const titleKey = cleanText(record.productTitle).toLocaleLowerCase();
  return `${skuKey}|${titleKey}`;
}

function normalizeSkuKey(value) {
  const text = cleanText(value);
  if (!text || text === BLANK) return "";
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, "");
  return text.toLocaleLowerCase();
}

function formatDisplaySku(value) {
  const text = cleanText(value);
  if (!text || text === BLANK) return "";
  if (/^\d+$/.test(text)) return text.padStart(SKU_DISPLAY_WIDTH, "0");
  return text;
}

function emptyProduct() {
  return {
    productKey: "",
    sku: BLANK,
    productTitle: BLANK,
    status: "",
    statusBreakdown: new Map(),
    netSales: 0,
    netUnits: 0,
    salesShare: 0
  };
}

function getTableRawValue(row, key) {
  if (key === "value") return row.value;
  if (key === "productTitle") return row.productTitle;
  if (key === "sku") return row.sku;
  if (key === "status") return row.status;
  return row[key];
}

function sortProductRows(rows) {
  const { key, dir } = state.productSort;
  const direction = dir === "asc" ? 1 : -1;

  return rows.slice().sort((a, b) => {
    const aValue = getTableRawValue(a, key);
    const bValue = getTableRawValue(b, key);
    const aMissing = aValue === null || aValue === undefined || aValue === "";
    const bMissing = bValue === null || bValue === undefined || bValue === "";

    if (aMissing && bMissing) return collator.compare(a.productTitle, b.productTitle);
    if (aMissing) return 1;
    if (bMissing) return -1;

    if (typeof aValue === "string" || typeof bValue === "string") {
      return collator.compare(String(aValue), String(bValue)) * direction;
    }

    const primary = ((Number(aValue) || 0) - (Number(bValue) || 0)) * direction;
    if (primary) return primary;
    return collator.compare(a.productTitle, b.productTitle);
  });
}

function renderProductTable(rows) {
  if (!dom.productTbody) return;

  const sortedRows = sortProductRows(rows);
  const columns = getTableColumns("product");
  const totalSales = sum(sortedRows, "netSales");
  const totalUnits = sum(sortedRows, "netUnits");
  const hasComparison = sortedRows.some((row) => row.hasComparison);
  const totalCompareSales = hasComparison ? sum(sortedRows, "compareSales") : 0;
  const totalCompareUnits = hasComparison ? sum(sortedRows, "compareUnits") : 0;
  const totalChange = hasComparison ? totalSales - totalCompareSales : null;
  const totalUnitChange = hasComparison ? totalUnits - totalCompareUnits : null;
  const totalChangePct = hasComparison ? percentChange(totalSales, totalCompareSales) : null;
  const suffix = sortedRows.length === 1 ? "product" : "products";
  dom.productHeading.textContent = `Product Results (${numberFormat.format(rows.length)} ${suffix})`;
  dom.productThead.innerHTML = `<tr>${columns.map((column) => renderTableHeader("product", column)).join("")}</tr>`;
  updateSortHeaderStates();

  if (!sortedRows.length) {
    dom.productTbody.innerHTML = `<tr><td colspan="${columns.length}">No products for the selected period and filters</td></tr>`;
    return;
  }

  const bodyRows = sortedRows.map((row) => `
    <tr>
      ${columns.map((column) => renderProductCell(row, column)).join("")}
    </tr>
  `);

  bodyRows.push(`
    <tr class="total-row">
      ${columns.map((column) => renderProductTotalCell(column, { totalSales, totalUnits, hasComparison, totalChange, totalUnitChange, totalChangePct })).join("")}
    </tr>
  `);

  dom.productTbody.innerHTML = bodyRows.join("");
}

function renderProductCell(row, column) {
  if (column.key === "productTitle" || column.key === "sku" || column.key === "status") {
    return renderTextCell(row[column.key] || "");
  }

  const value = formatProductCellValue(row, column.key);
  return `<td class="numeric ${getDeltaClass(row, column.key)}">${value}</td>`;
}

function formatProductCellValue(row, key) {
  if (key === "netSales") return formatCurrency(row.netSales);
  if (key === "netUnits") return formatNumber(row.netUnits);
  if (key === "salesShare") return formatPercent(row.salesShare);
  if (key === "change") return row.hasComparison ? formatCurrency(row.change) : "";
  if (key === "unitChange") return row.hasComparison ? formatNumber(row.unitChange) : "";
  if (key === "changePct") return row.hasComparison ? (row.changePct === null ? "n/a" : formatPercent(row.changePct)) : "";
  return "";
}

function renderProductTotalCell(column, totals) {
  if (column.key === "productTitle") return "<td>Total</td>";
  if (column.key === "sku" || column.key === "status") return "<td></td>";

  let value = "";
  if (column.key === "netSales") value = formatCurrency(totals.totalSales);
  if (column.key === "netUnits") value = formatNumber(totals.totalUnits);
  if (column.key === "salesShare") value = formatPercent(totals.totalSales ? 1 : 0);
  if (column.key === "change") value = totals.hasComparison ? formatCurrency(totals.totalChange) : "";
  if (column.key === "unitChange") value = totals.hasComparison ? formatNumber(totals.totalUnitChange) : "";
  if (column.key === "changePct") value = totals.hasComparison ? (totals.totalChangePct === null ? "n/a" : formatPercent(totals.totalChangePct)) : "";
  return `<td class="numeric">${value}</td>`;
}

function buildRegionalTopProducts(records, comparisonRecords = [], hasComparison = false) {
  const sortKey = dom.regionalProductSort?.value === "netUnits" ? "netUnits" : "netSales";
  const rows = [];

  for (const region of REGION_DEFS) {
    const regionalRecords = records.filter((record) => record.region === region.label);
    const regionalComparisonRecords = hasComparison
      ? comparisonRecords.filter((record) => record.region === region.label)
      : [];
    const comparisonProducts = hasComparison
      ? buildProductResults(regionalComparisonRecords)
        .sort((a, b) => sortRegionalProducts(a, b, sortKey))
        .slice(0, 20)
      : [];
    const comparisonRanks = new Map(comparisonProducts.map((product, index) => [product.productKey, index + 1]));
    const products = buildProductResults(regionalRecords)
      .sort((a, b) => sortRegionalProducts(a, b, sortKey))
      .slice(0, 20);

    products.forEach((product, index) => {
      const rank = index + 1;
      const comparisonRank = comparisonRanks.get(product.productKey) || null;
      rows.push({
        region: region.label,
        rank,
        rankChange: getRankChangeLabel(rank, comparisonRank, hasComparison),
        ...product
      });
    });
  }

  return rows;
}

function getRankChangeLabel(currentRank, comparisonRank, hasComparison) {
  if (!hasComparison) return "";
  if (!comparisonRank) return "NEW";
  const movement = comparisonRank - currentRank;
  if (movement === 0) return "0";
  return movement > 0 ? `+${movement}` : String(movement);
}

function getRankChangeClass(value) {
  if (value === "NEW") return "rank-new";
  if (String(value).startsWith("+")) return "rank-up";
  if (String(value).startsWith("-")) return "rank-down";
  return "";
}

function sortRegionalProducts(a, b, sortKey) {
  const primary = (b[sortKey] || 0) - (a[sortKey] || 0);
  if (primary) return primary;
  const secondary = (b.netSales || 0) - (a.netSales || 0);
  if (secondary) return secondary;
  return collator.compare(a.productTitle, b.productTitle);
}

function renderRegionalTopProducts(rows) {
  if (!dom.regionalProductsTbody) return;

  if (!rows.length) {
    dom.regionalProductsTbody.innerHTML = `<tr><td colspan="7">No regional product results for the selected period and filters</td></tr>`;
    return;
  }

  dom.regionalProductsTbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.region)}</td>
      <td class="numeric">${numberFormat.format(row.rank)}</td>
      <td class="numeric rank-change ${getRankChangeClass(row.rankChange)}">${escapeHtml(row.rankChange)}</td>
      <td><div class="clip" title="${escapeHtml(row.productTitle)}">${escapeHtml(row.productTitle)}</div></td>
      <td><div class="clip" title="${escapeHtml(row.sku)}">${escapeHtml(row.sku)}</div></td>
      <td class="numeric">${formatCurrency(row.netSales)}</td>
      <td class="numeric">${formatNumber(row.netUnits)}</td>
    </tr>
  `).join("");
}

function summarize(records) {
  const orders = new Set();
  let netSales = 0;
  let netUnits = 0;

  for (const record of records) {
    netSales += record.netSales;
    netUnits += record.netUnits;
    if (record.orderKey) orders.add(record.orderKey);
  }

  return {
    netSales,
    netUnits,
    orders: orders.size
  };
}

function applyDimensionFilters(records) {
  return records.filter((record) => DIMENSIONS.every((dimension) => {
    const selected = state.filters[dimension.key];
    if (!selected || selected.size === 0) return true;
    return selected.has(record[dimension.key] || BLANK);
  }));
}

function inDateRange(record, start, end) {
  if (!record.dateKey) return false;
  if (start && record.dateKey < start) return false;
  if (end && record.dateKey > end) return false;
  return true;
}

function hasComparisonPeriod() {
  return Boolean(dom.compareStart.value && dom.compareEnd.value);
}

function ensureDateDefaults(force = false) {
  const summary = getDatasetDateSummary();
  if (!summary) return;
  const latestWeek = getLatestUploadedWeekRange(summary.max);

  if (force || !dom.currentStart.value) dom.currentStart.value = latestWeek.start;
  if (force || !dom.currentEnd.value) dom.currentEnd.value = latestWeek.end;
  if (force || !dom.compareStart.value || !dom.compareEnd.value) setPreviousPeriod(false);
}

function getLatestUploadedWeekRange(maxDateKey) {
  const latest = dateFromKey(maxDateKey);
  const start = addDays(latest, -latest.getUTCDay());
  const end = addDays(start, 6);
  return {
    start: dateKey(start),
    end: dateKey(end)
  };
}

function setAllDates() {
  const summary = getDatasetDateSummary();
  if (!summary) return;
  state.dateTouched = true;
  dom.currentStart.value = summary.min;
  dom.currentEnd.value = summary.max;
  setPreviousPeriod(false);
  renderAll();
}

function setPreviousPeriod(shouldRender = true) {
  if (!dom.currentStart.value || !dom.currentEnd.value) return;
  const currentStart = dateFromKey(dom.currentStart.value);
  const currentEnd = dateFromKey(dom.currentEnd.value);
  const days = Math.max(1, Math.round((currentEnd - currentStart) / 86400000) + 1);
  const compareEnd = addDays(currentStart, -1);
  const compareStart = addDays(compareEnd, -(days - 1));
  dom.compareStart.value = dateKey(compareStart);
  dom.compareEnd.value = dateKey(compareEnd);
  state.dateTouched = true;
  if (shouldRender) renderAll();
}

function getDatasetDateSummary() {
  if (!state.records.length) return null;
  let min = "";
  let max = "";

  for (const record of state.records) {
    if (!record.dateKey) continue;
    if (!min || record.dateKey < min) min = record.dateKey;
    if (!max || record.dateKey > max) max = record.dateKey;
  }

  return min && max ? { min, max } : null;
}

function getActiveDimension() {
  return DIMENSIONS.find((dimension) => dimension.key === dom.dimensionSelect.value) || DIMENSIONS[0];
}

function getRowLimit() {
  return dom.rowLimit.value === "all" ? Infinity : Number(dom.rowLimit.value);
}

function exportPivotCsv() {
  const dimension = getActiveDimension();
  const rows = state.pivotRows;
  const columns = getTableColumns("pivot");
  const headers = columns.map((column) => column.key === "value" ? dimension.label : column.label);
  const lines = [
    headers,
    ...rows.map((row) => columns.map((column) => getPivotExportValue(row, column.key)))
  ];
  downloadFile(`pivot-${dimension.key}-${todayKey()}.csv`, lines.map(csvLine).join("\n"), "text/csv");
}

function exportProductCsv() {
  const columns = getTableColumns("product");
  const rows = sortProductRows(state.productRows);
  const headers = columns.map((column) => column.label);
  const lines = [
    headers,
    ...rows.map((row) => columns.map((column) => getProductExportValue(row, column.key)))
  ];
  const start = dom.currentStart.value || "all";
  const end = dom.currentEnd.value || todayKey();
  downloadFile(`product-results-${start}-to-${end}.csv`, lines.map(csvLine).join("\n"), "text/csv");
}

function getPivotExportValue(row, key) {
  if (key === "value") return row.value;
  if (key === "status") return row.status;
  if (key === "netSales") return row.netSales;
  if (key === "salesShare") return row.salesShare;
  if (key === "netUnits") return row.netUnits;
  if (key === "unitsShare") return row.unitsShare;
  if (key === "compareSales") return row.hasComparison ? row.compareSales : "";
  if (key === "change") return row.hasComparison ? row.change : "";
  if (key === "changePct") return row.hasComparison ? (row.changePct === null ? "n/a" : row.changePct) : "";
  return "";
}

function getProductExportValue(row, key) {
  if (key === "productTitle") return row.productTitle;
  if (key === "sku") return row.sku;
  if (key === "status") return row.status;
  if (key === "netSales") return row.netSales;
  if (key === "netUnits") return row.netUnits;
  if (key === "salesShare") return row.salesShare;
  if (key === "change") return row.hasComparison ? row.change : "";
  if (key === "unitChange") return row.hasComparison ? row.unitChange : "";
  if (key === "changePct") return row.hasComparison ? (row.changePct === null ? "n/a" : row.changePct) : "";
  return "";
}

class ZipArchive {
  constructor(buffer) {
    this.buffer = buffer;
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.entries = new Map();
    this.readCentralDirectory();
  }

  has(path) {
    return this.entries.has(path);
  }

  async text(path) {
    const bytes = await this.file(path);
    return new TextDecoder("utf-8").decode(bytes);
  }

  async file(path) {
    const normalized = path.replace(/^\/+/, "");
    const entry = this.entries.get(normalized);
    if (!entry) throw new Error(`Workbook part not found: ${normalized}`);

    const localOffset = entry.localOffset;
    if (this.view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid local ZIP header for ${normalized}.`);
    }

    const nameLength = this.view.getUint16(localOffset + 26, true);
    const extraLength = this.view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const compressed = this.bytes.slice(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return compressed;
    if (entry.method === 8) return inflateRaw(compressed, entry.uncompressedSize);
    throw new Error(`Unsupported ZIP compression method ${entry.method} in ${normalized}.`);
  }

  readCentralDirectory() {
    const eocdOffset = this.findEndOfCentralDirectory();
    const totalEntries = this.view.getUint16(eocdOffset + 10, true);
    let offset = this.view.getUint32(eocdOffset + 16, true);

    for (let index = 0; index < totalEntries; index += 1) {
      if (this.view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("Invalid ZIP central directory.");
      }

      const method = this.view.getUint16(offset + 10, true);
      const compressedSize = this.view.getUint32(offset + 20, true);
      const uncompressedSize = this.view.getUint32(offset + 24, true);
      const nameLength = this.view.getUint16(offset + 28, true);
      const extraLength = this.view.getUint16(offset + 30, true);
      const commentLength = this.view.getUint16(offset + 32, true);
      const localOffset = this.view.getUint32(offset + 42, true);
      const nameStart = offset + 46;
      const name = new TextDecoder("utf-8").decode(this.bytes.slice(nameStart, nameStart + nameLength));

      this.entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
      offset = nameStart + nameLength + extraLength + commentLength;
    }
  }

  findEndOfCentralDirectory() {
    const minimum = Math.max(0, this.bytes.length - 65557);
    for (let offset = this.bytes.length - 22; offset >= minimum; offset -= 1) {
      if (this.view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error("Invalid XLSX file: ZIP directory was not found.");
  }
}

async function inflateRaw(bytes, expectedSize = 0) {
  if (typeof DecompressionStream !== "undefined") {
    const formats = ["deflate-raw", "deflate"];
    for (const format of formats) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (error) {
        // Fall through to the local inflater below.
      }
    }
  }

  return inflateRawSync(bytes, expectedSize);
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let fixedLiteralTable = null;
let fixedDistanceTable = null;

function inflateRawSync(input, expectedSize = 0) {
  const reader = new BitReader(input);
  let output = new Uint8Array(expectedSize || Math.max(32768, input.length * 4));
  let out = 0;
  let isFinal = false;

  const ensure = (additional) => {
    const needed = out + additional;
    if (needed <= output.length) return;
    let nextLength = output.length;
    while (nextLength < needed) nextLength *= 2;
    const next = new Uint8Array(nextLength);
    next.set(output);
    output = next;
  };

  const writeByte = (value) => {
    ensure(1);
    output[out] = value;
    out += 1;
  };

  const copyBackReference = (distance, length) => {
    if (distance <= 0 || distance > out) {
      throw new Error("Invalid DEFLATE back-reference.");
    }
    ensure(length);
    for (let index = 0; index < length; index += 1) {
      output[out] = output[out - distance];
      out += 1;
    }
  };

  while (!isFinal) {
    isFinal = reader.readBits(1) === 1;
    const blockType = reader.readBits(2);

    if (blockType === 0) {
      reader.alignByte();
      const length = reader.readByte() | (reader.readByte() << 8);
      const inverseLength = reader.readByte() | (reader.readByte() << 8);
      if (((length ^ 0xffff) & 0xffff) !== inverseLength) {
        throw new Error("Invalid uncompressed DEFLATE block.");
      }
      ensure(length);
      for (let index = 0; index < length; index += 1) {
        output[out] = reader.readByte();
        out += 1;
      }
      continue;
    }

    if (blockType === 3) {
      throw new Error("Invalid DEFLATE block type.");
    }

    const tables = blockType === 1 ? fixedTables() : dynamicTables(reader);
    decodeCompressedBlock(reader, tables.literal, tables.distance, writeByte, copyBackReference);
  }

  return output.slice(0, out);
}

function decodeCompressedBlock(reader, literalTable, distanceTable, writeByte, copyBackReference) {
  while (true) {
    const symbol = decodeSymbol(reader, literalTable);
    if (symbol < 256) {
      writeByte(symbol);
      continue;
    }
    if (symbol === 256) return;

    const lengthIndex = symbol - 257;
    if (lengthIndex < 0 || lengthIndex >= LENGTH_BASE.length) {
      throw new Error("Invalid DEFLATE length symbol.");
    }

    const length = LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
    const distanceSymbol = decodeSymbol(reader, distanceTable);
    if (distanceSymbol < 0 || distanceSymbol >= DIST_BASE.length) {
      throw new Error("Invalid DEFLATE distance symbol.");
    }
    const distance = DIST_BASE[distanceSymbol] + reader.readBits(DIST_EXTRA[distanceSymbol]);
    copyBackReference(distance, length);
  }
}

function fixedTables() {
  if (!fixedLiteralTable) {
    const literalLengths = new Array(288).fill(0);
    for (let index = 0; index <= 143; index += 1) literalLengths[index] = 8;
    for (let index = 144; index <= 255; index += 1) literalLengths[index] = 9;
    for (let index = 256; index <= 279; index += 1) literalLengths[index] = 7;
    for (let index = 280; index <= 287; index += 1) literalLengths[index] = 8;
    fixedLiteralTable = buildHuffman(literalLengths);
    fixedDistanceTable = buildHuffman(new Array(32).fill(5));
  }
  return { literal: fixedLiteralTable, distance: fixedDistanceTable };
}

function dynamicTables(reader) {
  const literalCount = reader.readBits(5) + 257;
  const distanceCount = reader.readBits(5) + 1;
  const codeLengthCount = reader.readBits(4) + 4;
  const codeLengthLengths = new Array(19).fill(0);

  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[index]] = reader.readBits(3);
  }

  const codeLengthTable = buildHuffman(codeLengthLengths);
  const lengths = [];
  const totalLengths = literalCount + distanceCount;

  while (lengths.length < totalLengths) {
    const symbol = decodeSymbol(reader, codeLengthTable);
    if (symbol <= 15) {
      lengths.push(symbol);
    } else if (symbol === 16) {
      if (!lengths.length) throw new Error("Invalid DEFLATE repeat length.");
      const repeat = reader.readBits(2) + 3;
      const previous = lengths[lengths.length - 1];
      for (let index = 0; index < repeat; index += 1) lengths.push(previous);
    } else if (symbol === 17) {
      const repeat = reader.readBits(3) + 3;
      for (let index = 0; index < repeat; index += 1) lengths.push(0);
    } else if (symbol === 18) {
      const repeat = reader.readBits(7) + 11;
      for (let index = 0; index < repeat; index += 1) lengths.push(0);
    } else {
      throw new Error("Invalid DEFLATE code length symbol.");
    }
  }

  return {
    literal: buildHuffman(lengths.slice(0, literalCount)),
    distance: buildHuffman(lengths.slice(literalCount, totalLengths))
  };
}

function buildHuffman(lengths) {
  const maxBits = Math.max(0, ...lengths);
  if (!maxBits) return { maxBits: 0, tables: [] };

  const counts = new Array(maxBits + 1).fill(0);
  for (const length of lengths) {
    if (length > 0) counts[length] += 1;
  }

  let code = 0;
  const nextCode = new Array(maxBits + 1).fill(0);
  for (let bits = 1; bits <= maxBits; bits += 1) {
    code = (code + counts[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  const tables = Array.from({ length: maxBits + 1 }, () => []);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol];
    if (!length) continue;
    const reversed = reverseBits(nextCode[length], length);
    nextCode[length] += 1;
    tables[length][reversed] = symbol;
  }

  return { maxBits, tables };
}

function decodeSymbol(reader, huffman) {
  let code = 0;
  for (let length = 1; length <= huffman.maxBits; length += 1) {
    code |= reader.readBits(1) << (length - 1);
    const table = huffman.tables[length];
    const symbol = table && table[code];
    if (symbol !== undefined) return symbol;
  }
  throw new Error("Invalid DEFLATE Huffman code.");
}

function reverseBits(value, length) {
  let reversed = 0;
  for (let index = 0; index < length; index += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.position = 0;
    this.buffer = 0;
    this.bitCount = 0;
  }

  readBits(count) {
    let value = 0;
    let shift = 0;
    let remaining = count;

    while (remaining > 0) {
      if (this.bitCount === 0) {
        if (this.position >= this.bytes.length) throw new Error("Unexpected end of DEFLATE stream.");
        this.buffer = this.bytes[this.position];
        this.position += 1;
        this.bitCount = 8;
      }

      const take = Math.min(remaining, this.bitCount);
      value |= (this.buffer & ((1 << take) - 1)) << shift;
      this.buffer >>= take;
      this.bitCount -= take;
      remaining -= take;
      shift += take;
    }

    return value;
  }

  readByte() {
    if (this.bitCount === 0) {
      if (this.position >= this.bytes.length) throw new Error("Unexpected end of DEFLATE stream.");
      const value = this.bytes[this.position];
      this.position += 1;
      return value;
    }
    return this.readBits(8);
  }

  alignByte() {
    this.buffer = 0;
    this.bitCount = 0;
  }
}

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error(parserError.textContent || "XML parse error.");
  return doc;
}

function normalizeZipPath(basePath, target) {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const baseParts = basePath.split("/");
  baseParts.pop();
  const parts = [...baseParts, ...target.split("/")];
  const normalized = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }

  return normalized.join("/");
}

function getXmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

function columnIndex(reference) {
  const letters = (reference.match(/[A-Z]+/i) || [""])[0].toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseDateValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400000));
    return { dateTime: date.toISOString(), dateKey: dateKey(date) };
  }

  const text = cleanText(value);
  if (!text) return null;

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const date = new Date(`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00Z`);
    return { dateTime: text, dateKey: `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` };
  }

  const localDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (localDate) {
    const month = Number(localDate[1]);
    const day = Number(localDate[2]);
    const year = Number(localDate[3]);
    const hour = Number(localDate[4] || 0);
    const minute = Number(localDate[5] || 0);
    const second = Number(localDate[6] || 0);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dateKeyText = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      return { dateTime: date.toISOString(), dateKey: dateKeyText };
    }
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return { dateTime: parsed.toISOString(), dateKey: dateKey(parsed) };
}

function dateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00Z`);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function todayKey() {
  return dateKey(new Date());
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function cleanDimension(value) {
  return cleanText(value) || BLANK;
}

function removeHiddenFilterSelections(selected) {
  if (!selected) return;
  for (const value of Array.from(selected)) {
    if (isHiddenFilterValue(value)) selected.delete(value);
  }
}

function isHiddenFilterValue(value) {
  return isBlankValue(value) || isReferenceErrorValue(value);
}

function isHiddenResultValue(value) {
  return isBlankValue(value);
}

function isBlankValue(value) {
  const text = cleanText(value);
  return !text || text === BLANK;
}

function isReferenceErrorValue(value) {
  const text = cleanText(value).toUpperCase();
  return text === "#REF" || text === "#REF!";
}

function hydrateRecord(record) {
  const hydrated = {
    ...record,
    status: normalizeStatus(record.status),
    region: getRegion(record.shippingProvince)
  };
  hydrated.orderKey = getOrderKey(hydrated);
  return hydrated;
}

function normalizeStatus(value) {
  const status = cleanDimension(value);
  return status.toUpperCase() === "#VALUE" || status.toUpperCase() === "#VALUE!" ? "Full Price" : status;
}

function getOrderKey(record) {
  const orderId = cleanText(record.orderId);
  if (!orderId) return `${record.sourceHash}|row:${record.sourceRow}`;
  if (isScientificNotation(orderId)) return `${orderId}|${record.dateTime || record.dateKey || ""}`;
  return orderId;
}

function isScientificNotation(value) {
  return /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(cleanText(value));
}

function getRegion(province) {
  const normalizedProvince = normalizeRegionProvince(province);
  return PROVINCE_TO_REGION.get(normalizedProvince) || "Other";
}

function normalizeRegionProvince(province) {
  return cleanText(province)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = cleanText(value).replace(/[$,%]/g, "").replace(/,/g, "");
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function percentChange(current, comparison) {
  if (!comparison) return current ? null : 0;
  return (current - comparison) / Math.abs(comparison);
}

function sum(records, key) {
  return records.reduce((total, record) => total + (Number(record[key]) || 0), 0);
}

function formatCurrency(value) {
  return currencyFormat.format(value || 0);
}

function formatCompactCurrency(value) {
  return compactCurrencyFormat.format(value || 0);
}

function formatNumber(value) {
  return numberFormat.format(value || 0);
}

function formatPercent(value) {
  return percentFormat.format(value || 0);
}

function compactDateRange(minDate, maxDate) {
  if (minDate && maxDate && minDate !== maxDate) return `${minDate} to ${maxDate}`;
  return minDate || maxDate || "";
}

function csvLine(values) {
  return values.map((value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
  }).join(",");
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function hashString(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setStatus(message, kind = "") {
  dom.status.textContent = message;
  dom.status.classList.toggle("busy", kind === "busy");
  dom.status.classList.toggle("error", kind === "error");
}

function reportGlobalError(error) {
  const message = error && error.message ? error.message : String(error || "Unknown error");
  const status = document.querySelector("#status");
  if (status) {
    status.textContent = `App error: ${message}`;
    status.classList.remove("busy");
    status.classList.add("error");
  }
  console.error(error);
}
