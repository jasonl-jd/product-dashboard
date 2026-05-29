"use strict";

window.__PRODUCT_DASHBOARD_APP_LOADED__ = true;
window.addEventListener("error", (event) => reportGlobalError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => reportGlobalError(event.reason));

const DATA_MANIFEST_URL = "data/manifest.json";
const BLANK = "(blank)";
const MAX_FILTER_OPTIONS = 180;

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
  netSales: (row) => row.netSales,
  salesShare: (row) => row.salesShare,
  netUnits: (row) => row.netUnits,
  unitsShare: (row) => row.unitsShare,
  compareSales: (row) => row.compareSales,
  change: (row) => row.change,
  changePct: (row) => row.changePct ?? Number.NEGATIVE_INFINITY
};

const state = {
  records: [],
  files: [],
  rowKeys: new Set(),
  filters: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, new Set()])),
  filterSearch: {},
  pivotRows: [],
  productRows: [],
  regionalProductRows: [],
  dateTouched: false,
  loading: false
};

const dom = {};
const currencyFormat = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const currencyPreciseFormat = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });
const numberFormat = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 });
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

document.addEventListener("DOMContentLoaded", init);

async function init() {
  collectDom();
  populateDimensionSelect();
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
    kpiAur: document.querySelector("#kpi-aur"),
    kpiAurDelta: document.querySelector("#kpi-aur-delta"),
    chartHeading: document.querySelector("#chart-heading"),
    activeDimension: document.querySelector("#active-dimension"),
    barChart: document.querySelector("#bar-chart"),
    fileTbody: document.querySelector("#file-tbody"),
    pivotHeading: document.querySelector("#pivot-heading"),
    pivotTbody: document.querySelector("#pivot-tbody"),
    productHeading: document.querySelector("#product-heading"),
    productTbody: document.querySelector("#product-tbody"),
    regionalProductSort: document.querySelector("#regional-product-sort"),
    regionalProductsTbody: document.querySelector("#regional-products-tbody")
  });
}

function bindEvents() {
  dom.refreshData?.addEventListener("click", () => refreshRepositoryData({ preserveDates: true }));
  dom.allDates.addEventListener("click", setAllDates);
  dom.previousPeriod.addEventListener("click", setPreviousPeriod);
  dom.dimensionSelect.addEventListener("change", renderAll);
  dom.sortSelect.addEventListener("change", renderAll);
  dom.sortDir.addEventListener("change", renderAll);
  dom.rowLimit.addEventListener("change", renderAll);
  dom.regionalProductSort.addEventListener("change", renderAll);
  dom.exportCsv.addEventListener("click", exportPivotCsv);
  dom.clearFilters.addEventListener("click", clearAllFilters);

  [dom.currentStart, dom.currentEnd, dom.compareStart, dom.compareEnd].forEach((input) => {
    input.addEventListener("change", () => {
      state.dateTouched = true;
      renderAll();
    });
  });

  dom.filters.addEventListener("input", handleFilterInput);
  dom.filters.addEventListener("change", handleFilterChange);
  dom.filters.addEventListener("click", handleFilterClick);

  document.querySelector(".pivot-table thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort-key]");
    if (!button) return;
    const key = button.dataset.sortKey;
    if (dom.sortSelect.value === key) {
      dom.sortDir.value = dom.sortDir.value === "desc" ? "asc" : "desc";
    } else {
      dom.sortSelect.value = key;
      dom.sortDir.value = key === "value" ? "asc" : "desc";
    }
    renderAll();
  });

}

function populateDimensionSelect() {
  dom.dimensionSelect.innerHTML = DIMENSIONS
    .map((dimension) => `<option value="${dimension.key}">${escapeHtml(dimension.label)}</option>`)
    .join("");
}

async function refreshRepositoryData({ preserveDates } = { preserveDates: true }) {
  if (state.loading) return;
  state.loading = true;
  setStatus("Loading repository data...", "busy");

  try {
    await loadRepositoryData();
    ensureDateDefaults(!preserveDates || !state.dateTouched);
    renderAll();

    if (!state.files.length) {
      setStatus("Ready. Add Excel files to data/manifest.json to populate the shared dashboard.");
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

async function loadRepositoryData() {
  const manifest = await fetchRepositoryManifest();
  const files = normalizeManifestFiles(manifest);
  const records = [];
  const fileMetas = [];
  const rowKeys = new Set();

  for (const file of files) {
    setStatus(`Loading ${file.name}...`, "busy");
    const response = await fetch(withCacheBust(file.path), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${file.path} (${response.status}). Check data/manifest.json and the file path.`);
    }

    const buffer = await response.arrayBuffer();
    validateWorkbookResponse(buffer, file, response);
    const sourceHash = `repo:${file.path}`;
    const parsed = await parseSalesWorkbook(buffer, file.name, sourceHash, (message) => setStatus(message, "busy"));
    const addedRecords = [];
    let rowsAdded = 0;
    let rowsSkipped = 0;

    for (const record of parsed.records.map(hydrateRecord)) {
      if (rowKeys.has(record.rowKey)) {
        rowsSkipped += 1;
        continue;
      }
      rowKeys.add(record.rowKey);
      records.push(record);
      addedRecords.push(record);
      rowsAdded += 1;
    }

    fileMetas.push({
      hash: sourceHash,
      name: file.name,
      path: file.path,
      source: "Repository",
      rowsRead: parsed.records.length,
      rowsAdded,
      rowsSkipped,
      minDate: parsed.minDate,
      maxDate: parsed.maxDate,
      netSales: sum(addedRecords, "netSales"),
      netUnits: sum(addedRecords, "netUnits")
    });
  }

  state.records = records;
  state.files = fileMetas;
  state.rowKeys = rowKeys;
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

function validateWorkbookResponse(buffer, file, response) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return;

  const preview = new TextDecoder("utf-8").decode(bytes.slice(0, 500)).trim();
  const lowerPreview = preview.toLowerCase();
  const contentType = response.headers.get("content-type") || "unknown content type";
  const firstBytes = Array.from(bytes.slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");

  if (lowerPreview.startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(`${file.name} is a Git LFS pointer, not the actual Excel file. Store the real .xlsx in the repo/Pages deployment, or use a raw downloadable file URL in data/manifest.json.`);
  }

  if (bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
    throw new Error(`${file.name} is an old binary .xls workbook or a file saved in the wrong Excel format. Re-save it as a real .xlsx workbook and update data/manifest.json if the filename changes.`);
  }

  if (lowerPreview.startsWith("<!doctype html") || lowerPreview.startsWith("<html") || lowerPreview.includes("<title>")) {
    throw new Error(`${file.name} loaded as HTML instead of an Excel workbook. In data/manifest.json, use a Pages-relative file path like "data/file.xlsx" or a raw download URL, not a GitHub "blob" page URL.`);
  }

  if (lowerPreview.includes("404") || lowerPreview.includes("not found")) {
    throw new Error(`${file.name} was not found at ${file.path}. Check the file path, capitalization, and GitHub Pages deployment.`);
  }

  throw new Error(`${file.name} did not load as a valid .xlsx file. Expected ZIP bytes starting with PK, got ${contentType}; first bytes: ${firstBytes || "empty file"}. Check that the committed file is a real .xlsx workbook, not a renamed .xls/csv/html file or Git LFS pointer.`);
}

async function parseSalesWorkbook(buffer, fileName, sourceHash, onProgress) {
  onProgress(`Opening ${fileName}...`);
  const zip = new ZipArchive(buffer);
  const sharedStrings = await readSharedStrings(zip);
  const sheetPath = await findSheetPath(zip, "Detail");

  onProgress(`Parsing Detail tab in ${fileName}...`);
  const sheetXml = await zip.text(sheetPath);
  const parsed = await parseDetailSheet(sheetXml, sharedStrings, fileName, sourceHash, onProgress);

  if (!parsed.records.length) {
    throw new Error(`${fileName} did not contain usable rows on the Detail tab.`);
  }

  return parsed;
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

async function findSheetPath(zip, sheetName) {
  const workbook = await zip.text("xl/workbook.xml");
  const sheets = Array.from(workbook.matchAll(/<sheet\b([^>]*)\/?>/g)).map((match) => match[1]);
  const sheet = sheets.find((attributes) => cleanText(getXmlAttribute(attributes, "name")).toLowerCase() === sheetName.toLowerCase());
  if (!sheet) {
    throw new Error(`Workbook is missing a "${sheetName}" sheet.`);
  }

  const relationshipId = getXmlAttribute(sheet, "r:id") || getXmlAttribute(sheet, "id");
  const rels = await zip.text("xl/_rels/workbook.xml.rels");
  const relationships = Array.from(rels.matchAll(/<Relationship\b([^>]*)\/?>/g)).map((match) => match[1]);
  const relationship = relationships.find((attributes) => getXmlAttribute(attributes, "Id") === relationshipId);
  if (!relationship) {
    throw new Error(`Workbook relationship for "${sheetName}" could not be found.`);
  }

  return normalizeZipPath("xl/workbook.xml", getXmlAttribute(relationship, "Target"));
}

async function parseDetailSheet(sheetXml, sharedStrings, fileName, sourceHash, onProgress) {
  const sheetDataMatch = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) {
    throw new Error("Detail sheet has no sheetData section.");
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
    throw new Error(`Detail tab is missing required columns: ${missing.join(", ")}.`);
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
    sourceRow: rowNumber
  };

  for (const dimension of DIMENSIONS) {
    record[dimension.key] = cleanDimension(cells[fieldIndex[dimension.key]]);
  }
  record.status = normalizeStatus(record.status);
  record.region = getRegion(record.shippingProvince);

  record.rowKey = [
    record.orderId,
    record.sku,
    record.productTitle,
    record.dateTime,
    record.netSales,
    record.netUnits,
    record.shippingProvince,
    record.status,
    record.customerType
  ].join("|");

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
  state.pivotRows = buildPivot(current, comparison, hasComparison);
  state.productRows = buildProductResults(current);
  state.regionalProductRows = buildRegionalTopProducts(current);
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
  setKpi(dom.kpiAur, dom.kpiAurDelta, formatCurrencyPrecise(current.aov), hasComparison ? percentChange(current.aov, comparison.aov) : null, hasComparison);
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

  const countsByDimension = {};
  for (const dimension of DIMENSIONS) {
    countsByDimension[dimension.key] = new Map();
  }

  for (const record of state.records) {
    for (const dimension of DIMENSIONS) {
      const value = record[dimension.key] || BLANK;
      const counts = countsByDimension[dimension.key];
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }

  dom.filters.innerHTML = DIMENSIONS.map((dimension, index) => {
    const selected = state.filters[dimension.key];
    const search = state.filterSearch[dimension.key] || "";
    const selectedLabel = selected.size ? numberFormat.format(selected.size) : "All";
    const counts = countsByDimension[dimension.key];
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

    return `
      <details class="filter-group" ${index < 5 || selected.size ? "open" : ""}>
        <summary>
          <span>${escapeHtml(dimension.label)}</span>
          <span class="filter-count">${selectedLabel}</span>
        </summary>
        <div class="filter-body">
          <input type="search" data-filter-search="${dimension.key}" value="${escapeHtml(search)}" placeholder="Search">
          <button class="text-button" data-filter-clear="${dimension.key}" type="button">All</button>
          <div class="filter-options">${optionMarkup || `<div class="empty-state">No matches</div>`}</div>
        </div>
      </details>
    `;
  }).join("");
}

function handleFilterInput(event) {
  const input = event.target.closest("[data-filter-search]");
  if (!input) return;
  state.filterSearch[input.dataset.filterSearch] = input.value;
  renderFilters();
  const replacement = dom.filters.querySelector(`[data-filter-search="${input.dataset.filterSearch}"]`);
  if (replacement) {
    replacement.focus();
    replacement.setSelectionRange(replacement.value.length, replacement.value.length);
  }
}

function handleFilterChange(event) {
  const checkbox = event.target.closest("[data-filter-option]");
  if (!checkbox) return;
  const key = checkbox.dataset.filterOption;
  if (!state.filters[key]) state.filters[key] = new Set();
  if (checkbox.checked) {
    state.filters[key].add(checkbox.value);
  } else {
    state.filters[key].delete(checkbox.value);
  }
  renderAll();
}

function handleFilterClick(event) {
  const button = event.target.closest("[data-filter-clear]");
  if (!button) return;
  state.filters[button.dataset.filterClear].clear();
  renderAll();
}

function clearAllFilters() {
  for (const dimension of DIMENSIONS) {
    state.filters[dimension.key].clear();
  }
  renderAll();
}

function buildPivot(currentRecords, comparisonRecords, hasComparison) {
  const dimension = getActiveDimension();
  const currentMap = aggregateByDimension(currentRecords, dimension.key);
  const compareMap = aggregateByDimension(comparisonRecords, dimension.key);
  const totalSales = sum(currentRecords, "netSales");
  const totalUnits = sum(currentRecords, "netUnits");
  const values = hasComparison ? new Set([...currentMap.keys(), ...compareMap.keys()]) : new Set(currentMap.keys());

  const rows = Array.from(values).map((value) => {
    const current = currentMap.get(value) || emptyAggregate();
    const comparison = compareMap.get(value) || emptyAggregate();
    const change = hasComparison ? current.netSales - comparison.netSales : null;

    return {
      value,
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
    if (!map.has(value)) map.set(value, emptyAggregate());
    const aggregate = map.get(value);
    aggregate.netSales += record.netSales;
    aggregate.netUnits += record.netUnits;
    if (record.orderId) aggregate.orders.add(record.orderId);
  }
  return map;
}

function emptyAggregate() {
  return {
    netSales: 0,
    netUnits: 0,
    orders: new Set()
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

  dom.pivotHeading.textContent = `Performance by ${dimension.label}`;

  if (!visibleRows.length) {
    dom.pivotTbody.innerHTML = `<tr><td colspan="8">No rows for the selected period and filters</td></tr>`;
    return;
  }

  dom.pivotTbody.innerHTML = visibleRows.map((row) => `
    <tr>
      <td><div class="clip" title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</div></td>
      <td class="numeric">${formatCurrency(row.netSales)}</td>
      <td class="numeric">${formatPercent(row.salesShare)}</td>
      <td class="numeric">${formatNumber(row.netUnits)}</td>
      <td class="numeric">${formatPercent(row.unitsShare)}</td>
      <td class="numeric">${row.hasComparison ? formatCurrency(row.compareSales) : ""}</td>
      <td class="numeric ${row.hasComparison && row.change > 0 ? "delta-positive" : row.hasComparison && row.change < 0 ? "delta-negative" : ""}">${row.hasComparison ? formatCurrency(row.change) : ""}</td>
      <td class="numeric ${row.hasComparison && row.change > 0 ? "delta-positive" : row.hasComparison && row.change < 0 ? "delta-negative" : ""}">${row.hasComparison ? (row.changePct === null ? "n/a" : formatPercent(row.changePct)) : ""}</td>
    </tr>
  `).join("");
}

function buildProductResults(records) {
  const totalSales = sum(records, "netSales");
  const map = new Map();

  for (const record of records) {
    const title = record.productTitle || BLANK;
    const sku = record.sku || BLANK;
    const key = `${sku}|${title}`;
    if (!map.has(key)) {
      map.set(key, {
        sku,
        productTitle: title,
        netSales: 0,
        netUnits: 0,
        salesShare: 0
      });
    }

    const product = map.get(key);
    product.netSales += record.netSales;
    product.netUnits += record.netUnits;
  }

  return Array.from(map.values())
    .map((product) => ({
      ...product,
      salesShare: totalSales ? product.netSales / totalSales : 0
    }))
    .sort((a, b) => b.netSales - a.netSales || collator.compare(a.productTitle, b.productTitle));
}

function renderProductTable(rows) {
  if (!dom.productTbody) return;

  const totalSales = sum(rows, "netSales");
  const totalUnits = sum(rows, "netUnits");
  const suffix = rows.length === 1 ? "product" : "products";
  dom.productHeading.textContent = `Product Results (${numberFormat.format(rows.length)} ${suffix})`;

  if (!rows.length) {
    dom.productTbody.innerHTML = `<tr><td colspan="5">No products for the selected period and filters</td></tr>`;
    return;
  }

  const bodyRows = rows.map((row) => `
    <tr>
      <td><div class="clip" title="${escapeHtml(row.productTitle)}">${escapeHtml(row.productTitle)}</div></td>
      <td><div class="clip" title="${escapeHtml(row.sku)}">${escapeHtml(row.sku)}</div></td>
      <td class="numeric">${formatCurrency(row.netSales)}</td>
      <td class="numeric">${formatNumber(row.netUnits)}</td>
      <td class="numeric">${formatPercent(row.salesShare)}</td>
    </tr>
  `);

  bodyRows.push(`
    <tr class="total-row">
      <td>Total</td>
      <td></td>
      <td class="numeric">${formatCurrency(totalSales)}</td>
      <td class="numeric">${formatNumber(totalUnits)}</td>
      <td class="numeric">${formatPercent(totalSales ? 1 : 0)}</td>
    </tr>
  `);

  dom.productTbody.innerHTML = bodyRows.join("");
}

function buildRegionalTopProducts(records) {
  const sortKey = dom.regionalProductSort?.value === "netUnits" ? "netUnits" : "netSales";
  const rows = [];

  for (const region of REGION_DEFS) {
    const regionalRecords = records.filter((record) => record.region === region.label);
    const products = buildProductResults(regionalRecords)
      .sort((a, b) => sortRegionalProducts(a, b, sortKey))
      .slice(0, 20);

    products.forEach((product, index) => {
      rows.push({
        region: region.label,
        rank: index + 1,
        ...product
      });
    });
  }

  return rows;
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
    dom.regionalProductsTbody.innerHTML = `<tr><td colspan="6">No regional product results for the selected period and filters</td></tr>`;
    return;
  }

  dom.regionalProductsTbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.region)}</td>
      <td class="numeric">${numberFormat.format(row.rank)}</td>
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
    if (record.orderId) orders.add(record.orderId);
  }

  return {
    netSales,
    netUnits,
    orders: orders.size,
    aov: orders.size ? netSales / orders.size : 0
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

  if (force || !dom.currentStart.value) dom.currentStart.value = summary.min;
  if (force || !dom.currentEnd.value) dom.currentEnd.value = summary.max;
  if (force || !dom.compareStart.value || !dom.compareEnd.value) setPreviousPeriod(false);
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
  const headers = [dimension.label, "Net Sales", "% Sales", "Net Units", "% Units", "Compare Sales", "Change", "Change %"];
  const lines = [
    headers,
    ...rows.map((row) => [
      row.value,
      row.netSales,
      row.salesShare,
      row.netUnits,
      row.unitsShare,
      row.hasComparison ? row.compareSales : "",
      row.hasComparison ? row.change : "",
      row.hasComparison ? (row.changePct === null ? "n/a" : row.changePct) : ""
    ])
  ];
  downloadFile(`pivot-${dimension.key}-${todayKey()}.csv`, lines.map(csvLine).join("\n"), "text/csv");
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

function hydrateRecord(record) {
  return {
    ...record,
    status: normalizeStatus(record.status),
    region: getRegion(record.shippingProvince)
  };
}

function normalizeStatus(value) {
  const status = cleanDimension(value);
  return status.toUpperCase() === "#VALUE" || status.toUpperCase() === "#VALUE!" ? "Full Price" : status;
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

function formatCurrencyPrecise(value) {
  return currencyPreciseFormat.format(value || 0);
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
