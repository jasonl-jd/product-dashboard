"use strict";

window.__PRODUCT_DASHBOARD_APP_LOADED__ = true;
window.addEventListener("error", (event) => reportGlobalError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => reportGlobalError(event.reason));

const DATA_MANIFEST_URL = "data/manifest.json";
const COMPILED_DATA_URL = "data/compiled-data.json";
const COMPILED_DATA_SCHEMA_VERSION = 1;
const DATA_CACHE_DB = "product-performance-dashboard";
const DATA_CACHE_STORE = "parsed-files";
const DATA_CACHE_VERSION = "parsed-csv-v10";
const COMPILED_DATA_CACHE_VERSION = "compiled-json-v1";
const PRODUCT_PANEL_COLLAPSED_STORAGE_KEY = "product-dashboard:product-panel-collapsed";
const COLUMN_SETTINGS_VERSION = 2;
const COLUMN_SETTINGS_VERSION_STORAGE_KEY = "product-dashboard:column-settings-version";
const COLUMN_SETTINGS_MIGRATION_VISIBLE_KEYS = {
  status: ["value", "unitChange", "unitChangePct"],
  pivot: ["unitChange", "unitChangePct"],
  product: ["unitChange", "unitChangePct"]
};
const BLANK = "(blank)";
const MAX_FILTER_OPTIONS = 180;
const MAX_PIVOT_NAME_FILTER_OPTIONS = 360;
const FILTER_APPLY_DEBOUNCE_MS = 180;
const FILTER_OPTIONS_REFRESH_DEBOUNCE_MS = 260;
const SKU_DISPLAY_WIDTH = 8;
const TREND_SUGGESTION_LIMIT = 20;
const TREND_SKU_SUGGESTION_MIN = 5;
const TREND_TEXT_SUGGESTION_MIN = 4;
const TREND_METRIC_OPTIONS = new Set(["sales", "units", "both"]);
const TREND_MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PRODUCT_COMPARE_LIMIT = 4;
const PRODUCT_COMPARE_COLORS = ["#ffdd00", "#4fb6ff", "#d71920", "#f7f7f2"];
const PRODUCT_COMPARE_REGION_COLORS = ["#ffdd00", "#4fb6ff", "#d71920", "#9bdc6a", "#c792ea", "#f7b500", "#ff7ab6", "#7ee0d2", "#a0c4ff", "#ffa552", "#82e0aa", "#f7f7f2"];
const PRICE_STATUS_LABELS = ["Full Price", "Markdown"];
const STATUS_DISPLAY_ORDER = ["Full Price", "Markdown", "Return"];
const EXCLUDED_ANALYSIS_PRODUCT_TITLES = new Set(["[refund adjustment]", "refund adjustment"]);
const UNASSIGNED_ATTRIBUTE_VALUES = new Set(["false"]);
const CUSTOMER_TYPE_VALUES = new Set(["first time customer", "returning customer"]);
const COMPARE_BASIS_DEFAULT = "auto";
const COMPARE_BASIS_LABELS = {
  auto: "Auto",
  total: "Total",
  "average-week": "Average Week",
  "average-period": "Average Matching Period",
  "rolling-4-week": "Rolling 4-Week Avg"
};
const ARRAY_APPEND_CHUNK_SIZE = 5000;

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
  { key: "franchise", label: "Franchise", headers: ["Franchise", "Collection"] },
  { key: "orderId", label: "Order ID", headers: ["Order ID", "Order"] },
  { key: "date", label: "Date", headers: ["Date", "Order Date"] },
  { key: "compareAtPrice", label: "Compare At price", headers: ["Compare At price", "Compare At Price", "Compare At"] },
  { key: "netSales", label: "Net Sales", headers: ["Net Sales"] },
  { key: "netUnits", label: "Net Quantity", headers: ["Net Quantity", "Net Units", "Net Units Sold"] },
  { key: "isReturn", label: "Is Return", headers: ["Is_Return", "Is Return"] },
  ...DIMENSIONS
];

const COMPILED_RECORD_FIELDS = [
  "sku",
  "productTitle",
  "franchise",
  "orderId",
  "dateTime",
  "dateKey",
  "compareAtPrice",
  "netSales",
  "netUnits",
  "isReturn",
  "sourceFile",
  "sourceHash",
  "sourceRow",
  "rowKey",
  ...DIMENSIONS.map((dimension) => dimension.key)
];

const SORTERS = {
  value: (row) => row.value.toLocaleLowerCase(),
  status: (row) => row.status,
  netSales: (row) => row.netSales,
  salesShare: (row) => row.salesShare,
  netUnits: (row) => row.netUnits,
  unitsShare: (row) => row.unitsShare,
  orders: (row) => row.orders,
  compareSales: (row) => row.compareSales,
  change: (row) => row.change,
  changePct: (row) => row.changePct ?? Number.NEGATIVE_INFINITY,
  unitChange: (row) => row.unitChange,
  unitChangePct: (row) => row.unitChangePct ?? Number.NEGATIVE_INFINITY
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
  { key: "changePct", label: "Change %", numeric: true },
  { key: "unitChange", label: "Units Change", numeric: true },
  { key: "unitChangePct", label: "Unit Change %", numeric: true }
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
  { key: "changePct", label: "Change %", numeric: true },
  { key: "unitChangePct", label: "Unit Change %", numeric: true }
];

const METRIC_BREAKDOWN_COLUMN_DEFS = [
  { key: "value", label: "Name" },
  { key: "netSales", label: "Net Sales", numeric: true },
  { key: "salesShare", label: "% Sales", numeric: true },
  { key: "netUnits", label: "Net Units", numeric: true },
  { key: "unitsShare", label: "% Units", numeric: true },
  { key: "orders", label: "Orders", numeric: true },
  { key: "compareSales", label: "Compare Sales", numeric: true },
  { key: "change", label: "Change", numeric: true },
  { key: "changePct", label: "Change %", numeric: true }
];

const STATUS_SPLIT_COLUMN_DEFS = [
  { key: "value", label: "Status" },
  { key: "netSales", label: "Net Sales", numeric: true },
  { key: "salesShare", label: "% Sales", numeric: true },
  { key: "netUnits", label: "Net Units", numeric: true },
  { key: "unitsShare", label: "% Units", numeric: true },
  { key: "orders", label: "Orders", numeric: true },
  { key: "compareSales", label: "Compare Sales", numeric: true },
  { key: "change", label: "Change", numeric: true },
  { key: "unitChange", label: "Units Change", numeric: true },
  { key: "unitChangePct", label: "Unit Change %", numeric: true },
  { key: "changePct", label: "Change %", numeric: true }
];

const COLUMN_DEFS_BY_TABLE = {
  status: STATUS_SPLIT_COLUMN_DEFS,
  pivot: PIVOT_COLUMN_DEFS,
  product: PRODUCT_COLUMN_DEFS
};

const DEFAULT_COLUMN_ORDERS = {
  status: STATUS_SPLIT_COLUMN_DEFS.map((column) => column.key),
  pivot: PIVOT_COLUMN_DEFS.map((column) => column.key),
  product: PRODUCT_COLUMN_DEFS.map((column) => column.key)
};

const state = {
  records: [],
  analysisRecords: [],
  files: [],
  rowKeys: new Set(),
  activeView: "performance",
  viewDirty: {
    performance: true,
    trade: true,
    compare: true,
    regional: true
  },
  renderContext: null,
  filters: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, new Set()])),
  filterExclusions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, new Set()])),
  filterAllSelected: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, false])),
  filterSearch: {},
  filterOpen: {},
  pivotNameSearch: "",
  pivotNameExclusions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, new Set()])),
  productSort: {
    key: "netSales",
    dir: "desc"
  },
  pivotRows: [],
  statusRows: [],
  statusTotals: null,
  productRows: [],
  regionalProductRows: [],
  regionalProductRegion: "all",
  regionalCurrentRecords: [],
  regionalComparisonRecords: [],
  regionalHasComparison: false,
  regionalBrandRows: [],
  regionalBrandTotals: null,
  regionalFranchiseRows: [],
  regionalFranchiseTotals: null,
  regionalBreakdownSort: {
    brand: {
      key: "netSales",
      dir: "desc"
    },
    franchise: {
      key: "netSales",
      dir: "desc"
    }
  },
  tradeBrandRows: [],
  tradeRegionalRows: [],
  tradePeriods: null,
  trendProductQuery: "",
  trendGrain: "week",
  trendMetric: "sales",
  trendShowCompare: true,
  trendSelection: {
    active: false,
    previousPeriods: null,
    label: ""
  },
  compareProductQuery: "",
  compareProducts: [],
  compareGrain: "week",
  compareMetric: "sales",
  compareShowCompare: true,
  compareShowAllRegions: true,
  compareRegions: new Set(),
  periods: {
    currentStart: "",
    currentEnd: "",
    compareStart: "",
    compareEnd: "",
    compareBasis: COMPARE_BASIS_DEFAULT
  },
  periodsDirty: false,
  columnOrders: {
    status: [],
    pivot: [],
    product: []
  },
  hiddenColumns: {
    status: new Set(),
    pivot: new Set(),
    product: new Set()
  },
  productPanelCollapsed: false,
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
let filterApplyTimer = null;
let filterOptionsRefreshTimer = null;
let columnDrag = null;
let clipTooltipTarget = null;
let clipTooltipFrame = null;
let activeTrendPoint = null;
let trendRangeDrag = null;
let suppressTrendPointClick = false;
let periodDateSeed = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  collectDom();
  initializeColumnOrders();
  initializeProductPanelState();
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
    compareBasis: document.querySelector("#compare-basis"),
    applyPeriods: document.querySelector("#apply-periods"),
    swapPeriods: document.querySelector("#swap-periods"),
    allDates: document.querySelector("#all-dates"),
    previousPeriod: document.querySelector("#previous-period"),
    refreshData: document.querySelector("#refresh-data"),
    dimensionSelect: document.querySelector("#dimension-select"),
    sortSelect: document.querySelector("#sort-select"),
    sortDir: document.querySelector("#sort-dir"),
    rowLimit: document.querySelector("#row-limit"),
    exportCsv: document.querySelector("#export-csv"),
    exportPivotTableCsv: document.querySelector("#export-pivot-table-csv"),
    exportProductCsv: document.querySelector("#export-product-csv"),
    exportRegionalCsv: document.querySelector("#export-regional-csv"),
    clearFilters: document.querySelector("#clear-filters"),
    expandFilters: document.querySelector("#expand-filters"),
    collapseFilters: document.querySelector("#collapse-filters"),
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
    trendHeading: document.querySelector("#trend-heading"),
    trendGrain: document.querySelector("#trend-grain"),
    trendMetric: document.querySelector("#trend-metric"),
    trendCompareToggle: document.querySelector("#trend-compare-toggle"),
    trendProductInput: document.querySelector("#trend-product-input"),
    trendProductOptions: document.querySelector("#trend-product-options"),
    clearTrendProduct: document.querySelector("#clear-trend-product"),
    clearTrendSelection: document.querySelector("#clear-trend-selection"),
    trendChart: document.querySelector("#trend-chart"),
    tradeWeekLabel: document.querySelector("#trade-week-label"),
    tradeAnalysis: document.querySelector("#trade-analysis"),
    tradeStatusSummary: document.querySelector("#trade-status-summary"),
    tradeGroupSummary: document.querySelector("#trade-group-summary"),
    tradeBrandTbody: document.querySelector("#trade-brand-tbody"),
    tradeRegionalSections: document.querySelector("#trade-regional-sections"),
    exportTradeBrandCsv: document.querySelector("#export-trade-brand-csv"),
    exportTradeRegionalCsv: document.querySelector("#export-trade-regional-csv"),
    compareGrain: document.querySelector("#compare-grain"),
    compareMetric: document.querySelector("#compare-metric"),
    compareCompareToggle: document.querySelector("#compare-compare-toggle"),
    compareProductInput: document.querySelector("#compare-product-input"),
    compareProductOptions: document.querySelector("#compare-product-options"),
    compareRegionAll: document.querySelector("#compare-region-all"),
    compareRegionOptions: document.querySelector("#compare-region-options"),
    compareRegionSummary: document.querySelector("#compare-region-summary"),
    addCompareProduct: document.querySelector("#add-compare-product"),
    clearCompareProducts: document.querySelector("#clear-compare-products"),
    compareSelection: document.querySelector("#compare-selection"),
    compareChart: document.querySelector("#compare-chart"),
    compareSummaryTbody: document.querySelector("#compare-summary-tbody"),
    fileTbody: document.querySelector("#file-tbody"),
    statusSplitThead: document.querySelector("#status-split-thead"),
    statusSplitTbody: document.querySelector("#status-split-tbody"),
    pivotHeading: document.querySelector("#pivot-heading"),
    pivotThead: document.querySelector("#pivot-thead"),
    pivotTbody: document.querySelector("#pivot-tbody"),
    pivotNameFilter: document.querySelector("#pivot-name-filter"),
    pivotNameFilterButton: document.querySelector("#pivot-name-filter-button"),
    pivotNameFilterLabel: document.querySelector("#pivot-name-filter-label"),
    pivotNameFilterMenu: document.querySelector("#pivot-name-filter-menu"),
    pivotNameFilterSearch: document.querySelector("#pivot-name-filter-search"),
    pivotNameFilterShowAll: document.querySelector("#pivot-name-filter-show-all"),
    pivotNameFilterHideVisible: document.querySelector("#pivot-name-filter-hide-visible"),
    pivotNameFilterOptions: document.querySelector("#pivot-name-filter-options"),
    pivotNameFilterSummary: document.querySelector("#pivot-name-filter-summary"),
    productHeading: document.querySelector("#product-heading"),
    productThead: document.querySelector("#product-thead"),
    productTbody: document.querySelector("#product-tbody"),
    productSide: document.querySelector(".product-side"),
    appShell: document.querySelector(".app-shell"),
    toggleProductResults: document.querySelector("#toggle-product-results"),
    showProductResults: document.querySelector("#show-product-results"),
    statusColumnList: document.querySelector("#status-column-list"),
    pivotColumnList: document.querySelector("#pivot-column-list"),
    productColumnList: document.querySelector("#product-column-list"),
    regionalProductRegion: document.querySelector("#regional-product-region"),
    regionalProductSort: document.querySelector("#regional-product-sort"),
    regionalProductsTbody: document.querySelector("#regional-products-tbody"),
    regionalBrandThead: document.querySelector("#regional-brand-thead"),
    regionalBrandTbody: document.querySelector("#regional-brand-tbody"),
    regionalFranchiseThead: document.querySelector("#regional-franchise-thead"),
    regionalFranchiseTbody: document.querySelector("#regional-franchise-tbody"),
    viewTabs: document.querySelector(".view-tabs")
  });
}

function bindEvents() {
  dom.refreshData?.addEventListener("click", () => refreshRepositoryData({ preserveDates: true, forceRefresh: true }));
  dom.applyPeriods?.addEventListener("click", applyPeriodInputs);
  dom.swapPeriods?.addEventListener("click", swapPeriodInputs);
  dom.allDates.addEventListener("click", setAllDates);
  dom.previousPeriod.addEventListener("click", () => setPreviousPeriod(false));
  dom.dimensionSelect.addEventListener("change", handlePivotDimensionChange);
  dom.sortSelect.addEventListener("change", renderAll);
  dom.sortDir.addEventListener("change", renderAll);
  dom.rowLimit.addEventListener("change", renderAll);
  dom.regionalProductRegion?.addEventListener("change", handleRegionalProductRegionChange);
  dom.regionalProductSort.addEventListener("change", handleRegionalProductSortChange);
  dom.exportCsv.addEventListener("click", exportPivotCsv);
  dom.exportPivotTableCsv.addEventListener("click", exportPivotCsv);
  dom.exportProductCsv.addEventListener("click", exportProductCsv);
  dom.exportRegionalCsv.addEventListener("click", exportRegionalTopProductsCsv);
  dom.toggleProductResults?.addEventListener("click", () => setProductPanelCollapsed(true));
  dom.showProductResults?.addEventListener("click", () => setProductPanelCollapsed(false));
  dom.clearFilters.addEventListener("click", clearAllFilters);
  dom.expandFilters?.addEventListener("click", () => setAllFilterGroupsOpen(true));
  dom.collapseFilters?.addEventListener("click", () => setAllFilterGroupsOpen(false));
  dom.trendGrain.addEventListener("change", handleTrendGrainChange);
  dom.trendMetric.addEventListener("change", handleTrendMetricChange);
  dom.trendCompareToggle?.addEventListener("change", handleTrendCompareToggleChange);
  dom.trendProductInput.addEventListener("input", handleTrendProductInput);
  dom.clearTrendProduct.addEventListener("click", clearTrendProduct);
  dom.clearTrendSelection?.addEventListener("click", resetTrendSelection);
  dom.exportTradeBrandCsv.addEventListener("click", exportTradeBrandCsv);
  dom.exportTradeRegionalCsv.addEventListener("click", exportTradeRegionalCsv);
  dom.compareGrain.addEventListener("change", handleCompareGrainChange);
  dom.compareMetric.addEventListener("change", handleCompareMetricChange);
  dom.compareCompareToggle?.addEventListener("change", handleCompareToggleChange);
  dom.compareProductInput.addEventListener("input", handleCompareProductInput);
  dom.compareProductInput.addEventListener("keydown", handleCompareProductKeydown);
  dom.compareRegionOptions?.addEventListener("change", handleCompareRegionChange);
  dom.addCompareProduct.addEventListener("click", addCompareProductFromInput);
  dom.clearCompareProducts.addEventListener("click", clearCompareProducts);
  dom.compareSelection.addEventListener("click", handleCompareSelectionClick);
  dom.pivotNameFilterButton?.addEventListener("click", togglePivotNameFilterMenu);
  dom.pivotNameFilterSearch?.addEventListener("input", handlePivotNameFilterSearch);
  dom.pivotNameFilterOptions?.addEventListener("change", handlePivotNameFilterChange);
  dom.pivotNameFilterShowAll?.addEventListener("click", showAllPivotNames);
  dom.pivotNameFilterHideVisible?.addEventListener("click", hideVisiblePivotNames);

  [dom.currentStart, dom.currentEnd, dom.compareStart, dom.compareEnd].forEach((input) => {
    input.addEventListener("pointerdown", handlePeriodDatePickerOpen);
    input.addEventListener("focus", handlePeriodDatePickerOpen);
    input.addEventListener("input", handlePeriodInputChange);
    input.addEventListener("change", handlePeriodInputChange);
    input.addEventListener("blur", restoreUncommittedPeriodDateSeed);
  });
  dom.compareBasis?.addEventListener("change", handlePeriodInputChange);

  dom.filters.addEventListener("input", handleFilterInput);
  dom.filters.addEventListener("change", handleFilterChange);
  dom.filters.addEventListener("click", handleFilterClick);
  dom.filters.addEventListener("toggle", handleFilterToggle, true);
  document.addEventListener("click", handleViewTabClick);
  document.addEventListener("click", handleSettingsTabClick);
  document.addEventListener("click", handleTableSortClick);
  document.addEventListener("click", handleColumnOrderClick);
  document.addEventListener("change", handleColumnVisibilityChange);
  document.addEventListener("click", handleCollapseToggle);
  document.addEventListener("click", handlePivotNameFilterOutsideClick);
  document.addEventListener("dragstart", handleColumnDragStart);
  document.addEventListener("dragover", handleColumnDragOver);
  document.addEventListener("drop", handleColumnDrop);
  document.addEventListener("dragend", handleColumnDragEnd);
  document.addEventListener("pointerdown", handleTrendRangePointerDown);
  document.addEventListener("pointermove", handleTrendRangePointerMove);
  document.addEventListener("pointerup", handleTrendRangePointerUp);
  document.addEventListener("pointercancel", cancelTrendRangeDrag);
  document.addEventListener("click", handleTrendPointClick);
  document.addEventListener("keydown", handleTrendPointKeydown);
  document.addEventListener("pointerover", handleTrendPointLayering);
  document.addEventListener("pointerout", handleTrendPointDeactivation);
  document.addEventListener("focusin", handleTrendPointLayering);
  document.addEventListener("focusout", handleTrendPointDeactivation);
  document.addEventListener("pointerover", handleClipTooltipPointerOver);
  document.addEventListener("pointerout", handleClipTooltipPointerOut);
  document.addEventListener("click", hideClipTooltip);
  document.addEventListener("scroll", hideClipTooltip, true);
  window.addEventListener("resize", hideClipTooltip);

}

function handleTrendPointLayering(event) {
  const pointGroup = event.target instanceof Element ? event.target.closest(".trend-point-group") : null;
  if (!pointGroup || !pointGroup.parentNode) return;
  activateTrendPoint(pointGroup);
  if (pointGroup.parentNode.lastElementChild !== pointGroup) {
    pointGroup.parentNode.appendChild(pointGroup);
  }
}

function handleTrendPointDeactivation(event) {
  const pointGroup = event.target instanceof Element ? event.target.closest(".trend-point-group") : null;
  if (!pointGroup) return;
  if (event.relatedTarget instanceof Node && pointGroup.contains(event.relatedTarget)) return;
  pointGroup.classList.remove("is-active");
  if (activeTrendPoint === pointGroup) activeTrendPoint = null;
}

function activateTrendPoint(pointGroup) {
  if (activeTrendPoint && activeTrendPoint !== pointGroup) {
    activeTrendPoint.classList.remove("is-active");
  }
  activeTrendPoint = pointGroup;
  pointGroup.classList.add("is-active");
}

function handleTrendPointClick(event) {
  if (suppressTrendPointClick) {
    suppressTrendPointClick = false;
    return;
  }
  const pointGroup = getTrendDrilldownPoint(event.target);
  if (!pointGroup) return;
  event.preventDefault();
  applyTrendPointPeriod(pointGroup);
}

function handleTrendPointKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const pointGroup = getTrendDrilldownPoint(event.target);
  if (!pointGroup) return;
  event.preventDefault();
  applyTrendPointPeriod(pointGroup);
}

function getTrendDrilldownPoint(target) {
  return target instanceof Element
    ? target.closest(".trend-point-group[data-period-start][data-period-end]")
    : null;
}

function applyTrendPointPeriod(pointGroup) {
  const start = pointGroup.dataset.periodStart || "";
  const end = pointGroup.dataset.periodEnd || start;
  if (!start || !end) return;

  applyTrendSelectionRange(start, end, pointGroup.dataset.periodLabel || `${start} to ${end}`);
}

function handleTrendRangePointerDown(event) {
  if (event.button !== 0) return;
  const svg = event.target instanceof Element
    ? event.target.closest(".trend-line-svg[data-trend-selectable='true']")
    : null;
  if (!svg) return;

  const index = getTrendIndexFromPointer(svg, event);
  if (!Number.isFinite(index)) return;

  trendRangeDrag = {
    svg,
    startIndex: index,
    currentIndex: index,
    startClientX: event.clientX,
    moved: false
  };
}

function handleTrendRangePointerMove(event) {
  if (!trendRangeDrag) return;
  const index = getTrendIndexFromPointer(trendRangeDrag.svg, event);
  if (!Number.isFinite(index)) return;
  const movedEnough = Math.abs(event.clientX - trendRangeDrag.startClientX) > 5 || index !== trendRangeDrag.startIndex;
  trendRangeDrag.currentIndex = index;
  trendRangeDrag.moved = trendRangeDrag.moved || movedEnough;
  if (!trendRangeDrag.moved) return;
  event.preventDefault();
  renderTrendRangeSelection(trendRangeDrag.svg, trendRangeDrag.startIndex, trendRangeDrag.currentIndex);
}

function handleTrendRangePointerUp(event) {
  if (!trendRangeDrag) return;
  const drag = trendRangeDrag;
  trendRangeDrag = null;
  clearTrendRangeSelection(drag.svg);

  if (!drag.moved) return;
  event.preventDefault();
  suppressTrendPointClick = true;
  window.setTimeout(() => {
    suppressTrendPointClick = false;
  }, 100);
  applyTrendIndexRange(drag.svg, drag.startIndex, drag.currentIndex);
}

function cancelTrendRangeDrag() {
  if (trendRangeDrag?.svg) clearTrendRangeSelection(trendRangeDrag.svg);
  trendRangeDrag = null;
}

function getTrendIndexFromPointer(svg, event) {
  const count = Number(svg.dataset.trendPointCount) || 0;
  if (!count) return NaN;
  const rect = svg.getBoundingClientRect();
  const viewWidth = Number(svg.viewBox.baseVal.width) || rect.width;
  const x = (event.clientX - rect.left) / rect.width * viewWidth;
  const left = Number(svg.dataset.plotLeft) || 0;
  const right = Number(svg.dataset.plotRight) || viewWidth;
  const clampedX = Math.min(Math.max(x, left), right);
  if (count === 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((clampedX - left) / (right - left) * (count - 1))));
}

function trendIndexToX(svg, index) {
  const count = Number(svg.dataset.trendPointCount) || 0;
  const left = Number(svg.dataset.plotLeft) || 0;
  const right = Number(svg.dataset.plotRight) || left;
  if (count <= 1) return left + (right - left) / 2;
  return left + (index / (count - 1)) * (right - left);
}

function renderTrendRangeSelection(svg, startIndex, endIndex) {
  const overlay = svg.querySelector(".trend-range-selection");
  if (!overlay) return;
  const minIndex = Math.min(startIndex, endIndex);
  const maxIndex = Math.max(startIndex, endIndex);
  const x1 = trendIndexToX(svg, minIndex);
  const x2 = trendIndexToX(svg, maxIndex);
  const pointPadding = Math.max(10, (Number(svg.dataset.plotRight) - Number(svg.dataset.plotLeft)) / Math.max(1, (Number(svg.dataset.trendPointCount) || 1) - 1) / 2);
  const left = Number(svg.dataset.plotLeft) || 0;
  const right = Number(svg.dataset.plotRight) || x2;
  const x = Math.max(left, Math.min(x1, x2) - pointPadding);
  const width = Math.min(right, Math.max(x1, x2) + pointPadding) - x;
  overlay.setAttribute("x", x.toFixed(2));
  overlay.setAttribute("width", Math.max(2, width).toFixed(2));
  overlay.removeAttribute("hidden");
}

function clearTrendRangeSelection(svg) {
  svg?.querySelector(".trend-range-selection")?.setAttribute("hidden", "");
}

function applyTrendIndexRange(svg, startIndex, endIndex) {
  const minIndex = Math.min(startIndex, endIndex);
  const maxIndex = Math.max(startIndex, endIndex);
  const groups = Array.from(svg.querySelectorAll(".trend-point-group[data-period-role='current'][data-trend-index]"));
  const byIndex = new Map(groups.map((group) => [Number(group.dataset.trendIndex), group]));
  const first = byIndex.get(minIndex);
  const last = byIndex.get(maxIndex);
  if (!first || !last) return;

  const start = first.dataset.periodStart || "";
  const end = last.dataset.periodEnd || start;
  if (!start || !end) return;

  const firstLabel = first.dataset.periodLabel || start;
  const lastLabel = last.dataset.periodLabel || end;
  const label = minIndex === maxIndex ? firstLabel : `${firstLabel} to ${lastLabel}`;
  applyTrendSelectionRange(start, end, label);
}

function applyTrendSelectionRange(start, end, label) {
  rememberTrendSelectionBase();
  dom.currentStart.value = start;
  dom.currentEnd.value = end;
  state.dateTouched = true;
  setPreviousPeriod(false, { preserveTrendSelection: true });
  syncAppliedPeriodsFromInputs();
  state.trendSelection.active = true;
  state.trendSelection.label = label;
  updateTrendSelectionButton();
  renderAll();
  setStatus(`Applied ${label} to the dashboard. Use Reset Selection to return to the previous period.`);
}

function rememberTrendSelectionBase() {
  if (state.trendSelection.active && state.trendSelection.previousPeriods) return;
  state.trendSelection.previousPeriods = { ...getAppliedPeriods() };
}

function resetTrendSelection() {
  const previous = state.trendSelection.previousPeriods;
  if (!previous) return;
  dom.currentStart.value = previous.currentStart;
  dom.currentEnd.value = previous.currentEnd;
  dom.compareStart.value = previous.compareStart;
  dom.compareEnd.value = previous.compareEnd;
  if (dom.compareBasis) dom.compareBasis.value = previous.compareBasis || COMPARE_BASIS_DEFAULT;
  clearTrendSelectionState();
  syncAppliedPeriodsFromInputs();
  renderAll();
  setStatus("Trend selection cleared. Previous period restored.");
}

function clearTrendSelectionState() {
  state.trendSelection.active = false;
  state.trendSelection.previousPeriods = null;
  state.trendSelection.label = "";
  updateTrendSelectionButton();
}

function updateTrendSelectionButton() {
  if (!dom.clearTrendSelection) return;
  dom.clearTrendSelection.disabled = !state.trendSelection.active;
  dom.clearTrendSelection.classList.toggle("primary", state.trendSelection.active);
}

function handleClipTooltipPointerOver(event) {
  const target = getClipTooltipTarget(event.target);
  if (!target || target === clipTooltipTarget || !shouldShowClipTooltip(target)) return;
  showClipTooltip(target);
}

function handleClipTooltipPointerOut(event) {
  if (!clipTooltipTarget) return;
  if (event.relatedTarget instanceof Node && clipTooltipTarget.contains(event.relatedTarget)) return;

  const target = getClipTooltipTarget(event.target);
  if (!target || target === clipTooltipTarget) hideClipTooltip();
}

function getClipTooltipTarget(target) {
  return target instanceof Element ? target.closest("[data-clip-tooltip]") : null;
}

function shouldShowClipTooltip(target) {
  const text = cleanText(target.dataset.clipTooltip);
  if (!text) return false;
  return target.scrollWidth > target.clientWidth + 1 || target.scrollHeight > target.clientHeight + 1;
}

function showClipTooltip(target) {
  const tooltip = ensureClipTooltip();
  const text = cleanText(target.dataset.clipTooltip);
  if (!text) return;

  if (clipTooltipFrame) cancelAnimationFrame(clipTooltipFrame);
  clipTooltipTarget?.classList.remove("is-tooltip-source");
  clipTooltipTarget = target;
  clipTooltipTarget.classList.add("is-tooltip-source");

  tooltip.classList.remove("visible");
  tooltip.setAttribute("aria-hidden", "false");
  tooltip.textContent = text;
  tooltip.style.left = "-9999px";
  tooltip.style.top = "-9999px";

  clipTooltipFrame = requestAnimationFrame(() => {
    if (clipTooltipTarget !== target) return;
    positionClipTooltip(target, tooltip);
    tooltip.classList.add("visible");
    clipTooltipFrame = null;
  });
}

function hideClipTooltip() {
  if (clipTooltipFrame) {
    cancelAnimationFrame(clipTooltipFrame);
    clipTooltipFrame = null;
  }

  clipTooltipTarget?.classList.remove("is-tooltip-source");
  clipTooltipTarget = null;

  if (!dom.clipTooltip) return;
  dom.clipTooltip.classList.remove("visible");
  dom.clipTooltip.setAttribute("aria-hidden", "true");
}

function ensureClipTooltip() {
  if (!dom.clipTooltip) {
    dom.clipTooltip = document.createElement("div");
    dom.clipTooltip.className = "clip-tooltip";
    dom.clipTooltip.setAttribute("role", "tooltip");
    dom.clipTooltip.setAttribute("aria-hidden", "true");
    document.body.appendChild(dom.clipTooltip);
  }
  return dom.clipTooltip;
}

function positionClipTooltip(target, tooltip) {
  const margin = 12;
  const gap = 8;
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const maxLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
  let left = targetRect.left + Math.min(12, targetRect.width / 2);
  if (targetRect.width < tooltipRect.width) left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
  left = Math.min(Math.max(margin, left), maxLeft);

  let top = targetRect.bottom + gap;
  if (top + tooltipRect.height > viewportHeight - margin) {
    top = targetRect.top - tooltipRect.height - gap;
  }
  if (top < margin) {
    top = Math.min(viewportHeight - tooltipRect.height - margin, targetRect.bottom + gap);
  }
  top = Math.max(margin, top);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function handleViewTabClick(event) {
  const button = event.target.closest("[data-view-tab]");
  if (!button) return;

  const view = button.dataset.viewTab;
  state.activeView = view;
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
  renderDirtyActiveView();
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
    return;
  }

  if (table === "regional-brand" || table === "regional-franchise") {
    updateRegionalBreakdownSort(table, key);
    renderRegionalBreakdownTables();
  }
}

function updateRegionalBreakdownSort(table, key) {
  const sort = getRegionalBreakdownSortState(table);
  if (!sort) return;

  if (sort.key === key) {
    sort.dir = sort.dir === "desc" ? "asc" : "desc";
  } else {
    sort.key = key;
    sort.dir = key === "value" ? "asc" : "desc";
  }
}

function getRegionalBreakdownSortState(table) {
  if (table === "regional-brand") return state.regionalBreakdownSort.brand;
  if (table === "regional-franchise") return state.regionalBreakdownSort.franchise;
  return null;
}

function handleCollapseToggle(event) {
  const button = event.target.closest("[data-collapse-target]");
  if (!button) return;

  const target = document.getElementById(button.dataset.collapseTarget);
  if (!target) return;

  const isExpanded = target.hidden;
  target.hidden = !isExpanded;
  button.setAttribute("aria-expanded", String(isExpanded));
  button.textContent = isExpanded ? "Collapse" : "Expand";
}

function handlePivotDimensionChange() {
  closePivotNameFilterMenu();
  state.pivotNameSearch = "";
  if (dom.pivotNameFilterSearch) dom.pivotNameFilterSearch.value = "";
  renderAll();
}

function togglePivotNameFilterMenu() {
  if (!dom.pivotNameFilterMenu) return;
  const shouldOpen = dom.pivotNameFilterMenu.hidden;
  dom.pivotNameFilterMenu.hidden = !shouldOpen;
  dom.pivotNameFilterButton?.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    renderPivotNameFilter();
    dom.pivotNameFilterSearch?.focus();
  }
}

function closePivotNameFilterMenu() {
  if (!dom.pivotNameFilterMenu) return;
  dom.pivotNameFilterMenu.hidden = true;
  dom.pivotNameFilterButton?.setAttribute("aria-expanded", "false");
}

function handlePivotNameFilterOutsideClick(event) {
  if (!dom.pivotNameFilter || dom.pivotNameFilter.contains(event.target)) return;
  closePivotNameFilterMenu();
}

function handlePivotNameFilterSearch() {
  state.pivotNameSearch = dom.pivotNameFilterSearch?.value || "";
  renderPivotNameFilter();
}

function handlePivotNameFilterChange(event) {
  const checkbox = event.target.closest("[data-pivot-name-option]");
  if (!checkbox) return;

  const exclusions = getActivePivotNameExclusions();
  if (checkbox.checked) {
    exclusions.delete(checkbox.value);
  } else {
    exclusions.add(checkbox.value);
  }
  renderPivotOutputs();
}

function showAllPivotNames() {
  getActivePivotNameExclusions().clear();
  renderPivotOutputs();
}

function hideVisiblePivotNames() {
  const exclusions = getActivePivotNameExclusions();
  getSearchedPivotNameValues().forEach((value) => exclusions.add(value));
  renderPivotOutputs();
}

function handleColumnOrderClick(event) {
  const resetButton = event.target.closest("[data-column-reset]");
  if (resetButton) {
    resetColumnOrder(resetButton.dataset.columnReset);
  }
}

function handleColumnVisibilityChange(event) {
  const checkbox = event.target.closest("[data-column-visible]");
  if (!checkbox) return;
  const table = checkbox.dataset.columnTable;
  const key = checkbox.dataset.columnVisible;
  setColumnVisible(table, key, checkbox.checked);
}

function handleColumnDragStart(event) {
  if (event.target instanceof Element && event.target.closest(".column-visible-toggle")) {
    event.preventDefault();
    return;
  }
  const row = event.target.closest(".column-order-row");
  if (!row) return;

  columnDrag = {
    table: row.dataset.columnTable,
    key: row.dataset.columnKey
  };
  row.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${columnDrag.table}:${columnDrag.key}`);
  }
}

function handleColumnDragOver(event) {
  if (!columnDrag) return;
  const row = event.target.closest(".column-order-row");
  const list = event.target.closest(".column-order-list");
  if (!list || list.dataset.columnTable !== columnDrag.table) return;

  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  clearColumnDropTargets();

  if (!row || row.dataset.columnKey === columnDrag.key) return;
  const position = getColumnDropPosition(row, event);
  row.classList.add(position === "after" ? "drag-over-after" : "drag-over-before");
}

function handleColumnDrop(event) {
  if (!columnDrag) return;
  const row = event.target.closest(".column-order-row");
  const list = event.target.closest(".column-order-list");
  if (!list || list.dataset.columnTable !== columnDrag.table) return;

  event.preventDefault();
  const position = row ? getColumnDropPosition(row, event) : "after";
  reorderColumn(columnDrag.table, columnDrag.key, row?.dataset.columnKey || "", position);
  clearColumnDragState();
}

function handleColumnDragEnd() {
  clearColumnDragState();
}

function getColumnDropPosition(row, event) {
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function clearColumnDropTargets() {
  document.querySelectorAll(".column-order-row.drag-over-before, .column-order-row.drag-over-after").forEach((row) => {
    row.classList.remove("drag-over-before", "drag-over-after");
  });
}

function clearColumnDragState() {
  clearColumnDropTargets();
  document.querySelectorAll(".column-order-row.dragging").forEach((row) => row.classList.remove("dragging"));
  columnDrag = null;
}

function initializeProductPanelState() {
  state.productPanelCollapsed = localStorage.getItem(PRODUCT_PANEL_COLLAPSED_STORAGE_KEY) === "true";
  applyProductPanelState();
}

function setProductPanelCollapsed(collapsed) {
  state.productPanelCollapsed = Boolean(collapsed);
  try {
    localStorage.setItem(PRODUCT_PANEL_COLLAPSED_STORAGE_KEY, String(state.productPanelCollapsed));
  } catch (error) {
    console.warn("Could not save product panel state.", error);
  }
  applyProductPanelState();
}

function applyProductPanelState() {
  const collapsed = Boolean(state.productPanelCollapsed);
  dom.appShell?.classList.toggle("product-results-collapsed", collapsed);
  dom.productSide?.classList.toggle("is-collapsed", collapsed);
  dom.toggleProductResults?.setAttribute("aria-expanded", String(!collapsed));
  if (dom.toggleProductResults) dom.toggleProductResults.textContent = collapsed ? "Show" : "Collapse";
  if (dom.showProductResults) dom.showProductResults.hidden = !collapsed;
}

function updateSortHeaderStates() {
  document.querySelectorAll("[data-table-sort]").forEach((button) => {
    const table = button.dataset.tableSort;
    const key = button.dataset.sortKey;
    const sort = getTableSortState(table);
    const isActive = sort?.key === key;
    const direction = sort?.dir || "desc";

    button.classList.toggle("active", isActive);
    button.setAttribute("aria-sort", isActive ? (direction === "asc" ? "ascending" : "descending") : "none");
    if (isActive) {
      button.dataset.sortDir = direction;
    } else {
      delete button.dataset.sortDir;
    }
  });
}

function getTableSortState(table) {
  if (table === "pivot") {
    return {
      key: dom.sortSelect?.value || "netSales",
      dir: dom.sortDir?.value || "desc"
    };
  }
  if (table === "product") return state.productSort;
  if (table === "regional-brand" || table === "regional-franchise") return getRegionalBreakdownSortState(table);
  return null;
}

function populateDimensionSelect() {
  dom.dimensionSelect.innerHTML = DIMENSIONS
    .map((dimension) => `<option value="${dimension.key}">${escapeHtml(dimension.label)}</option>`)
    .join("");
}

function initializeColumnOrders() {
  state.columnOrders.status = loadColumnOrder("status");
  state.columnOrders.pivot = loadColumnOrder("pivot");
  state.columnOrders.product = loadColumnOrder("product");
  state.hiddenColumns.status = loadHiddenColumns("status");
  state.hiddenColumns.pivot = loadHiddenColumns("pivot");
  state.hiddenColumns.product = loadHiddenColumns("product");
  migrateColumnSettings();
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

function loadHiddenColumns(table) {
  const defaults = DEFAULT_COLUMN_ORDERS[table] || [];
  const validKeys = new Set(defaults);
  try {
    const stored = JSON.parse(localStorage.getItem(hiddenColumnsStorageKey(table)) || "[]");
    if (Array.isArray(stored)) {
      return normalizeHiddenColumns(table, new Set(stored.filter((key) => validKeys.has(key))));
    }
  } catch (error) {
    console.warn(`Could not load ${table} hidden columns.`, error);
  }
  return new Set();
}

function saveHiddenColumns(table) {
  try {
    localStorage.setItem(hiddenColumnsStorageKey(table), JSON.stringify(Array.from(state.hiddenColumns[table] || [])));
  } catch (error) {
    console.warn(`Could not save ${table} hidden columns.`, error);
  }
}

function hiddenColumnsStorageKey(table) {
  return `product-dashboard:${table}-hidden-columns`;
}

function normalizeHiddenColumns(table, hidden) {
  const defaults = DEFAULT_COLUMN_ORDERS[table] || [];
  const validKeys = new Set(defaults);
  const normalized = new Set(Array.from(hidden || []).filter((key) => validKeys.has(key)));
  if (normalized.size >= defaults.length) return new Set();
  return normalized;
}

function migrateColumnSettings() {
  let version = 0;
  try {
    version = Number(localStorage.getItem(COLUMN_SETTINGS_VERSION_STORAGE_KEY) || 0);
  } catch (error) {
    console.warn("Could not read column settings version.", error);
  }

  if (version >= COLUMN_SETTINGS_VERSION) return;

  Object.entries(COLUMN_SETTINGS_MIGRATION_VISIBLE_KEYS).forEach(([table, keys]) => {
    const hidden = state.hiddenColumns[table] || new Set();
    keys.forEach((key) => hidden.delete(key));
    state.hiddenColumns[table] = normalizeHiddenColumns(table, hidden);
    state.columnOrders[table] = normalizeColumnOrder(table, state.columnOrders[table] || []);
    saveHiddenColumns(table);
    saveColumnOrder(table);
  });

  try {
    localStorage.setItem(COLUMN_SETTINGS_VERSION_STORAGE_KEY, String(COLUMN_SETTINGS_VERSION));
  } catch (error) {
    console.warn("Could not save column settings version.", error);
  }
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
  const hidden = normalizeHiddenColumns(table, state.hiddenColumns[table] || new Set());
  state.hiddenColumns[table] = hidden;
  const columns = order.map((key) => byKey.get(key)).filter((column) => column && !hidden.has(column.key));
  if (!columns.length && defs.length) {
    state.hiddenColumns[table] = new Set();
    saveHiddenColumns(table);
    return order.map((key) => byKey.get(key)).filter(Boolean);
  }
  return columns;
}

function getOrderedColumnDefs(table) {
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
  renderColumnsChangedTable(table);
}

function reorderColumn(table, sourceKey, targetKey, position) {
  const order = normalizeColumnOrder(table, state.columnOrders[table] || []);
  const sourceIndex = order.indexOf(sourceKey);
  if (sourceIndex < 0 || (targetKey && sourceKey === targetKey)) return;

  order.splice(sourceIndex, 1);
  let targetIndex = targetKey ? order.indexOf(targetKey) : order.length;
  if (targetIndex < 0) targetIndex = order.length;
  if (position === "after") targetIndex += 1;

  order.splice(targetIndex, 0, sourceKey);
  state.columnOrders[table] = order;
  saveColumnOrder(table);
  renderColumnSettings();
  renderColumnsChangedTable(table);
}

function resetColumnOrder(table) {
  if (!DEFAULT_COLUMN_ORDERS[table]) return;
  state.columnOrders[table] = [...DEFAULT_COLUMN_ORDERS[table]];
  state.hiddenColumns[table] = new Set();
  saveColumnOrder(table);
  saveHiddenColumns(table);
  renderColumnSettings();
  renderColumnsChangedTable(table);
}

function setColumnVisible(table, key, visible) {
  if (!DEFAULT_COLUMN_ORDERS[table]?.includes(key)) return;
  if (!state.hiddenColumns[table]) state.hiddenColumns[table] = new Set();

  if (visible) {
    state.hiddenColumns[table].delete(key);
  } else {
    const visibleCount = DEFAULT_COLUMN_ORDERS[table].filter((columnKey) => !state.hiddenColumns[table].has(columnKey)).length;
    if (visibleCount <= 1) {
      renderColumnSettings();
      setStatus("At least one column must stay visible.", "error");
      return;
    }
    state.hiddenColumns[table].add(key);
  }

  state.hiddenColumns[table] = normalizeHiddenColumns(table, state.hiddenColumns[table]);
  saveHiddenColumns(table);
  renderColumnSettings();
  renderColumnsChangedTable(table);
}

function renderColumnSettings() {
  renderColumnOrderList("status", dom.statusColumnList);
  renderColumnOrderList("pivot", dom.pivotColumnList);
  renderColumnOrderList("product", dom.productColumnList);
}

function renderColumnsChangedTable(table) {
  if (table === "status") {
    renderStatusSplitTable(state.statusRows, state.statusTotals);
    return;
  }
  if (table === "pivot") {
    renderPivotOutputs();
    return;
  }
  if (table === "product") {
    renderProductTable(state.productRows);
  }
}

function renderColumnOrderList(table, target) {
  if (!target) return;
  const columns = getOrderedColumnDefs(table);
  const hidden = state.hiddenColumns[table] || new Set();
  target.dataset.columnTable = table;
  target.innerHTML = columns.map((column, index) => `
    <div class="column-order-row ${hidden.has(column.key) ? "is-hidden-column" : ""}" draggable="true" data-column-table="${table}" data-column-key="${column.key}" style="--column-index:${index}">
      <span class="column-drag-handle" aria-hidden="true"></span>
      <span class="column-order-name">${escapeHtml(column.label)}</span>
      <label class="column-visible-toggle">
        <input type="checkbox" data-column-table="${table}" data-column-visible="${column.key}" ${hidden.has(column.key) ? "" : "checked"}>
        <span>Show</span>
      </label>
    </div>
  `).join("");
}

async function refreshRepositoryData({ preserveDates, forceRefresh } = { preserveDates: true, forceRefresh: false }) {
  if (state.loading) return;
  state.loading = true;
  setStatus("Loading repository data...", "busy");

  try {
    await loadRepositoryData({ forceRefresh });
    const shouldApplyDateDefaults = !preserveDates || !state.dateTouched;
    ensureDateDefaults(shouldApplyDateDefaults);
    if (shouldApplyDateDefaults || !state.periodsDirty || (!state.periods.currentStart && !state.periods.currentEnd)) {
      syncAppliedPeriodsFromInputs();
    } else {
      updateApplyPeriodsButton();
    }
    renderAll();

    if (!state.files.length) {
      setStatus("Ready. Add CSV files to data/manifest.json to populate the shared dashboard.");
    } else {
      const excludedRows = state.records.length - getAnalysisRecords().length;
      const excludedText = excludedRows
        ? ` ${numberFormat.format(excludedRows)} refund adjustment row${excludedRows === 1 ? "" : "s"} excluded from analysis.`
        : "";
      setStatus(`Ready. Loaded ${numberFormat.format(state.records.length)} shared rows from ${numberFormat.format(state.files.length)} repository file${state.files.length === 1 ? "" : "s"}.${excludedText}`);
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
  const compiled = await readCompiledRepositoryData(files);
  if (compiled?.records) {
    applyCompiledRepositoryData(compiled);
    return;
  }

  const compiledFilesByPath = getCompiledFileMap(compiled);
  const records = [];
  const fileMetas = [];
  const cacheKeys = [];

  for (const file of files) {
    const sourceHash = `repo:${file.path}`;
    let addedRecords = null;
    let fileMeta = null;
    const compiledFile = getMatchingCompiledFile(compiledFilesByPath, file);

    if (compiledFile) {
      try {
        setStatus(`Using compiled data for ${file.name}...`, "busy");
        const compiledRecords = await loadCompiledDataFile(compiledFile, { forceRefresh, cacheKeys });
        addedRecords = compiledRecords.map(hydrateRecord);
        fileMeta = buildRepositoryFileMeta(file, compiledFile, addedRecords, "Compiled data");
      } catch (error) {
        console.warn(`Could not load compiled data for ${file.path}. Falling back to CSV.`, error);
        addedRecords = null;
        fileMeta = null;
      }
    }

    if (!addedRecords) {
      const parsed = await loadParsedRepositoryFile(file, sourceHash, forceRefresh, cacheKeys);
      addedRecords = parsed.records.map(hydrateRecord);
      fileMeta = buildRepositoryFileMeta(file, {
        hash: sourceHash,
        rowsRead: parsed.records.length,
        rowsAdded: addedRecords.length,
        rowsSkipped: 0,
        minDate: parsed.minDate,
        maxDate: parsed.maxDate
      }, addedRecords, "Repository");
    }

    appendItems(records, addedRecords);
    fileMetas.push(fileMeta);
  }

  state.records = records;
  state.analysisRecords = filterAnalysisRecords(records);
  state.files = fileMetas;
  state.rowKeys = buildRowKeySet(records);
  pruneParsedFileCache(cacheKeys);
}

async function loadParsedRepositoryFile(file, sourceHash, forceRefresh, cacheKeys) {
  setStatus(`Checking ${file.name}...`, "busy");
  const signature = await getRepositoryFileSignature(file);
  const cacheKey = signature ? getParsedFileCacheKey(file, signature) : "";
  if (cacheKey) cacheKeys.push(cacheKey);

  const cached = cacheKey && !forceRefresh ? await readCachedParsedFile(cacheKey) : null;
  if (cached) {
    setStatus(`Using cached data for ${file.name}...`, "busy");
    await pause();
    return cached;
  }

  setStatus(`Loading ${file.name}...`, "busy");
  const response = await fetch(withCacheBust(file.path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${file.path} (${response.status}). Check data/manifest.json and the file path.`);
  }

  const buffer = await response.arrayBuffer();
  const parsed = await parseRepositoryFile(buffer, file, response, sourceHash, (message) => setStatus(message, "busy"));
  if (cacheKey) await writeCachedParsedFile(cacheKey, parsed);
  return parsed;
}

function buildRepositoryFileMeta(file, sourceMeta, records, source) {
  const dateSummary = summarizeRecordDates(records);
  return {
    hash: sourceMeta?.hash || `repo:${file.path}`,
    name: file.name,
    path: file.path,
    version: file.version || sourceMeta?.version || "",
    source,
    rowsRead: Number(sourceMeta?.rowsRead ?? sourceMeta?.rowsAdded ?? records.length) || records.length,
    rowsAdded: records.length,
    rowsSkipped: Number(sourceMeta?.rowsSkipped || 0),
    minDate: sourceMeta?.minDate || dateSummary.min,
    maxDate: sourceMeta?.maxDate || dateSummary.max,
    netSales: sum(records, "netSales"),
    netUnits: sum(records, "netUnits")
  };
}

function summarizeRecordDates(records) {
  let min = "";
  let max = "";
  records.forEach((record) => {
    if (!record.dateKey) return;
    if (!min || record.dateKey < min) min = record.dateKey;
    if (!max || record.dateKey > max) max = record.dateKey;
  });
  return { min, max };
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

async function readCompiledRepositoryData(files) {
  try {
    const response = await fetch(withCacheBust(COMPILED_DATA_URL), { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) {
      console.warn(`Could not load ${COMPILED_DATA_URL} (${response.status}). Falling back to CSV parsing.`);
      return null;
    }

    const compiled = await response.json();
    const expectedSignature = getManifestSignature(files);
    if (compiled.schemaVersion !== COMPILED_DATA_SCHEMA_VERSION) {
      console.warn("Compiled data schema is outdated. Falling back to CSV parsing.");
      return null;
    }

    const signaturesMatch = compiled.manifestSignature === expectedSignature;
    if (hasPerFileCompiledData(compiled)) {
      if (!signaturesMatch) {
        console.warn("Compiled data does not fully match data/manifest.json. Using matching compiled files and CSV fallback.");
      }
      return {
        ...compiled,
        records: null,
        partial: !signaturesMatch
      };
    }

    if (!signaturesMatch) {
      console.warn("Compiled data does not match data/manifest.json. Falling back to CSV parsing.");
      return null;
    }

    if (Array.isArray(compiled.chunks) && compiled.chunks.length) {
      compiled.records = await loadCompiledDataChunks(compiled.chunks);
    }
    if (!Array.isArray(compiled.records)) {
      console.warn("Compiled data has no records array or chunks. Falling back to CSV parsing.");
      return null;
    }
    return compiled;
  } catch (error) {
    console.warn("Could not read compiled data. Falling back to CSV parsing.", error);
    return null;
  }
}

function hasPerFileCompiledData(compiled) {
  return Array.isArray(compiled?.files) && compiled.files.some((file) => cleanText(file?.compiledPath));
}

function getCompiledFileMap(compiled) {
  const map = new Map();
  if (!hasPerFileCompiledData(compiled)) return map;
  compiled.files.forEach((file) => {
    const filePath = cleanText(file?.path);
    const compiledPath = cleanText(file?.compiledPath);
    if (filePath && compiledPath) map.set(filePath, file);
  });
  return map;
}

function getMatchingCompiledFile(compiledFilesByPath, file) {
  const compiledFile = compiledFilesByPath.get(file.path);
  if (!compiledFile) return null;

  const manifestVersion = cleanText(file.version);
  const compiledVersion = cleanText(compiledFile.version);
  if (manifestVersion && manifestVersion !== compiledVersion) return null;

  return compiledFile;
}

async function loadCompiledDataFiles(files) {
  const records = [];
  for (const file of files) {
    const expandedRecords = await loadCompiledDataFile(file);
    appendItems(records, expandedRecords);
    await pause();
  }
  return records;
}

async function loadCompiledDataFile(file, options = {}) {
  const compiledPath = cleanText(file?.compiledPath);
  if (!compiledPath) return [];
  const cacheKey = getCompiledFileCacheKey(file);
  if (cacheKey && Array.isArray(options.cacheKeys)) options.cacheKeys.push(cacheKey);

  const cached = cacheKey && !options.forceRefresh ? await readCachedCompiledFile(cacheKey) : null;
  if (cached) {
    setStatus(`Using cached compiled data for ${file.name || file.path || "file"}...`, "busy");
    await pause();
    return cached;
  }

  setStatus(`Loading compiled data for ${file.name || file.path || "file"}...`, "busy");
  const response = await fetch(withCacheBust(compiledPath), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load compiled data file ${compiledPath} (${response.status}).`);
  }

  const payload = await response.json();
  const fields = Array.isArray(payload.fields) && payload.fields.length ? payload.fields : COMPILED_RECORD_FIELDS;
  if (!Array.isArray(payload.records)) {
    throw new Error(`Compiled data file ${compiledPath} has no records array.`);
  }
  const records = payload.records.map((entry) => expandCompiledRecord(entry, fields, payload));
  if (cacheKey) await writeCachedCompiledFile(cacheKey, records);
  return records;
}

function getCompiledFileCacheKey(file) {
  const compiledPath = cleanText(file?.compiledPath);
  if (!compiledPath) return "";
  const signature = cleanText(file?.contentHash || file?.sourceContentHash || file?.version || [
    file?.rowsAdded ?? "",
    file?.minDate ?? "",
    file?.maxDate ?? "",
    file?.netSales ?? "",
    file?.netUnits ?? ""
  ].join("|"));
  if (!signature) return "";
  return [COMPILED_DATA_CACHE_VERSION, compiledPath, signature].join("||");
}

async function loadCompiledDataChunks(chunks) {
  const records = [];
  for (const chunk of chunks) {
    const chunkPath = cleanText(chunk?.path);
    if (!chunkPath) continue;
    setStatus(`Loading compiled data chunk ${records.length ? numberFormat.format(records.length) : "0"} rows...`, "busy");
    const response = await fetch(withCacheBust(chunkPath), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load compiled data chunk ${chunkPath} (${response.status}).`);
    }
    const payload = await response.json();
    const chunkRecords = Array.isArray(payload) ? payload : payload.records;
    if (!Array.isArray(chunkRecords)) {
      throw new Error(`Compiled data chunk ${chunkPath} has no records array.`);
    }
    appendItems(records, chunkRecords);
    await pause();
  }
  return records;
}

function applyCompiledRepositoryData(compiled) {
  setStatus("Using compiled shared data...", "busy");
  const fields = Array.isArray(compiled.fields) && compiled.fields.length ? compiled.fields : COMPILED_RECORD_FIELDS;
  const records = compiled.records.map((entry) => hydrateRecord(expandCompiledRecord(entry, fields, compiled)));
  state.records = records;
  state.analysisRecords = filterAnalysisRecords(records);
  state.files = Array.isArray(compiled.files)
    ? compiled.files.map((file) => ({
      ...file,
      source: file.source || "Compiled data"
    }))
    : [];
  state.rowKeys = buildRowKeySet(records);
}

function expandCompiledRecord(entry, fields, compiled = null) {
  if (!Array.isArray(entry)) return entry || {};
  const dictionary = Array.isArray(compiled?.dictionary) ? compiled.dictionary : null;
  const numericFields = new Set(compiled?.numericFields || []);
  const rawFields = new Set(compiled?.rawFields || []);
  const record = {};
  fields.forEach((field, index) => {
    const value = entry[index];
    record[field] = dictionary && !numericFields.has(field) && !rawFields.has(field) ? dictionary[value] ?? "" : value;
  });
  return record;
}

function getManifestSignature(files) {
  return JSON.stringify(files.map((file) => ({
    path: file.path,
    name: file.name,
    version: file.version || ""
  })));
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

async function readCachedCompiledFile(key) {
  try {
    const db = await getParsedCacheDb();
    if (!db) return null;
    const entry = await idbRequest(db.transaction(DATA_CACHE_STORE, "readonly").objectStore(DATA_CACHE_STORE).get(key));
    return Array.isArray(entry?.records) ? entry.records : null;
  } catch (error) {
    console.warn("Could not read compiled data cache.", error);
    return null;
  }
}

async function writeCachedCompiledFile(key, records) {
  try {
    const db = await getParsedCacheDb();
    if (!db) return;
    const transaction = db.transaction(DATA_CACHE_STORE, "readwrite");
    transaction.objectStore(DATA_CACHE_STORE).put({
      key,
      records,
      savedAt: new Date().toISOString()
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("Could not write compiled data cache.", error);
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
    franchise: getFranchiseValue(cells, fieldIndex),
    orderId: cleanText(cells[fieldIndex.orderId]),
    dateTime: dateInfo.dateTime,
    dateKey: dateInfo.dateKey,
    compareAtPrice: fieldIndex.compareAtPrice === undefined ? null : toNumber(cells[fieldIndex.compareAtPrice]),
    netSales: toNumber(cells[fieldIndex.netSales]),
    netUnits: toNumber(cells[fieldIndex.netUnits]),
    isReturn: fieldIndex.isReturn === undefined ? "" : cleanText(cells[fieldIndex.isReturn]),
    sourceFile: fileName,
    sourceHash,
    sourceRow: rowNumber,
    rowKey: `${sourceHash}|row:${rowNumber}`
  };

  for (const dimension of DIMENSIONS) {
    record[dimension.key] = cleanDimension(cells[fieldIndex[dimension.key]]);
  }
  repairMisplacedCustomerType(record);
  record.status = normalizeStatus(record.status, record);
  record.region = getRegion(record.shippingProvince);

  record.orderKey = getOrderKey(record);

  return record;
}

function getFranchiseValue(cells, fieldIndex) {
  if (fieldIndex.collection !== undefined) {
    const value = cleanDimension(cells[fieldIndex.collection]);
    if (!isBlankValue(value) && !isCustomerTypeValue(value)) return value;
  }
  if (fieldIndex.franchise !== undefined) {
    const value = cleanDimension(cells[fieldIndex.franchise]);
    if (!isBlankValue(value) && !isCustomerTypeValue(value)) return value;
  }
  return BLANK;
}

function renderAll(options = {}) {
  hideClipTooltip();
  activeTrendPoint = null;
  const context = buildRenderContext();
  state.renderContext = context;
  updateDatasetSummary(context);

  if (options.renderFilters !== false) {
    renderFilters();
  }

  renderGlobalDashboardOutputs(context);
  markDashboardViewsDirty();
  renderDirtyActiveView(context);
  updateTrendSelectionButton();
}

function buildRenderContext() {
  const analysisRecords = getAnalysisRecords();
  const periods = getAppliedPeriods();
  const filtered = applyDimensionFilters(analysisRecords);
  const current = filtered.filter((record) => inDateRange(record, periods.currentStart, periods.currentEnd));
  const comparisonBasis = getComparisonBasis(periods);
  const hasComparison = comparisonBasis.hasComparison;
  const comparisonSource = hasComparison
    ? filtered.filter((record) => inDateRange(record, comparisonBasis.sourceStart, comparisonBasis.sourceEnd))
    : [];
  const comparison = applyComparisonBasis(comparisonSource, comparisonBasis);
  const currentSummary = summarize(current);
  const compareSummary = summarize(comparison);

  return {
    analysisRecords,
    periods,
    comparisonBasis,
    filtered,
    current,
    comparisonSource,
    comparison,
    hasComparison,
    currentSummary,
    compareSummary
  };
}

function updateDatasetSummary(context) {
  const dateSummary = getDatasetDateSummary();
  dom.dataRange.textContent = dateSummary ? `${dateSummary.min} to ${dateSummary.max}` : "No data loaded";
  dom.recordCount.textContent = `${numberFormat.format(context.analysisRecords.length)} analysis rows`;
}

function renderGlobalDashboardOutputs(context) {
  renderKpis(context.currentSummary, context.compareSummary, context.hasComparison);
  const statusSplit = buildStatusSplit(context.current, context.comparison, context.hasComparison);
  state.statusRows = statusSplit.rows;
  state.statusTotals = statusSplit.totals;
  state.pivotRows = buildPivot(context.current, context.comparison, context.hasComparison);
  state.productRows = buildProductResults(context.current, context.comparison, context.hasComparison);
  renderFiles();
  renderProductTable(state.productRows);
}

function markDashboardViewsDirty() {
  Object.keys(state.viewDirty).forEach((view) => {
    state.viewDirty[view] = true;
  });
}

function renderDirtyActiveView(context = state.renderContext) {
  const view = state.activeView || "performance";
  if (!(view in state.viewDirty)) return;
  if (!state.viewDirty[view]) return;
  renderDashboardView(view, context);
}

function renderDashboardView(view, context = state.renderContext) {
  if (!context) return;

  if (view === "performance") {
    renderTrendTable(context.current);
    renderStatusSplitTable(state.statusRows, state.statusTotals);
    renderPivotOutputs();
    state.viewDirty.performance = false;
    return;
  }

  if (view === "compare") {
    renderProductCompare(context.current);
    state.viewDirty.compare = false;
    return;
  }

  if (view === "trade") {
    renderTradeMeeting(context.filtered);
    state.viewDirty.trade = false;
    return;
  }

  if (view === "regional") {
    renderRegionalView(context);
    state.viewDirty.regional = false;
  }
}

function ensureViewFresh(view) {
  if (state.viewDirty[view]) renderDashboardView(view);
}

function renderRegionalView(context = state.renderContext) {
  if (!context) return;
  state.regionalProductRows = buildRegionalTopProducts(context.current, context.comparison, context.hasComparison);
  state.regionalCurrentRecords = context.current;
  state.regionalComparisonRecords = context.comparison;
  state.regionalHasComparison = context.hasComparison;
  renderRegionalTopProducts(getVisibleRegionalTopProducts());
  renderRegionalBreakdownTables();
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
  if (!getAnalysisRecords().length) {
    dom.filters.innerHTML = `<div class="empty-state">No filters</div>`;
    return;
  }

  dom.filters.innerHTML = DIMENSIONS.map((dimension, index) => {
    const selected = state.filters[dimension.key];
    const excluded = state.filterExclusions[dimension.key];
    const allSelected = Boolean(state.filterAllSelected[dimension.key]);
    removeHiddenFilterSelections(selected);
    removeHiddenFilterSelections(excluded);
    const search = state.filterSearch[dimension.key] || "";
    const selectedLabel = getFilterCountLabel(dimension.key);
    const isOpen = state.filterOpen[dimension.key] ?? (index < 5 || selected.size > 0 || excluded.size > 0 || allSelected);

    return `
      <details class="filter-group" data-filter-group="${dimension.key}" ${isOpen ? "open" : ""}>
        <summary>
          <span>${escapeHtml(dimension.label)}</span>
          <span class="filter-count">${selectedLabel}</span>
        </summary>
        <div class="filter-body">
          <input type="search" data-filter-search="${dimension.key}" value="${escapeHtml(search)}" placeholder="Search">
          <button class="text-button" data-filter-toggle-all="${dimension.key}" type="button">${escapeHtml(getFilterToggleButtonLabel(dimension.key))}</button>
          <div class="filter-options" data-filter-options="${dimension.key}">${renderFilterOptionMarkup(dimension)}</div>
        </div>
      </details>
    `;
  }).join("");
}

function renderFilterOptionMarkup(dimension) {
  const selected = state.filters[dimension.key];
  const excluded = state.filterExclusions[dimension.key];
  const allSelected = Boolean(state.filterAllSelected[dimension.key]);
  const search = state.filterSearch[dimension.key] || "";
  const counts = getFilterCounts(dimension.key);
  const options = Array.from(counts.entries())
    .filter(([value]) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort(compareFilterOptions)
    .slice(0, MAX_FILTER_OPTIONS);

  const optionMarkup = options.map(([value, count]) => {
    const id = `${dimension.key}-${hashString(value)}`;
    const hasRelevantData = count > 0;
    const checked = selected.size > 0 ? selected.has(value) : allSelected && !excluded.has(value);
    const isExcluded = allSelected && !checked && excluded.has(value);
    return `
      <label class="filter-option ${hasRelevantData ? "" : "is-empty"} ${isExcluded ? "is-excluded" : ""}" for="${id}" title="${escapeHtml(value)}">
        <input id="${id}" type="checkbox" data-filter-option="${dimension.key}" value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
        <span>${escapeHtml(value)}</span>
        <em>${numberFormat.format(count)}</em>
      </label>
    `;
  }).join("");

  return optionMarkup || `<div class="empty-state">No matches</div>`;
}

function getFilterCounts(key) {
  const counts = new Map();
  for (const record of getAnalysisRecords()) {
    const value = record[key] || BLANK;
    if (isHiddenFilterValue(value)) continue;
    if (!counts.has(value)) counts.set(value, 0);
    if (recordMatchesOtherFilters(record, key)) {
      counts.set(value, counts.get(value) + 1);
    }
  }
  return counts;
}

function recordMatchesOtherFilters(record, excludeKey) {
  return DIMENSIONS.every((dimension) => {
    if (dimension.key === excludeKey) return true;
    return isDimensionValueAllowed(dimension.key, record[dimension.key] || BLANK);
  });
}

function compareFilterOptions([aValue, aCount], [bValue, bCount]) {
  const aRelevant = aCount > 0;
  const bRelevant = bCount > 0;
  if (aRelevant !== bRelevant) return aRelevant ? -1 : 1;
  return collator.compare(aValue, bValue);
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
  if (!state.filterExclusions[key]) state.filterExclusions[key] = new Set();
  state.filterOpen[key] = true;

  const selected = state.filters[key];
  const excluded = state.filterExclusions[key];
  const allSelected = Boolean(state.filterAllSelected[key]);

  if (selected.size > 0) {
    if (checkbox.checked) {
      selected.add(checkbox.value);
    } else {
      selected.delete(checkbox.value);
    }
  } else if (allSelected) {
    if (checkbox.checked) {
      excluded.delete(checkbox.value);
    } else {
      excluded.add(checkbox.value);
    }
  } else if (checkbox.checked) {
    selected.add(checkbox.value);
  }

  updateFilterCountLabel(key);
  updateFilterToggleButton(key);
  scheduleFilterApply();
}

function handleFilterClick(event) {
  const button = event.target.closest("[data-filter-toggle-all]");
  if (!button) return;
  const key = button.dataset.filterToggleAll;
  state.filterAllSelected[key] = !state.filterAllSelected[key];
  state.filters[key].clear();
  state.filterExclusions[key]?.clear();
  state.filterOpen[key] = true;
  updateFilterCountLabel(key);
  updateFilterToggleButton(key);
  renderFilterOptions(key);
  scheduleFilterApply();
}

function scheduleFilterApply() {
  window.clearTimeout(filterApplyTimer);
  filterApplyTimer = window.setTimeout(() => {
    filterApplyTimer = null;
    renderAll({ renderFilters: false });
    scheduleFilterOptionsRefresh();
  }, FILTER_APPLY_DEBOUNCE_MS);
}

function scheduleFilterOptionsRefresh() {
  window.clearTimeout(filterOptionsRefreshTimer);
  filterOptionsRefreshTimer = window.setTimeout(() => {
    filterOptionsRefreshTimer = null;
    refreshVisibleFilterOptions();
  }, FILTER_OPTIONS_REFRESH_DEBOUNCE_MS);
}

function refreshVisibleFilterOptions() {
  for (const dimension of DIMENSIONS) {
    updateFilterCountLabel(dimension.key);
    updateFilterToggleButton(dimension.key);
  }
  dom.filters.querySelectorAll(".filter-group[open] [data-filter-options]").forEach((container) => {
    renderFilterOptions(container.dataset.filterOptions);
  });
}

function clearAllFilters() {
  window.clearTimeout(filterApplyTimer);
  window.clearTimeout(filterOptionsRefreshTimer);
  filterApplyTimer = null;
  filterOptionsRefreshTimer = null;
  for (const dimension of DIMENSIONS) {
    state.filters[dimension.key].clear();
    state.filterExclusions[dimension.key]?.clear();
    state.filterAllSelected[dimension.key] = false;
    state.pivotNameExclusions[dimension.key]?.clear();
  }
  state.pivotNameSearch = "";
  if (dom.pivotNameFilterSearch) dom.pivotNameFilterSearch.value = "";
  renderAll();
}

function setAllFilterGroupsOpen(open) {
  for (const dimension of DIMENSIONS) {
    state.filterOpen[dimension.key] = open;
  }
  dom.filters.querySelectorAll(".filter-group").forEach((group) => {
    group.open = open;
  });
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
  label.textContent = getFilterCountLabel(key);
}

function updateFilterToggleButton(key) {
  const button = dom.filters.querySelector(`[data-filter-toggle-all="${key}"]`);
  if (!button) return;
  button.textContent = getFilterToggleButtonLabel(key);
}

function getFilterCountLabel(key) {
  const selected = state.filters[key];
  const excluded = state.filterExclusions[key];
  if (selected?.size) return numberFormat.format(selected.size);
  if (state.filterAllSelected[key]) {
    return excluded?.size ? `All - ${numberFormat.format(excluded.size)}` : "All";
  }
  return "Any";
}

function getFilterToggleButtonLabel(key) {
  return state.filterAllSelected[key] ? "Deselect All" : "Select All";
}

function handlePeriodDatePickerOpen(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  seedPeriodDateInputMonth(input);
}

function seedPeriodDateInputMonth(input) {
  const peer = getPeriodPeerInput(input);
  if (!peer?.value) return;
  if (sameDateMonth(input.value, peer.value)) return;

  if (periodDateSeed?.input === input) return;
  restoreUncommittedPeriodDateSeed();

  const seededValue = getMonthAlignedDateValue(input.value, peer.value);
  if (!seededValue || seededValue === input.value) return;

  periodDateSeed = {
    input,
    originalValue: input.value,
    seededValue,
    committed: false
  };
  input.value = seededValue;
}

function restoreUncommittedPeriodDateSeed(event) {
  if (!periodDateSeed) return;
  if (event?.currentTarget && event.currentTarget !== periodDateSeed.input) return;

  const seed = periodDateSeed;
  periodDateSeed = null;
  if (!seed.committed && seed.input.value === seed.seededValue) {
    seed.input.value = seed.originalValue;
  }
}

function commitPeriodDateSeed(input) {
  if (!periodDateSeed || periodDateSeed.input !== input) return;
  periodDateSeed.committed = true;
  periodDateSeed = null;
}

function getPeriodPeerInput(input) {
  if (input === dom.currentStart) return dom.currentEnd;
  if (input === dom.currentEnd) return dom.currentStart;
  if (input === dom.compareStart) return dom.compareEnd;
  if (input === dom.compareEnd) return dom.compareStart;
  return null;
}

function sameDateMonth(left, right) {
  return Boolean(left && right && left.slice(0, 7) === right.slice(0, 7));
}

function getMonthAlignedDateValue(targetValue, peerValue) {
  const peer = parseDateParts(peerValue);
  if (!peer) return "";
  const target = parseDateParts(targetValue) || peer;
  const day = Math.min(target.day, daysInMonth(peer.year, peer.month));
  return `${peer.year}-${String(peer.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function handlePeriodInputChange(event) {
  commitPeriodDateSeed(event?.currentTarget);
  state.dateTouched = true;
  clearTrendSelectionState();
  markPeriodsDirty();
}

function markPeriodsDirty(message = "Period changes pending. Click Apply Periods to refresh the dashboard.") {
  state.periodsDirty = !periodInputsMatchApplied();
  updateApplyPeriodsButton();
  if (state.periodsDirty) setStatus(message);
}

function applyPeriodInputs() {
  const error = validatePeriodInputs();
  if (error) {
    setStatus(error, "error");
    return false;
  }

  syncAppliedPeriodsFromInputs();
  renderAll();
  const basis = getComparisonBasis(getAppliedPeriods());
  const basisText = basis.hasComparison ? ` Compare as ${basis.label}.` : "";
  setStatus(`Periods applied: ${state.periods.currentStart || "all"} to ${state.periods.currentEnd || "latest"}.${basisText}`);
  return true;
}

function swapPeriodInputs() {
  const periods = readPeriodInputs();
  if (!periods.compareStart || !periods.compareEnd) {
    setStatus("Choose both Compare Start and Compare End before swapping periods.", "error");
    return;
  }

  clearTrendSelectionState();
  dom.currentStart.value = periods.compareStart;
  dom.currentEnd.value = periods.compareEnd;
  dom.compareStart.value = periods.currentStart;
  dom.compareEnd.value = periods.currentEnd;
  state.dateTouched = true;
  markPeriodsDirty("Current and compare periods swapped. Click Apply Periods to refresh the dashboard.");
}

function readPeriodInputs() {
  return {
    currentStart: dom.currentStart.value,
    currentEnd: dom.currentEnd.value,
    compareStart: dom.compareStart.value,
    compareEnd: dom.compareEnd.value,
    compareBasis: getCompareBasisInputValue()
  };
}

function getCompareBasisInputValue() {
  const value = dom.compareBasis?.value || COMPARE_BASIS_DEFAULT;
  return Object.prototype.hasOwnProperty.call(COMPARE_BASIS_LABELS, value) ? value : COMPARE_BASIS_DEFAULT;
}

function getAppliedPeriods() {
  return state.periods.currentStart || state.periods.currentEnd
    ? state.periods
    : readPeriodInputs();
}

function syncAppliedPeriodsFromInputs() {
  state.periods = readPeriodInputs();
  state.periodsDirty = false;
  updateApplyPeriodsButton();
}

function periodInputsMatchApplied() {
  const inputs = readPeriodInputs();
  const applied = getAppliedPeriods();
  return inputs.currentStart === applied.currentStart
    && inputs.currentEnd === applied.currentEnd
    && inputs.compareStart === applied.compareStart
    && inputs.compareEnd === applied.compareEnd
    && inputs.compareBasis === (applied.compareBasis || COMPARE_BASIS_DEFAULT);
}

function updateApplyPeriodsButton() {
  if (!dom.applyPeriods) return;
  dom.applyPeriods.disabled = !state.periodsDirty;
  dom.applyPeriods.classList.toggle("primary", state.periodsDirty);
}

function validatePeriodInputs() {
  const periods = readPeriodInputs();
  if (!periods.currentStart || !periods.currentEnd) {
    return "Choose both Current Start and Current End before applying the period.";
  }
  if (periods.currentStart > periods.currentEnd) {
    return "Current Start must be on or before Current End.";
  }

  const hasCompareStart = Boolean(periods.compareStart);
  const hasCompareEnd = Boolean(periods.compareEnd);
  if (periods.compareBasis === "rolling-4-week") {
    return "";
  }
  if (hasCompareStart !== hasCompareEnd) {
    return "Choose both Compare Start and Compare End, or leave both compare fields blank.";
  }
  if (hasCompareStart && periods.compareStart > periods.compareEnd) {
    return "Compare Start must be on or before Compare End.";
  }

  return "";
}

function handleTrendProductInput() {
  state.trendProductQuery = dom.trendProductInput.value;
  renderTrendTable(getCurrentTrendRecords());
}

function handleTrendGrainChange() {
  state.trendGrain = dom.trendGrain.value || "week";
  renderTrendTable(getCurrentTrendRecords());
}

function handleTrendMetricChange() {
  state.trendMetric = getTrendMetricMode();
  renderTrendTable(getCurrentTrendRecords());
}

function handleTrendCompareToggleChange() {
  state.trendShowCompare = Boolean(dom.trendCompareToggle?.checked);
  renderTrendTable(getCurrentTrendRecords());
}

function clearTrendProduct() {
  state.trendProductQuery = "";
  dom.trendProductInput.value = "";
  renderTrendTable(getCurrentTrendRecords());
}

function handleCompareProductInput() {
  state.compareProductQuery = dom.compareProductInput.value;
  renderCompareProductOptions(getCurrentTrendRecords());
}

function handleCompareProductKeydown(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addCompareProductFromInput();
}

function handleCompareGrainChange() {
  state.compareGrain = dom.compareGrain.value || "week";
  renderProductCompare(getCurrentTrendRecords());
}

function handleCompareMetricChange() {
  state.compareMetric = getCompareMetricMode();
  renderProductCompare(getCurrentTrendRecords());
}

function handleCompareToggleChange() {
  state.compareShowCompare = Boolean(dom.compareCompareToggle?.checked);
  renderProductCompare(getCurrentTrendRecords());
}

function handleCompareRegionChange() {
  syncCompareRegionSettingsFromInputs();
  renderProductCompare(getCurrentTrendRecords());
}

function addCompareProductFromInput() {
  const records = getCurrentTrendRecords();
  const product = resolveCompareProductSelection(state.compareProductQuery, records);
  if (!product) {
    setStatus("Product not found in the current filtered period.", "error");
    return;
  }

  if (state.compareProducts.some((item) => item.productKey === product.productKey)) {
    setStatus("That product is already in the comparison.", "error");
    return;
  }

  if (state.compareProducts.length >= PRODUCT_COMPARE_LIMIT) {
    setStatus(`Product compare is capped at ${PRODUCT_COMPARE_LIMIT} products.`, "error");
    return;
  }

  state.compareProducts.push({
    productKey: product.productKey,
    sku: product.sku,
    productTitle: product.productTitle,
    optionLabel: product.optionLabel
  });
  state.compareProductQuery = "";
  dom.compareProductInput.value = "";
  dom.compareProductOptions.innerHTML = "";
  renderProductCompare(records);
}

function clearCompareProducts() {
  state.compareProducts = [];
  state.compareProductQuery = "";
  dom.compareProductInput.value = "";
  dom.compareProductOptions.innerHTML = "";
  renderProductCompare(getCurrentTrendRecords());
}

function handleCompareSelectionClick(event) {
  const removeButton = event.target.closest("[data-compare-remove]");
  if (!removeButton) return;
  state.compareProducts = state.compareProducts.filter((product) => product.productKey !== removeButton.dataset.compareRemove);
  renderProductCompare(getCurrentTrendRecords());
}

function getCurrentTrendRecords() {
  const periods = getAppliedPeriods();
  return getFilteredTrendRecords()
    .filter((record) => inDateRange(record, periods.currentStart, periods.currentEnd));
}

function getCompareTrendRecords() {
  const periods = getAppliedPeriods();
  const basis = getComparisonBasis(periods);
  if (!basis.hasComparison) return [];
  return getFilteredTrendRecords()
    .filter((record) => inDateRange(record, basis.sourceStart, basis.sourceEnd));
}

function getFilteredTrendRecords() {
  return applyDimensionFilters(getAnalysisRecords());
}

function renderTrendTable(filteredRecords) {
  if (!dom.trendChart) return;

  state.trendGrain = dom.trendGrain.value || state.trendGrain || "week";
  state.trendMetric = getTrendMetricMode();
  syncCompareLineToggle(dom.trendCompareToggle, state.trendShowCompare);
  renderTrendProductOptions(filteredRecords);
  const trendRecords = filterTrendProductRecords(filteredRecords);
  const compareTrendRecords = shouldShowTrendCompareLine()
    ? filterTrendProductRecords(getCompareTrendRecords())
    : [];
  const periods = getAppliedPeriods();
  const comparisonBasis = getComparisonBasis(periods);
  const rows = buildTrendRows(trendRecords, state.trendGrain, periods.currentStart, periods.currentEnd);
  const compareRows = compareTrendRecords.length
    ? buildTrendRows(compareTrendRecords, state.trendGrain, comparisonBasis.sourceStart, comparisonBasis.sourceEnd)
    : [];
  const grainLabel = getTrendGrainLabel(state.trendGrain);
  dom.trendHeading.textContent = state.trendProductQuery ? `${grainLabel} Trend by Product` : `${grainLabel} Trend`;

  if (!rows.length) {
    dom.trendChart.innerHTML = `<div class="empty-state">No trend results</div>`;
    return;
  }

  dom.trendChart.innerHTML = renderTrendLineChart(rows, compareRows);
}

function renderTrendLineChart(rows, compareRows = []) {
  const metricMode = getTrendMetricMode();
  const showSales = metricMode !== "units";
  const showUnits = metricMode !== "sales";
  const showBoth = showSales && showUnits;
  const showCompare = shouldShowTrendCompareLine() && compareRows.length > 0;
  const width = 860;
  const height = 360;
  const pad = { top: 30, right: showBoth ? 92 : 46, bottom: 86, left: 88 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const compareRowsForAxis = showCompare ? compareRows : [];
  const axisRows = compareRowsForAxis.length > rows.length ? compareRowsForAxis : rows;
  const axisLength = Math.max(axisRows.length, 1);
  const salesScale = getTrendScale(rows.map((row) => row.netSales).concat(compareRowsForAxis.map((row) => row.netSales)));
  const unitsScale = getTrendScale(rows.map((row) => row.netUnits).concat(compareRowsForAxis.map((row) => row.netUnits)));
  const primaryScale = showSales ? salesScale : unitsScale;
  const xForAxisIndex = (index) => {
    if (axisLength <= 1) return pad.left + plotWidth / 2;
    return pad.left + (index / (axisLength - 1)) * plotWidth;
  };
  const xForSeriesIndex = (index, seriesLength) => {
    if (seriesLength <= 1) {
      return axisLength > 1 ? pad.left + plotWidth : pad.left + plotWidth / 2;
    }
    return pad.left + (index / (seriesLength - 1)) * plotWidth;
  };
  const yForValue = (value, scale) => pad.top + (1 - (value - scale.min) / (scale.max - scale.min)) * plotHeight;
  const salesPoints = rows.map((row, index) => ({
    ...row,
    x: xForSeriesIndex(index, rows.length),
    y: yForValue(row.netSales, salesScale)
  }));
  const unitsPoints = rows.map((row, index) => ({
    ...row,
    x: xForSeriesIndex(index, rows.length),
    y: yForValue(row.netUnits, unitsScale)
  }));
  const compareSalesPoints = compareRowsForAxis.map((row, index) => ({
    ...row,
    x: xForSeriesIndex(index, compareRowsForAxis.length),
    y: yForValue(row.netSales, salesScale)
  }));
  const compareUnitsPoints = compareRowsForAxis.map((row, index) => ({
    ...row,
    x: xForSeriesIndex(index, compareRowsForAxis.length),
    y: yForValue(row.netUnits, unitsScale)
  }));
  const primaryTicks = buildTrendYAxisTicks(primaryScale.min, primaryScale.max, 4);
  const secondaryTicks = showBoth ? buildTrendYAxisTicks(unitsScale.min, unitsScale.max, 4) : [];
  const salesLinePath = buildTrendPath(salesPoints);
  const unitsLinePath = buildTrendPath(unitsPoints);
  const compareSalesLinePath = buildTrendPath(compareSalesPoints);
  const compareUnitsLinePath = buildTrendPath(compareUnitsPoints);
  const salesBaselineY = yForValue(0, salesScale);
  const unitsBaselineY = yForValue(0, unitsScale);
  const baselineY = showSales ? salesBaselineY : unitsBaselineY;
  const salesAreaPath = buildTrendAreaPath(salesPoints, salesBaselineY);
  const unitsAreaPath = buildTrendAreaPath(unitsPoints, unitsBaselineY);
  const latest = rows[rows.length - 1];
  const latestChange = latest.salesChange === null ? "" : `${latest.salesChange >= 0 ? "+" : ""}${formatCurrency(latest.salesChange)}`;
  const primaryTickFormatter = showSales ? formatCompactCurrency : formatNumber;
  const xLabelIndexes = getTrendXLabelIndexes(axisRows, state.trendGrain, plotWidth);

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
    <div class="trend-legend" aria-hidden="true">
      ${showSales ? `<span><i class="legend-swatch sales"></i>Sales $</span>` : ""}
      ${showUnits ? `<span><i class="legend-swatch units"></i>Units</span>` : ""}
      ${showCompare ? `<span><i class="legend-swatch compare-period"></i>Compare Period</span>` : ""}
    </div>
    <svg class="trend-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Trend line" data-trend-selectable="true" data-plot-left="${pad.left}" data-plot-right="${width - pad.right}" data-plot-top="${pad.top}" data-plot-bottom="${height - pad.bottom}" data-trend-point-count="${rows.length}">
      <rect x="0" y="0" width="${width}" height="${height}" class="trend-svg-bg"></rect>
      <rect x="${pad.left}" y="${pad.top}" width="0" height="${plotHeight}" class="trend-range-selection" hidden></rect>
      ${primaryTicks.map((tick) => {
        const y = yForValue(tick, primaryScale);
        return `
          <line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${width - pad.right}" y2="${y.toFixed(2)}" class="trend-grid-line"></line>
          <text x="${pad.left - 12}" y="${(y + 4).toFixed(2)}" class="trend-axis-label ${showSales ? "sales-axis" : "units-axis"}" text-anchor="end">${escapeHtml(primaryTickFormatter(tick))}</text>
        `;
      }).join("")}
      ${secondaryTicks.map((tick) => {
        const y = yForValue(tick, unitsScale);
        return `<text x="${width - pad.right + 14}" y="${(y + 4).toFixed(2)}" class="trend-axis-label units-axis" text-anchor="start">${escapeHtml(formatNumber(tick))}</text>`;
      }).join("")}
      <line x1="${pad.left}" y1="${baselineY.toFixed(2)}" x2="${width - pad.right}" y2="${baselineY.toFixed(2)}" class="trend-zero-line"></line>
      ${showSales ? `<path d="${salesAreaPath}" class="trend-area sales-area"></path>` : ""}
      ${showUnits && !showSales ? `<path d="${unitsAreaPath}" class="trend-area units-area"></path>` : ""}
      ${showCompare && showSales ? `<path d="${compareSalesLinePath}" class="trend-line sales-line compare-period-line"></path>` : ""}
      ${showCompare && showUnits ? `<path d="${compareUnitsLinePath}" class="trend-line units-line compare-period-line compare-period-units-line"></path>` : ""}
      ${showSales ? `<path d="${salesLinePath}" class="trend-line sales-line"></path>` : ""}
      ${showUnits ? `<path d="${unitsLinePath}" class="trend-line units-line"></path>` : ""}
      ${xLabelIndexes.map((index) => {
        const row = axisRows[index];
        const x = xForAxisIndex(index);
        const y = height - 32;
        return `<text x="${x.toFixed(2)}" y="${y}" class="trend-axis-label trend-x-label" text-anchor="end" transform="rotate(-35 ${x.toFixed(2)} ${y})">${escapeHtml(row.axisLabel || row.periodLabel)}</text>`;
      }).join("")}
      ${showCompare ? compareRowsForAxis.map((row, index) => renderTrendPointGroup(row, compareSalesPoints[index], compareUnitsPoints[index], {
        showSales,
        showUnits,
        width,
        height,
        pad,
        isCompare: true,
        trendIndex: index
      })).join("") : ""}
      ${rows.map((row, index) => renderTrendPointGroup(row, salesPoints[index], unitsPoints[index], {
        showSales,
        showUnits,
        width,
        height,
        pad,
        trendIndex: index
      })).join("")}
    </svg>
  `;
}

function shouldShowTrendCompareLine() {
  return Boolean(state.trendShowCompare && hasComparisonPeriod());
}

function shouldShowProductCompareLine() {
  return Boolean(state.compareShowCompare && hasComparisonPeriod());
}

function syncCompareLineToggle(input, checked) {
  if (!input) return;
  const enabled = hasComparisonPeriod();
  input.disabled = !enabled;
  input.checked = Boolean(checked && enabled);
  input.closest("label")?.classList.toggle("is-disabled", !enabled);
}

function getTrendMetricMode() {
  const value = dom.trendMetric?.value || state.trendMetric || "sales";
  return TREND_METRIC_OPTIONS.has(value) ? value : "sales";
}

function getTrendScale(values) {
  let min = 0;
  let max = 0;
  for (const value of values) {
    const numeric = Number(value) || 0;
    if (numeric < min) min = numeric;
    if (numeric > max) max = numeric;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * 0.08;
  return {
    min: min < 0 ? min - padding : 0,
    max: max + padding
  };
}

function buildTrendPath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function buildTrendAreaPath(points, baselineY) {
  const linePath = buildTrendPath(points);
  return `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

function renderTrendPointGroup(row, salesPoint, unitsPoint, options) {
  const visiblePoints = [
    options.showSales ? salesPoint : null,
    options.showUnits ? unitsPoint : null
  ].filter(Boolean);
  const anchorPoint = visiblePoints.reduce((top, point) => point.y < top.y ? point : top, visiblePoints[0]);
  const tooltip = getTrendTooltipPosition(anchorPoint.x, anchorPoint.y, options);
  const periodType = state.trendGrain === "week" ? "Week" : state.trendGrain === "month" ? "Month" : "Day";
  const periodLabel = options.isCompare ? `Compare ${periodType}` : periodType;
  const compareClass = options.isCompare ? " compare-period-point-group" : "";
  const pointClass = options.isCompare ? " compare-period-point" : "";
  const tooltipClass = options.isCompare ? " compare-period-tooltip" : "";
  const pointRadius = options.isCompare ? "5.5" : "4.7";
  const label = `${periodLabel} ${row.periodLabel}, sales ${formatCurrency(row.netSales)}, units ${formatNumber(row.netUnits)}`;
  const drilldownStart = row.filterStart || row.periodStart;
  const drilldownEnd = row.filterEnd || row.periodEnd || drilldownStart;
  const trendIndexAttr = Number.isFinite(options.trendIndex) ? ` data-trend-index="${options.trendIndex}"` : "";
  const hitTargets = visiblePoints.map((point) => (
    `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="14" class="trend-point-hit"></circle>`
  )).join("");

  return `
    <g class="trend-point-group${compareClass}" tabindex="0" role="button" aria-label="${escapeHtml(`${label}. Click to filter dashboard to this period.`)}" data-period-start="${escapeHtml(drilldownStart)}" data-period-end="${escapeHtml(drilldownEnd)}" data-period-label="${escapeHtml(row.periodLabel)}" data-period-role="${options.isCompare ? "compare" : "current"}"${trendIndexAttr}>
      ${hitTargets}
      ${options.showSales ? `<circle cx="${salesPoint.x.toFixed(2)}" cy="${salesPoint.y.toFixed(2)}" r="${pointRadius}" class="trend-point-dot trend-point-sales${pointClass}"></circle>` : ""}
      ${options.showUnits ? `<circle cx="${unitsPoint.x.toFixed(2)}" cy="${unitsPoint.y.toFixed(2)}" r="${pointRadius}" class="trend-point-dot trend-point-units${pointClass}"></circle>` : ""}
      <g class="trend-tooltip${tooltipClass}" transform="translate(${tooltip.x.toFixed(2)} ${tooltip.y.toFixed(2)})">
        <rect x="0" y="0" width="${tooltip.width}" height="${tooltip.height}" rx="8" class="trend-tooltip-card"></rect>
        <rect x="0" y="0" width="5" height="${tooltip.height}" rx="2.5" class="trend-tooltip-accent"></rect>
        <text x="14" y="20" class="trend-tooltip-label">${escapeHtml(periodLabel)}</text>
        <text x="14" y="37" class="trend-tooltip-value">${escapeHtml(row.periodLabel)}</text>
        <text x="14" y="57" class="trend-tooltip-label">Sales</text>
        <text x="82" y="57" class="trend-tooltip-value">${escapeHtml(formatCurrency(row.netSales))}</text>
        <text x="14" y="75" class="trend-tooltip-label">Units</text>
        <text x="82" y="75" class="trend-tooltip-value">${escapeHtml(formatNumber(row.netUnits))}</text>
      </g>
    </g>
  `;
}

function getTrendTooltipPosition(anchorX, anchorY, options) {
  const width = 218;
  const height = 88;
  const minX = options.pad.left + 4;
  const maxX = options.width - options.pad.right - width - 4;
  const x = Math.min(Math.max(anchorX - width / 2, minX), maxX);
  const canShowAbove = anchorY - height - 14 >= options.pad.top;
  const y = canShowAbove ? anchorY - height - 14 : anchorY + 16;
  return { x, y, width, height };
}

function buildTrendYAxisTicks(minValue, maxValue, count) {
  const ticks = [];
  for (let index = 0; index <= count; index += 1) {
    ticks.push(minValue + ((maxValue - minValue) * index / count));
  }
  return ticks;
}

function renderProductCompare(records) {
  if (!dom.compareChart) return;

  state.compareGrain = dom.compareGrain.value || state.compareGrain || "week";
  state.compareMetric = getCompareMetricMode();
  syncCompareRegionSettingsFromInputs();
  updateCompareRegionSummary();
  syncCompareLineToggle(dom.compareCompareToggle, state.compareShowCompare);
  renderCompareProductOptions(records);
  renderCompareSelection(records);

  const selectedProducts = getCompareSelectedProducts(records);
  const comparisonRecords = shouldShowProductCompareLine() ? getCompareTrendRecords() : [];
  const summarySeries = buildProductCompareSeries(records, selectedProducts, comparisonRecords);
  const chartSeries = buildProductCompareChartSeries(records, selectedProducts, comparisonRecords, summarySeries);
  renderProductCompareSummary(summarySeries);

  if (!selectedProducts.length) {
    dom.compareChart.innerHTML = `<div class="empty-state">No products selected</div>`;
    return;
  }

  if (!chartSeries.length) {
    dom.compareChart.innerHTML = `<div class="empty-state">Select All Regions Combined or at least one region line</div>`;
    return;
  }

  if (!chartSeries.some((item) => item.rows.length)) {
    dom.compareChart.innerHTML = `<div class="empty-state">No comparison results for the selected period, products, and region lines</div>`;
    return;
  }

  dom.compareChart.innerHTML = renderProductCompareLineChart(chartSeries);
}

function getCompareMetricMode() {
  const value = dom.compareMetric?.value || state.compareMetric || "sales";
  return TREND_METRIC_OPTIONS.has(value) ? value : "sales";
}

function renderCompareProductOptions(records) {
  if (!dom.compareProductOptions) return;
  const query = cleanText(dom.compareProductInput.value);
  if (!shouldShowTrendSuggestions(query) || state.compareProducts.length >= PRODUCT_COMPARE_LIMIT) {
    dom.compareProductOptions.innerHTML = "";
    return;
  }

  const selectedKeys = new Set(state.compareProducts.map((product) => product.productKey));
  const products = getCompareProductMatches(records, query)
    .filter((product) => !selectedKeys.has(product.productKey))
    .slice(0, TREND_SUGGESTION_LIMIT);

  dom.compareProductOptions.innerHTML = products.map((product) => `
    <option value="${escapeHtml(product.optionLabel)}"></option>
  `).join("");
}

function resolveCompareProductSelection(query, records) {
  const text = cleanText(query);
  if (!text) return null;
  const products = aggregateTrendProducts(records);
  const exact = resolveTrendProduct(text, products);
  if (exact) return exact;
  if (!shouldShowTrendSuggestions(text)) return null;
  return getCompareProductMatches(records, text)[0] || null;
}

function getCompareProductMatches(records, query) {
  return aggregateTrendProducts(records)
    .filter((product) => productMatchesTrendQuery(product, query))
    .sort((a, b) => b.netSales - a.netSales || collator.compare(a.optionLabel, b.optionLabel));
}

function renderCompareSelection(records) {
  if (!dom.compareSelection) return;
  const products = getCompareSelectedProducts(records);
  if (!products.length) {
    dom.compareSelection.innerHTML = `<span class="compare-selection-empty">No products selected</span>`;
    return;
  }

  dom.compareSelection.innerHTML = products.map((product, index) => `
    <span class="compare-chip" style="--compare-color:${PRODUCT_COMPARE_COLORS[index % PRODUCT_COMPARE_COLORS.length]}">
      <span class="compare-chip-label" title="${escapeHtml(product.optionLabel)}">${escapeHtml(product.sku)} | ${escapeHtml(product.productTitle)}</span>
      <button type="button" data-compare-remove="${escapeHtml(product.productKey)}" aria-label="Remove ${escapeHtml(product.productTitle)}">x</button>
    </span>
  `).join("");
}

function getCompareSelectedProducts(records) {
  const currentProducts = new Map(aggregateTrendProducts(records).map((product) => [product.productKey, product]));
  return state.compareProducts.map((product) => ({
    ...product,
    ...(currentProducts.get(product.productKey) || {}),
    optionLabel: currentProducts.get(product.productKey)?.optionLabel || product.optionLabel || `${product.sku} | ${product.productTitle}`
  }));
}

function buildProductCompareSeries(records, products, comparisonRecords = []) {
  const productRecords = new Map(products.map((product) => [product.productKey, []]));
  const compareProductRecords = new Map(products.map((product) => [product.productKey, []]));
  for (const record of records) {
    const productKey = getProductKey(record);
    if (productRecords.has(productKey)) productRecords.get(productKey).push(record);
  }
  for (const record of comparisonRecords) {
    const productKey = getProductKey(record);
    if (compareProductRecords.has(productKey)) compareProductRecords.get(productKey).push(record);
  }

  const grain = state.compareGrain || "week";
  const periods = getAppliedPeriods();
  const comparisonBasis = getComparisonBasis(periods);
  const series = products.map((product, index) => {
    const currentProductRecords = productRecords.get(product.productKey) || [];
    const compareRecords = compareProductRecords.get(product.productKey) || [];
    const rows = buildTrendRows(currentProductRecords, grain, periods.currentStart, periods.currentEnd);
    const compareRows = comparisonRecords.length
      ? buildTrendRows(compareRecords, grain, comparisonBasis.sourceStart, comparisonBasis.sourceEnd)
      : [];
    const totalSales = sum(currentProductRecords, "netSales");
    const totalUnits = sum(currentProductRecords, "netUnits");
    return {
      ...product,
      color: PRODUCT_COMPARE_COLORS[index % PRODUCT_COMPARE_COLORS.length],
      rows,
      compareRows,
      totalSales,
      totalUnits
    };
  });

  return normalizeProductCompareSeriesSet(series);
}

function buildProductCompareChartSeries(records, products, comparisonRecords, aggregateSeries) {
  const settings = getCompareRegionSettings();
  if (!settings.regions.length) {
    return settings.showAllRegions ? aggregateSeries : [];
  }

  const productRecords = new Map(products.map((product) => [product.productKey, []]));
  const compareProductRecords = new Map(products.map((product) => [product.productKey, []]));
  for (const record of records) {
    const productKey = getProductKey(record);
    if (productRecords.has(productKey)) productRecords.get(productKey).push(record);
  }
  for (const record of comparisonRecords || []) {
    const productKey = getProductKey(record);
    if (compareProductRecords.has(productKey)) compareProductRecords.get(productKey).push(record);
  }

  const grain = state.compareGrain || "week";
  const periods = getAppliedPeriods();
  const comparisonBasis = getComparisonBasis(periods);
  const aggregateByProduct = new Map(aggregateSeries.map((item) => [item.productKey, item]));
  const series = [];
  let lineIndex = 0;

  products.forEach((product, productIndex) => {
    const allCurrentRecords = productRecords.get(product.productKey) || [];
    const allCompareRecords = compareProductRecords.get(product.productKey) || [];

    if (settings.showAllRegions) {
      const aggregate = aggregateByProduct.get(product.productKey);
      if (aggregate) {
        series.push({
          ...aggregate,
          color: PRODUCT_COMPARE_COLORS[productIndex % PRODUCT_COMPARE_COLORS.length],
          isAllRegions: true,
          regionLabel: "All Regions",
          legendLabel: `${aggregate.sku} | All Regions`,
          legendTitle: `${aggregate.optionLabel} | All Regions`
        });
      }
    }

    settings.regions.forEach((region) => {
      const currentRegionRecords = allCurrentRecords.filter((record) => record.region === region);
      const compareRegionRecords = allCompareRecords.filter((record) => record.region === region);
      const rows = buildTrendRows(currentRegionRecords, grain, periods.currentStart, periods.currentEnd);
      const compareRows = comparisonRecords.length
        ? buildTrendRows(compareRegionRecords, grain, comparisonBasis.sourceStart, comparisonBasis.sourceEnd)
        : [];
      if (!rows.length && !compareRows.length) return;

      series.push({
        ...product,
        color: PRODUCT_COMPARE_REGION_COLORS[lineIndex % PRODUCT_COMPARE_REGION_COLORS.length],
        rows,
        compareRows,
        totalSales: sum(currentRegionRecords, "netSales"),
        totalUnits: sum(currentRegionRecords, "netUnits"),
        isAllRegions: false,
        regionLabel: region,
        legendLabel: `${product.sku} | ${region}`,
        legendTitle: `${product.optionLabel} | ${region}`
      });
      lineIndex += 1;
    });
  });

  return normalizeProductCompareSeriesSet(series);
}

function syncCompareRegionSettingsFromInputs() {
  state.compareShowAllRegions = dom.compareRegionAll?.checked !== false;
  state.compareRegions = new Set(
    Array.from(dom.compareRegionOptions?.querySelectorAll("[data-compare-region]:checked") || [])
      .map((input) => input.dataset.compareRegion)
      .filter((region) => REGION_DEFS.some((item) => item.label === region))
  );
}

function getCompareRegionSettings() {
  return {
    showAllRegions: Boolean(state.compareShowAllRegions),
    regions: Array.from(state.compareRegions || [])
  };
}

function updateCompareRegionSummary() {
  if (!dom.compareRegionSummary) return;
  const settings = getCompareRegionSettings();
  const count = settings.regions.length;
  if (settings.showAllRegions && count) {
    dom.compareRegionSummary.textContent = `All + ${numberFormat.format(count)} region${count === 1 ? "" : "s"}`;
  } else if (settings.showAllRegions) {
    dom.compareRegionSummary.textContent = "All Regions Combined";
  } else if (count) {
    dom.compareRegionSummary.textContent = `${numberFormat.format(count)} region${count === 1 ? "" : "s"}`;
  } else {
    dom.compareRegionSummary.textContent = "No lines selected";
  }
}

function normalizeProductCompareSeries(series) {
  const periods = new Map();
  for (const item of series) {
    for (const row of item.rows) {
      if (!periods.has(row.periodStart)) {
        periods.set(row.periodStart, {
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          periodLabel: row.periodLabel,
          axisLabel: row.axisLabel
        });
      }
    }
  }

  const orderedPeriods = Array.from(periods.values()).sort((a, b) => collator.compare(a.periodStart, b.periodStart));
  return series.map((item) => {
    const rowMap = new Map(item.rows.map((row) => [row.periodStart, row]));
    return {
      ...item,
      rows: orderedPeriods.map((period) => rowMap.get(period.periodStart) || {
        ...period,
        netSales: 0,
        netUnits: 0,
        orders: 0,
        salesChange: null,
        unitsChange: null
      })
    };
  });
}

function normalizeProductCompareSeriesSet(series) {
  const current = normalizeProductCompareSeries(series.map((item) => ({
    ...item,
    rows: item.rows || []
  })));
  const comparison = normalizeProductCompareSeries(series.map((item) => ({
    ...item,
    rows: item.compareRows || []
  })));

  return current.map((item, index) => ({
    ...item,
    compareRows: comparison[index]?.rows || []
  }));
}

function renderProductCompareSummary(series) {
  if (!dom.compareSummaryTbody) return;
  if (!series.length) {
    dom.compareSummaryTbody.innerHTML = `<tr><td colspan="4">No products selected</td></tr>`;
    return;
  }

  dom.compareSummaryTbody.innerHTML = series.map((product) => `
    <tr>
      <td>
        <div class="compare-summary-product">
          <span class="compare-summary-swatch" style="--compare-color:${product.color}"></span>
          ${renderClip(product.productTitle)}
        </div>
      </td>
      <td>${renderClip(product.sku)}</td>
      <td class="numeric">${formatCurrency(product.totalSales)}</td>
      <td class="numeric">${formatNumber(product.totalUnits)}</td>
    </tr>
  `).join("");
}

function renderProductCompareLineChart(series) {
  const metricMode = getCompareMetricMode();
  const showSales = metricMode !== "units";
  const showUnits = metricMode !== "sales";
  const showBoth = showSales && showUnits;
  const showCompare = shouldShowProductCompareLine() && series.some((item) => item.compareRows?.length);
  const currentPeriods = series.find((item) => item.rows.length)?.rows || [];
  const comparePeriods = showCompare ? (series.find((item) => item.compareRows?.length)?.compareRows || []) : [];
  const periods = comparePeriods.length > currentPeriods.length ? comparePeriods : currentPeriods;
  const axisLength = Math.max(periods.length, 1);
  const width = 930;
  const height = 420;
  const pad = { top: 34, right: showBoth ? 100 : 48, bottom: 92, left: 92 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const salesValues = series.flatMap((item) => item.rows.map((row) => row.netSales)
    .concat(showCompare ? (item.compareRows || []).map((row) => row.netSales) : []));
  const unitsValues = series.flatMap((item) => item.rows.map((row) => row.netUnits)
    .concat(showCompare ? (item.compareRows || []).map((row) => row.netUnits) : []));
  const salesScale = getTrendScale(salesValues);
  const unitsScale = getTrendScale(unitsValues);
  const primaryScale = showSales ? salesScale : unitsScale;
  const xForAxisIndex = (index) => {
    if (axisLength <= 1) return pad.left + plotWidth / 2;
    return pad.left + (index / (axisLength - 1)) * plotWidth;
  };
  const xForIndex = (index, seriesLength = axisLength) => {
    if (seriesLength <= 1) {
      return axisLength > 1 ? pad.left + plotWidth : pad.left + plotWidth / 2;
    }
    return pad.left + (index / (seriesLength - 1)) * plotWidth;
  };
  const yForValue = (value, scale) => pad.top + (1 - (value - scale.min) / (scale.max - scale.min)) * plotHeight;
  const primaryTicks = buildTrendYAxisTicks(primaryScale.min, primaryScale.max, 4);
  const secondaryTicks = showBoth ? buildTrendYAxisTicks(unitsScale.min, unitsScale.max, 4) : [];
  const baselineY = showSales ? yForValue(0, salesScale) : yForValue(0, unitsScale);
  const xLabelIndexes = getTrendXLabelIndexes(periods, state.compareGrain, plotWidth);
  const primaryTickFormatter = showSales ? formatCompactCurrency : formatNumber;

  return `
    <div class="compare-legend" aria-hidden="true">
      ${series.map((item) => `
        <span class="${item.isAllRegions ? "all-region-legend-item" : ""}" title="${escapeHtml(item.legendTitle || item.optionLabel)}">
          <i class="${item.isAllRegions ? "all-region-swatch" : ""}" style="--compare-color:${item.color}"></i>
          ${escapeHtml(item.legendLabel || item.sku)}
        </span>
      `).join("")}
      ${showCompare ? `<span><i class="compare-period-swatch"></i>Compare Period</span>` : ""}
    </div>
    <svg class="trend-line-svg compare-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Product comparison trend">
      <rect x="0" y="0" width="${width}" height="${height}" class="trend-svg-bg"></rect>
      ${primaryTicks.map((tick) => {
        const y = yForValue(tick, primaryScale);
        return `
          <line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${width - pad.right}" y2="${y.toFixed(2)}" class="trend-grid-line"></line>
          <text x="${pad.left - 12}" y="${(y + 4).toFixed(2)}" class="trend-axis-label ${showSales ? "sales-axis" : "units-axis"}" text-anchor="end">${escapeHtml(primaryTickFormatter(tick))}</text>
        `;
      }).join("")}
      ${secondaryTicks.map((tick) => {
        const y = yForValue(tick, unitsScale);
        return `<text x="${width - pad.right + 14}" y="${(y + 4).toFixed(2)}" class="trend-axis-label units-axis" text-anchor="start">${escapeHtml(formatNumber(tick))}</text>`;
      }).join("")}
      <line x1="${pad.left}" y1="${baselineY.toFixed(2)}" x2="${width - pad.right}" y2="${baselineY.toFixed(2)}" class="trend-zero-line"></line>
      ${showCompare ? series.map((item) => renderProductCompareSeriesLines(item, { showSales, showUnits, xForIndex, yForValue, salesScale, unitsScale, rowsKey: "compareRows", isCompare: true })).join("") : ""}
      ${series.map((item) => renderProductCompareSeriesLines(item, { showSales, showUnits, xForIndex, yForValue, salesScale, unitsScale })).join("")}
      ${xLabelIndexes.map((index) => {
        const period = periods[index];
        const x = xForAxisIndex(index);
        const y = height - 34;
        return `<text x="${x.toFixed(2)}" y="${y}" class="trend-axis-label trend-x-label" text-anchor="end" transform="rotate(-35 ${x.toFixed(2)} ${y})">${escapeHtml(period.axisLabel || period.periodLabel)}</text>`;
      }).join("")}
      ${showCompare ? series.map((item) => renderProductCompareSeriesPoints(item, { showSales, showUnits, xForIndex, yForValue, salesScale, unitsScale, width, height, pad, rowsKey: "compareRows", isCompare: true })).join("") : ""}
      ${series.map((item) => renderProductCompareSeriesPoints(item, { showSales, showUnits, xForIndex, yForValue, salesScale, unitsScale, width, height, pad })).join("")}
    </svg>
  `;
}

function renderProductCompareSeriesLines(item, options) {
  const rows = getProductCompareChartRows(item, options);
  if (!rows.length) return "";

  const compareClass = options.isCompare ? " compare-period-product-line" : "";
  const regionClass = item.isAllRegions ? " compare-all-regions-line" : item.regionLabel ? " compare-region-line" : "";
  const salesPoints = rows.map((row, index) => ({
    x: options.xForIndex(index, rows.length),
    y: options.yForValue(row.netSales, options.salesScale)
  }));
  const unitsPoints = rows.map((row, index) => ({
    x: options.xForIndex(index, rows.length),
    y: options.yForValue(row.netUnits, options.unitsScale)
  }));

  return `
    ${options.showSales ? `<path d="${buildTrendPath(salesPoints)}" class="compare-product-line compare-sales-line${compareClass}${regionClass}" style="--compare-color:${item.color}"></path>` : ""}
    ${options.showUnits ? `<path d="${buildTrendPath(unitsPoints)}" class="compare-product-line compare-units-line${compareClass}${regionClass}" style="--compare-color:${item.color}"></path>` : ""}
  `;
}

function renderProductCompareSeriesPoints(item, options) {
  const rows = getProductCompareChartRows(item, options);
  return rows.map((row, index) => {
    const salesPoint = {
      x: options.xForIndex(index, rows.length),
      y: options.yForValue(row.netSales, options.salesScale)
    };
    const unitsPoint = {
      x: options.xForIndex(index, rows.length),
      y: options.yForValue(row.netUnits, options.unitsScale)
    };
    return renderProductComparePointGroup(item, row, salesPoint, unitsPoint, options);
  }).join("");
}

function getProductCompareChartRows(item, options) {
  return item[options.rowsKey || "rows"] || [];
}

function renderProductComparePointGroup(product, row, salesPoint, unitsPoint, options) {
  const visiblePoints = [
    options.showSales ? salesPoint : null,
    options.showUnits ? unitsPoint : null
  ].filter(Boolean);
  const anchorPoint = visiblePoints.reduce((top, point) => point.y < top.y ? point : top, visiblePoints[0]);
  const tooltip = getProductCompareTooltipPosition(anchorPoint.x, anchorPoint.y, options);
  const periodType = state.compareGrain === "week" ? "Week" : state.compareGrain === "month" ? "Month" : "Day";
  const periodLabel = options.isCompare ? `Compare ${periodType}` : periodType;
  const productLabel = truncateText(product.productTitle, 28);
  const regionLabel = product.regionLabel || "All Regions";
  const ariaLabel = `${product.productTitle}, ${regionLabel}, ${periodLabel} ${row.periodLabel}, sales ${formatCurrency(row.netSales)}, units ${formatNumber(row.netUnits)}`;
  const compareClass = options.isCompare ? " compare-period-point-group" : "";
  const pointClass = options.isCompare ? " compare-period-product-point" : "";
  const pointRadius = options.isCompare ? "5.5" : "4.7";
  const hitTargets = visiblePoints.map((point) => (
    `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="14" class="trend-point-hit"></circle>`
  )).join("");

  return `
    <g class="trend-point-group compare-point-group${compareClass}" tabindex="0" aria-label="${escapeHtml(ariaLabel)}">
      ${hitTargets}
      ${options.showSales ? `<circle cx="${salesPoint.x.toFixed(2)}" cy="${salesPoint.y.toFixed(2)}" r="${pointRadius}" class="trend-point-dot compare-point-dot${pointClass}" style="--compare-color:${product.color}"></circle>` : ""}
      ${options.showUnits ? `<circle cx="${unitsPoint.x.toFixed(2)}" cy="${unitsPoint.y.toFixed(2)}" r="${pointRadius}" class="trend-point-dot compare-point-dot compare-point-units${pointClass}" style="--compare-color:${product.color}"></circle>` : ""}
      <g class="trend-tooltip compare-tooltip${options.isCompare ? " compare-period-tooltip" : ""}" transform="translate(${tooltip.x.toFixed(2)} ${tooltip.y.toFixed(2)})">
        <rect x="0" y="0" width="${tooltip.width}" height="${tooltip.height}" rx="8" class="trend-tooltip-card"></rect>
        <rect x="0" y="0" width="5" height="${tooltip.height}" rx="2.5" class="trend-tooltip-accent" style="--compare-color:${product.color}"></rect>
        <text x="14" y="20" class="trend-tooltip-label">Product</text>
        <text x="82" y="20" class="trend-tooltip-value">${escapeHtml(product.sku)}</text>
        <text x="14" y="39" class="trend-tooltip-value">${escapeHtml(productLabel)}</text>
        <text x="14" y="59" class="trend-tooltip-label">Region</text>
        <text x="82" y="59" class="trend-tooltip-value">${escapeHtml(truncateText(regionLabel, 22))}</text>
        <text x="14" y="78" class="trend-tooltip-label">${escapeHtml(periodLabel)}</text>
        <text x="82" y="78" class="trend-tooltip-value">${escapeHtml(row.periodLabel)}</text>
        <text x="14" y="98" class="trend-tooltip-label">Sales</text>
        <text x="82" y="98" class="trend-tooltip-value">${escapeHtml(formatCurrency(row.netSales))}</text>
        <text x="14" y="116" class="trend-tooltip-label">Units</text>
        <text x="82" y="116" class="trend-tooltip-value">${escapeHtml(formatNumber(row.netUnits))}</text>
      </g>
    </g>
  `;
}

function getProductCompareTooltipPosition(anchorX, anchorY, options) {
  const width = 260;
  const height = 128;
  const minX = options.pad.left + 4;
  const maxX = options.width - options.pad.right - width - 4;
  const x = Math.min(Math.max(anchorX - width / 2, minX), maxX);
  const canShowAbove = anchorY - height - 14 >= options.pad.top;
  const y = canShowAbove ? anchorY - height - 14 : anchorY + 16;
  return { x, y, width, height };
}

function getTrendXLabelIndexes(items, grain, plotWidth) {
  const length = Array.isArray(items) ? items.length : Number(items) || 0;
  if (length <= 1) return length ? [0] : [];

  const labelSpacing = grain === "day" ? 56 : grain === "month" ? 62 : 74;
  const grainMax = grain === "day" ? 12 : grain === "month" ? 12 : 10;
  const widthMax = Math.max(2, Math.floor((Number(plotWidth) || 0) / labelSpacing));
  const maxLabels = Math.max(2, Math.min(grainMax, widthMax || grainMax));

  if (length <= maxLabels) return Array.from({ length }, (_, index) => index);
  const indexes = new Set();
  for (let index = 0; index < maxLabels; index += 1) {
    indexes.add(Math.round(index * (length - 1) / (maxLabels - 1)));
  }
  return Array.from(indexes).sort((a, b) => a - b);
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
        filterStart: bucket.filterStart || bucket.start,
        filterEnd: bucket.filterEnd || bucket.end,
        periodLabel: bucket.label,
        axisLabel: bucket.axisLabel,
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
    const label = formatTrendDateKey(key);
    return {
      start: key,
      end: key,
      filterStart: key,
      filterEnd: key,
      label,
      axisLabel: label
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
      filterStart: display.start,
      filterEnd: display.end,
      label: display.start === start && display.end === end
        ? formatTrendMonthLabel(start)
        : formatTrendPeriodLabel(display.start, display.end),
      axisLabel: formatTrendMonthLabel(start)
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
    filterStart: display.start,
    filterEnd: display.end,
    label: formatTrendPeriodLabel(display.start, display.end),
    axisLabel: formatTrendDateKey(display.start)
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

function formatTrendPeriodLabel(start, end) {
  const startLabel = formatTrendDateKey(start);
  const endLabel = formatTrendDateKey(end);
  return startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
}

function formatTrendDateKey(key) {
  if (!key) return "";
  const date = dateFromKey(key);
  if (Number.isNaN(date.getTime())) return key;
  const month = TREND_MONTH_ABBRS[date.getUTCMonth()] || "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}-${day}-${year}`;
}

function formatTrendMonthLabel(key) {
  if (!key) return "";
  const date = dateFromKey(key);
  if (Number.isNaN(date.getTime())) return key;
  const month = TREND_MONTH_ABBRS[date.getUTCMonth()] || "";
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}-${year}`;
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
    const unitChange = hasComparison ? current.netUnits - comparison.netUnits : null;

    return {
      value,
      status: current.status || comparison.status || "",
      netSales: current.netSales,
      netUnits: current.netUnits,
      orders: getAggregateOrderCount(current),
      salesShare: totalSales ? current.netSales / totalSales : 0,
      unitsShare: totalUnits ? current.netUnits / totalUnits : 0,
      hasComparison,
      compareSales: hasComparison ? comparison.netSales : null,
      compareUnits: hasComparison ? comparison.netUnits : null,
      change,
      unitChange,
      changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null,
      unitChangePct: hasComparison ? percentChange(current.netUnits, comparison.netUnits) : null
    };
  });

  return sortRows(rows);
}

function buildStatusSplit(currentRecords, comparisonRecords, hasComparison) {
  const currentStatusRecords = currentRecords.filter((record) => !isHiddenResultValue(record.status));
  const comparisonStatusRecords = comparisonRecords.filter((record) => !isHiddenResultValue(record.status));
  const currentMap = aggregateByDimension(currentStatusRecords, "status");
  const compareMap = hasComparison ? aggregateByDimension(comparisonStatusRecords, "status") : new Map();
  const totalSales = sum(currentStatusRecords, "netSales");
  const totalUnits = sum(currentStatusRecords, "netUnits");
  const totalOrders = summarize(currentStatusRecords).orders;
  const totalCompareSales = hasComparison ? sum(comparisonStatusRecords, "netSales") : null;
  const totalCompareUnits = hasComparison ? sum(comparisonStatusRecords, "netUnits") : null;
  const values = getOrderedStatusValues(currentMap, compareMap);

  const rows = values.map((value) => {
    const current = currentMap.get(value) || emptyAggregate();
    const comparison = compareMap.get(value) || emptyAggregate();
    const change = hasComparison ? current.netSales - comparison.netSales : null;
    const unitChange = hasComparison ? current.netUnits - comparison.netUnits : null;

    return {
      value,
      netSales: current.netSales,
      netUnits: current.netUnits,
      orders: getAggregateOrderCount(current),
      salesShare: totalSales ? current.netSales / totalSales : 0,
      unitsShare: totalUnits ? current.netUnits / totalUnits : 0,
      hasComparison,
      compareSales: hasComparison ? comparison.netSales : null,
      compareUnits: hasComparison ? comparison.netUnits : null,
      change,
      unitChange,
      changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null,
      unitChangePct: hasComparison ? percentChange(current.netUnits, comparison.netUnits) : null
    };
  });

  return {
    rows,
    totals: {
      value: "Total",
      netSales: totalSales,
      netUnits: totalUnits,
      orders: totalOrders,
      salesShare: totalSales ? 1 : 0,
      unitsShare: totalUnits ? 1 : 0,
      hasComparison,
      compareSales: totalCompareSales,
      compareUnits: totalCompareUnits,
      change: hasComparison ? totalSales - totalCompareSales : null,
      unitChange: hasComparison ? totalUnits - totalCompareUnits : null,
      changePct: hasComparison ? percentChange(totalSales, totalCompareSales) : null,
      unitChangePct: hasComparison ? percentChange(totalUnits, totalCompareUnits) : null
    }
  };
}

function buildMetricBreakdown(currentRecords, comparisonRecords, hasComparison, key, sortByStatus = false) {
  const currentBreakdownRecords = currentRecords.filter((record) => !isHiddenResultValue(record[key]));
  const comparisonBreakdownRecords = comparisonRecords.filter((record) => !isHiddenResultValue(record[key]));
  const currentMap = aggregateByDimension(currentBreakdownRecords, key);
  const compareMap = hasComparison ? aggregateByDimension(comparisonBreakdownRecords, key) : new Map();
  const totalSales = sum(currentBreakdownRecords, "netSales");
  const totalUnits = sum(currentBreakdownRecords, "netUnits");
  const totalOrders = summarize(currentBreakdownRecords).orders;
  const totalCompareSales = hasComparison ? sum(comparisonBreakdownRecords, "netSales") : null;
  const values = Array.from(hasComparison ? new Set([...currentMap.keys(), ...compareMap.keys()]) : new Set(currentMap.keys()))
    .filter((value) => !isHiddenResultValue(value));

  const rows = values
    .map((value) => {
      const current = currentMap.get(value) || emptyAggregate();
      const comparison = compareMap.get(value) || emptyAggregate();
      const change = hasComparison ? current.netSales - comparison.netSales : null;

      return {
        value,
        netSales: current.netSales,
        netUnits: current.netUnits,
      orders: getAggregateOrderCount(current),
        salesShare: totalSales ? current.netSales / totalSales : 0,
        unitsShare: totalUnits ? current.netUnits / totalUnits : 0,
        hasComparison,
        compareSales: hasComparison ? comparison.netSales : null,
        compareUnits: hasComparison ? comparison.netUnits : null,
        change,
        changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null
      };
    })
    .filter((row) => row.netSales !== 0 || row.netUnits !== 0 || (hasComparison && row.compareSales !== 0));

  rows.sort(sortByStatus
    ? (a, b) => compareStatusLabels(a.value, b.value)
    : (a, b) => b.netSales - a.netSales || b.netUnits - a.netUnits || collator.compare(a.value, b.value));

  return {
    rows,
    totals: {
      value: "Total",
      netSales: totalSales,
      netUnits: totalUnits,
      orders: totalOrders,
      salesShare: totalSales ? 1 : 0,
      unitsShare: totalUnits ? 1 : 0,
      hasComparison,
      compareSales: totalCompareSales,
      change: hasComparison ? totalSales - totalCompareSales : null,
      changePct: hasComparison ? percentChange(totalSales, totalCompareSales) : null
    }
  };
}

function getOrderedStatusValues(currentMap, compareMap) {
  const values = new Set([...STATUS_DISPLAY_ORDER, ...currentMap.keys(), ...compareMap.keys()]);
  return Array.from(values)
    .filter((value) => !isHiddenResultValue(value))
    .sort(compareStatusLabels)
    .filter((value) => {
      if (STATUS_DISPLAY_ORDER.includes(value)) return true;
      const current = currentMap.get(value);
      const comparison = compareMap.get(value);
      return Boolean((current && (current.netSales !== 0 || current.netUnits !== 0 || getAggregateOrderCount(current))) || (comparison && (comparison.netSales !== 0 || comparison.netUnits !== 0 || getAggregateOrderCount(comparison))));
    });
}

function aggregateByDimension(records, key) {
  const map = new Map();
  for (const record of records) {
    const value = record[key] || BLANK;
    if (isHiddenResultValue(value)) continue;
    if (!map.has(value)) map.set(value, emptyAggregate());
    const aggregate = map.get(value);
    aggregate.netSales += metricValue(record, "netSales");
    aggregate.netUnits += metricValue(record, "netUnits");
    addWeightedOrder(aggregate.orderWeights, record);
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
    orderWeights: new Map(),
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
        <td>${renderClip(file.name)}</td>
        <td class="numeric">${numberFormat.format(file.rowsAdded || 0)}</td>
        <td>${escapeHtml(compactDateRange(file.minDate, file.maxDate))}</td>
        <td>${renderClip(file.source || "Repository", file.path || file.source || "Repository")}</td>
      </tr>
    `).join("");
}

function renderStatusSplitTable(rows, totals = null) {
  if (!dom.statusSplitTbody) return;
  const columns = getTableColumns("status");
  renderStatusSplitHeader(columns);
  if (!rows.length) {
    dom.statusSplitTbody.innerHTML = `<tr><td colspan="${columns.length}">No status results for the selected period and filters</td></tr>`;
    return;
  }

  dom.statusSplitTbody.innerHTML = [
    ...rows.map((row) => renderStatusSplitRow(row, false, columns)),
    totals ? renderStatusSplitRow(totals, true, columns) : ""
  ].join("");
}

function renderStatusSplitHeader(columns = getTableColumns("status")) {
  if (!dom.statusSplitThead) return;
  dom.statusSplitThead.innerHTML = `<tr>${columns.map(renderPlainTableHeader).join("")}</tr>`;
}

function renderPlainTableHeader(column) {
  return `<th class="${tableCellClass(column)}">${escapeHtml(column.label)}</th>`;
}

function getMetricBreakdownColumns(firstLabel) {
  return METRIC_BREAKDOWN_COLUMN_DEFS.map((column, index) => (
    index === 0 ? { ...column, label: firstLabel } : column
  ));
}

function renderMetricBreakdownHeader(target, table, firstLabel) {
  if (!target) return;
  const columns = getMetricBreakdownColumns(firstLabel);
  target.innerHTML = `<tr>${columns.map((column) => renderTableHeader(table, column)).join("")}</tr>`;
}

function sortMetricBreakdownRows(rows, table) {
  const sort = getTableSortState(table) || { key: "netSales", dir: "desc" };
  const direction = sort.dir === "asc" ? 1 : -1;
  const getter = SORTERS[sort.key] || SORTERS.netSales;

  return rows.slice().sort((a, b) => {
    const aValue = getter(a);
    const bValue = getter(b);
    const aMissing = aValue === null || aValue === undefined || aValue === "";
    const bMissing = bValue === null || bValue === undefined || bValue === "";

    if (aMissing && bMissing) return collator.compare(a.value || "", b.value || "");
    if (aMissing) return 1;
    if (bMissing) return -1;

    if (typeof aValue === "string" || typeof bValue === "string") {
      return collator.compare(String(aValue), String(bValue)) * direction;
    }

    const primary = ((Number(aValue) || 0) - (Number(bValue) || 0)) * direction;
    if (primary) return primary;
    return collator.compare(a.value || "", b.value || "");
  });
}

function renderMetricBreakdownTable(target, rows, totals = null, emptyMessage = "No results for the selected period and filters", options = {}) {
  if (!target) return;
  const columnCount = 9;
  if (!rows.length) {
    target.innerHTML = `<tr><td colspan="${columnCount}">${escapeHtml(emptyMessage)}</td></tr>`;
    return;
  }

  const totalRow = totals || null;

  target.innerHTML = [
    ...rows.map((row) => renderMetricBreakdownRow(row)),
    totalRow ? renderMetricBreakdownRow(totalRow, true) : ""
  ].join("");
}

function renderMetricBreakdownRow(row, isTotal = false) {
  const rowClass = isTotal ? ` class="total-row"` : "";
  return `
    <tr${rowClass}>
      <td>${isTotal ? escapeHtml(row.value) : renderClip(row.value)}</td>
      <td class="numeric">${formatCurrency(row.netSales)}</td>
      <td class="numeric">${formatPercent(row.salesShare)}</td>
      <td class="numeric">${formatNumber(row.netUnits)}</td>
      <td class="numeric">${formatPercent(row.unitsShare)}</td>
      <td class="numeric">${formatNumber(row.orders)}</td>
      <td class="numeric">${row.hasComparison ? formatCurrency(row.compareSales) : ""}</td>
      <td class="numeric ${getDeltaClass(row, "change")}">${row.hasComparison ? formatCurrency(row.change) : ""}</td>
      <td class="numeric ${getDeltaClass(row, "changePct")}">${row.hasComparison ? (row.changePct === null ? "n/a" : formatPercent(row.changePct)) : ""}</td>
    </tr>
  `;
}

function renderStatusSplitRow(row, isTotal = false, columns = getTableColumns("status")) {
  const rowClass = isTotal ? ` class="total-row"` : "";
  return `
    <tr${rowClass}>
      ${columns.map((column) => renderStatusSplitCell(row, column, isTotal)).join("")}
    </tr>
  `;
}

function renderStatusSplitCell(row, column, isTotal = false) {
  if (column.key === "value") {
    return `<td class="${tableCellClass(column)}">${isTotal ? escapeHtml(row.value) : renderClip(row.value)}</td>`;
  }

  let value = "";
  if (column.key === "netSales") value = formatCurrency(row.netSales);
  if (column.key === "salesShare") value = formatPercent(row.salesShare);
  if (column.key === "netUnits") value = formatNumber(row.netUnits);
  if (column.key === "unitsShare") value = formatPercent(row.unitsShare);
  if (column.key === "orders") value = formatNumber(row.orders);
  if (column.key === "compareSales") value = row.hasComparison ? formatCurrency(row.compareSales) : "";
  if (column.key === "change") value = row.hasComparison ? formatCurrency(row.change) : "";
  if (column.key === "unitChange") value = row.hasComparison ? formatNumber(row.unitChange) : "";
  if (column.key === "unitChangePct") value = row.hasComparison ? (row.unitChangePct === null ? "n/a" : formatPercent(row.unitChangePct)) : "";
  if (column.key === "changePct") value = row.hasComparison ? (row.changePct === null ? "n/a" : formatPercent(row.changePct)) : "";

  return `<td class="${tableCellClass(column, getDeltaClass(row, column.key))}">${value}</td>`;
}

function renderPivotOutputs() {
  const visibleRows = getVisiblePivotRows();
  renderPivotNameFilter();
  renderPivotTable(visibleRows);
}

function getVisiblePivotRows() {
  const exclusions = getActivePivotNameExclusions();
  const rows = exclusions.size
    ? state.pivotRows.filter((row) => !exclusions.has(row.value))
    : state.pivotRows;
  return recalculatePivotShares(rows);
}

function recalculatePivotShares(rows) {
  const totalSales = sum(rows, "netSales");
  const totalUnits = sum(rows, "netUnits");
  return rows.map((row) => ({
    ...row,
    salesShare: totalSales ? row.netSales / totalSales : 0,
    unitsShare: totalUnits ? row.netUnits / totalUnits : 0
  }));
}

function getActivePivotNameExclusions() {
  const key = getActiveDimension().key;
  if (!state.pivotNameExclusions[key]) state.pivotNameExclusions[key] = new Set();
  return state.pivotNameExclusions[key];
}

function getPivotNameRows() {
  return (state.pivotRows || []).filter((row) => !isHiddenResultValue(row.value));
}

function getPivotNameValues() {
  return getPivotNameRows().map((row) => row.value);
}

function getSearchedPivotNameValues() {
  const query = cleanText(state.pivotNameSearch).toLocaleLowerCase();
  const values = getPivotNameValues();
  if (!query) return values;
  return values.filter((value) => cleanText(value).toLocaleLowerCase().includes(query));
}

function renderPivotNameFilter() {
  if (!dom.pivotNameFilterButton || !dom.pivotNameFilterOptions) return;

  const dimension = getActiveDimension();
  const exclusions = getActivePivotNameExclusions();
  const rows = getPivotNameRows();
  const visibleRows = getVisiblePivotRows();
  const hiddenCount = rows.filter((row) => exclusions.has(row.value)).length;
  const allCount = rows.length;
  const searchedRows = getSearchedPivotNameValues()
    .map((value) => rows.find((row) => row.value === value))
    .filter(Boolean);
  const displayedRows = searchedRows.slice(0, MAX_PIVOT_NAME_FILTER_OPTIONS);
  const hasMore = searchedRows.length > displayedRows.length;

  dom.pivotNameFilterButton.disabled = !allCount;
  dom.pivotNameFilterButton.setAttribute("aria-label", `Filter ${dimension.label} names`);
  dom.pivotNameFilterLabel.textContent = hiddenCount
    ? `${dimension.label}: ${numberFormat.format(visibleRows.length)}/${numberFormat.format(allCount)} shown`
    : `${dimension.label}: All`;
  if (dom.pivotNameFilterSearch && dom.pivotNameFilterSearch.value !== state.pivotNameSearch) {
    dom.pivotNameFilterSearch.value = state.pivotNameSearch;
  }

  dom.pivotNameFilterOptions.innerHTML = displayedRows.length
    ? displayedRows.map((row) => renderPivotNameFilterOption(row, exclusions)).join("")
    : `<div class="empty-state pivot-filter-empty">No matching names</div>`;

  const searchNote = hasMore ? ` Showing first ${numberFormat.format(displayedRows.length)} matches.` : "";
  dom.pivotNameFilterSummary.textContent = hiddenCount
    ? `${numberFormat.format(hiddenCount)} of ${numberFormat.format(allCount)} hidden.${searchNote}`
    : `All ${numberFormat.format(allCount)} ${allCount === 1 ? "name is" : "names are"} shown.${searchNote}`;
}

function renderPivotNameFilterOption(row, exclusions) {
  const id = `pivot-name-${hashString(`${getActiveDimension().key}:${row.value}`)}`;
  const checked = !exclusions.has(row.value);
  return `
    <label class="pivot-filter-option" for="${id}" title="${escapeHtml(row.value)}">
      <input id="${id}" type="checkbox" data-pivot-name-option value="${escapeHtml(row.value)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(row.value)}</span>
      <em>${formatCurrency(row.netSales)}</em>
    </label>
  `;
}

function renderPivotTable(rows) {
  const dimension = getActiveDimension();
  const limit = getRowLimit();
  const visibleRows = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
  const columns = getTableColumns("pivot");
  const hiddenCount = getPivotNameRows().filter((row) => getActivePivotNameExclusions().has(row.value)).length;
  const maxAbsNetSales = getMaxAbsValue(visibleRows, "netSales");

  dom.pivotHeading.textContent = hiddenCount
    ? `Performance by ${dimension.label} (${numberFormat.format(rows.length)} shown)`
    : `Performance by ${dimension.label}`;
  dom.pivotThead.innerHTML = `<tr>${columns.map((column) => renderTableHeader("pivot", column)).join("")}</tr>`;
  updateSortHeaderStates();

  if (!visibleRows.length) {
    dom.pivotTbody.innerHTML = `<tr><td colspan="${columns.length}">No rows for the selected period and filters</td></tr>`;
    return;
  }

  dom.pivotTbody.innerHTML = visibleRows.map((row) => `
    <tr>
      ${columns.map((column) => renderPivotCell(row, column, { maxAbsNetSales })).join("")}
    </tr>
  `).join("");
}

function renderTableHeader(table, column) {
  return `
    <th class="${tableCellClass(column)}">
      <button data-table-sort="${table}" data-sort-key="${column.key}" type="button">
        <span>${escapeHtml(column.label)}</span>
        <span class="sort-icon" aria-hidden="true"></span>
      </button>
    </th>
  `;
}

function renderPivotCell(row, column, options = {}) {
  if (column.key === "value" || column.key === "status") {
    const value = row[column.key] || "";
    return renderTextCell(value, column);
  }

  if (column.key === "netSales") {
    return renderPivotSalesCell(row, column, options);
  }

  const value = formatPivotCellValue(row, column.key);
  return `<td class="${tableCellClass(column, getDeltaClass(row, column.key))}">${value}</td>`;
}

function renderPivotSalesCell(row, column, options) {
  const value = Number(row.netSales) || 0;
  const max = Number(options.maxAbsNetSales) || 1;
  const width = Math.max(value === 0 ? 0 : 2, Math.min(100, Math.abs(value) / max * 100));
  const directionClass = value < 0 ? "negative" : "positive";
  return `
    <td class="${tableCellClass(column, `pivot-bar-cell ${directionClass}`)}" style="--pivot-bar-width:${width.toFixed(2)}%">
      <span class="pivot-cell-bar" aria-hidden="true"></span>
      <span class="pivot-cell-value">${formatCurrency(value)}</span>
    </td>
  `;
}

function renderTextCell(value, column) {
  return `<td class="${tableCellClass(column)}">${renderClip(value)}</td>`;
}

function renderClip(value, tooltip = value, className = "clip") {
  const text = cleanText(value);
  const tooltipText = cleanText(tooltip || text);
  const tooltipAttr = tooltipText ? ` data-clip-tooltip="${escapeHtml(tooltipText)}"` : "";
  return `<div class="${escapeHtml(className)}"${tooltipAttr}>${escapeHtml(text)}</div>`;
}

function tableCellClass(column, extra = "") {
  return [
    column?.numeric ? "numeric" : "",
    column?.key ? `col-${column.key}` : "",
    extra
  ].filter(Boolean).join(" ");
}

function formatPivotCellValue(row, key) {
  if (key === "netSales") return formatCurrency(row.netSales);
  if (key === "salesShare") return formatPercent(row.salesShare);
  if (key === "netUnits") return formatNumber(row.netUnits);
  if (key === "unitsShare") return formatPercent(row.unitsShare);
  if (key === "compareSales") return row.hasComparison ? formatCurrency(row.compareSales) : "";
  if (key === "change") return row.hasComparison ? formatCurrency(row.change) : "";
  if (key === "unitChange") return row.hasComparison ? formatNumber(row.unitChange) : "";
  if (key === "unitChangePct") return row.hasComparison ? (row.unitChangePct === null ? "n/a" : formatPercent(row.unitChangePct)) : "";
  if (key === "changePct") return row.hasComparison ? (row.changePct === null ? "n/a" : formatPercent(row.changePct)) : "";
  return "";
}

function getDeltaClass(row, key) {
  if (!row.hasComparison) return "";
  const value = key === "unitChange" || key === "unitChangePct" ? row.unitChange : row.change;
  if (key !== "change" && key !== "changePct" && key !== "unitChange" && key !== "unitChangePct") return "";
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
        changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null,
        unitChangePct: hasComparison ? percentChange(current.netUnits, comparison.netUnits) : null
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
    product.netSales += metricValue(record, "netSales");
    product.netUnits += metricValue(record, "netUnits");
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
  metrics.netSales += metricValue(record, "netSales");
  metrics.netUnits += metricValue(record, "netUnits");
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
      ${columns.map((column) => renderProductTotalCell(column, { totalSales, totalUnits, totalCompareUnits, hasComparison, totalChange, totalUnitChange, totalChangePct })).join("")}
    </tr>
  `);

  dom.productTbody.innerHTML = bodyRows.join("");
}

function renderProductCell(row, column) {
  if (column.key === "productTitle" || column.key === "sku" || column.key === "status") {
    return renderTextCell(row[column.key] || "", column);
  }

  const value = formatProductCellValue(row, column.key);
  return `<td class="${tableCellClass(column, getDeltaClass(row, column.key))}">${value}</td>`;
}

function formatProductCellValue(row, key) {
  if (key === "netSales") return formatCurrency(row.netSales);
  if (key === "netUnits") return formatNumber(row.netUnits);
  if (key === "salesShare") return formatPercent(row.salesShare);
  if (key === "change") return row.hasComparison ? formatCurrency(row.change) : "";
  if (key === "unitChange") return row.hasComparison ? formatNumber(row.unitChange) : "";
  if (key === "changePct") return row.hasComparison ? (row.changePct === null ? "n/a" : formatPercent(row.changePct)) : "";
  if (key === "unitChangePct") return row.hasComparison ? (row.unitChangePct === null ? "n/a" : formatPercent(row.unitChangePct)) : "";
  return "";
}

function renderProductTotalCell(column, totals) {
  if (column.key === "productTitle") return `<td class="${tableCellClass(column)}">Total</td>`;
  if (column.key === "sku" || column.key === "status") return `<td class="${tableCellClass(column)}"></td>`;

  let value = "";
  if (column.key === "netSales") value = formatCurrency(totals.totalSales);
  if (column.key === "netUnits") value = formatNumber(totals.totalUnits);
  if (column.key === "salesShare") value = formatPercent(totals.totalSales ? 1 : 0);
  if (column.key === "change") value = totals.hasComparison ? formatCurrency(totals.totalChange) : "";
  if (column.key === "unitChange") value = totals.hasComparison ? formatNumber(totals.totalUnitChange) : "";
  if (column.key === "changePct") value = totals.hasComparison ? (totals.totalChangePct === null ? "n/a" : formatPercent(totals.totalChangePct)) : "";
  if (column.key === "unitChangePct") {
    const unitChangePct = totals.hasComparison ? percentChange(totals.totalUnits, totals.totalCompareUnits) : null;
    value = totals.hasComparison ? (unitChangePct === null ? "n/a" : formatPercent(unitChangePct)) : "";
  }
  return `<td class="${tableCellClass(column)}">${value}</td>`;
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

function handleRegionalProductRegionChange() {
  state.regionalProductRegion = getRegionalProductRegionFilter();
  if (state.viewDirty.regional) {
    renderRegionalView();
    state.viewDirty.regional = false;
    return;
  }
  renderRegionalTopProducts(getVisibleRegionalTopProducts());
  renderRegionalBreakdownTables();
  state.viewDirty.regional = false;
}

function handleRegionalProductSortChange() {
  state.viewDirty.regional = true;
  renderDashboardView("regional");
}

function getRegionalProductRegionFilter() {
  const value = dom.regionalProductRegion?.value || state.regionalProductRegion || "all";
  if (value === "all") return "all";
  return REGION_DEFS.some((region) => region.label === value) ? value : "all";
}

function getVisibleRegionalTopProducts(rows = state.regionalProductRows || []) {
  const region = getRegionalProductRegionFilter();
  state.regionalProductRegion = region;
  if (dom.regionalProductRegion && dom.regionalProductRegion.value !== region) {
    dom.regionalProductRegion.value = region;
  }
  return region === "all" ? rows : rows.filter((row) => row.region === region);
}

function getRegionalScopedRecords(records = []) {
  const region = getRegionalProductRegionFilter();
  return region === "all" ? records : records.filter((record) => record.region === region);
}

function renderRegionalBreakdownTables() {
  const current = getRegionalScopedRecords(state.regionalCurrentRecords || []);
  const comparison = getRegionalScopedRecords(state.regionalComparisonRecords || []);
  const hasComparison = Boolean(state.regionalHasComparison);
  const region = getRegionalProductRegionFilter();
  const regionText = region === "all" ? "selected regions" : region;

  const brandBreakdown = buildMetricBreakdown(current, comparison, hasComparison, "brand");
  const franchiseBreakdown = buildMetricBreakdown(current, comparison, hasComparison, "franchise");

  state.regionalBrandRows = brandBreakdown.rows;
  state.regionalBrandTotals = brandBreakdown.totals;
  state.regionalFranchiseRows = franchiseBreakdown.rows;
  state.regionalFranchiseTotals = franchiseBreakdown.totals;

  renderMetricBreakdownHeader(dom.regionalBrandThead, "regional-brand", "Brand");
  renderMetricBreakdownHeader(dom.regionalFranchiseThead, "regional-franchise", "Franchise");

  renderMetricBreakdownTable(
    dom.regionalBrandTbody,
    sortMetricBreakdownRows(state.regionalBrandRows, "regional-brand"),
    state.regionalBrandTotals,
    `No brand breakdown results for ${regionText}.`
  );
  renderMetricBreakdownTable(
    dom.regionalFranchiseTbody,
    sortMetricBreakdownRows(state.regionalFranchiseRows, "regional-franchise"),
    state.regionalFranchiseTotals,
    `No franchise breakdown results for ${regionText}.`
  );
  updateSortHeaderStates();
}

function renderRegionalTopProducts(rows) {
  if (!dom.regionalProductsTbody) return;

  if (!rows.length) {
    const region = getRegionalProductRegionFilter();
    const regionText = region === "all" ? "selected period and filters" : `${region} with the selected period and filters`;
    dom.regionalProductsTbody.innerHTML = `<tr><td colspan="8">No regional product results for ${escapeHtml(regionText)}</td></tr>`;
    return;
  }

  dom.regionalProductsTbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.region)}</td>
      <td class="numeric">${numberFormat.format(row.rank)}</td>
      <td class="numeric rank-change ${getRankChangeClass(row.rankChange)}">${escapeHtml(row.rankChange)}</td>
      <td>${renderClip(row.productTitle)}</td>
      <td>${renderClip(row.sku)}</td>
      <td>${renderClip(row.status)}</td>
      <td class="numeric">${formatCurrency(row.netSales)}</td>
      <td class="numeric">${formatNumber(row.netUnits)}</td>
    </tr>
  `).join("");
}

function renderTradeMeeting(filteredRecords) {
  if (!dom.tradeBrandTbody) return;

  const periods = getTradePeriods();
  const current = filteredRecords.filter((record) => inDateRange(record, periods.current.start, periods.current.end));
  const comparisonSource = periods.comparison
    ? filteredRecords.filter((record) => inDateRange(record, periods.comparison.start, periods.comparison.end))
    : [];
  const comparison = applyComparisonBasis(comparisonSource, periods.comparisonBasis);
  const hasComparison = Boolean(periods.comparison);

  const currentSummary = summarize(current);
  const comparisonSummary = summarize(comparison);
  const statusRows = buildTradeBreakdownRows(current, comparison, hasComparison, getTradeStatusCategory, ["Full Price", "Markdown"]);
  const groupRows = buildTradeBreakdownRows(current, comparison, hasComparison, getTradeProductGroup, ["Footwear", "Apparel", "Accessories"]);
  const brandRows = buildTradeBrandRows(current, comparison, hasComparison);
  const regionalRows = buildTradeRegionalTopProducts(current, comparison, hasComparison);

  state.tradePeriods = periods;
  state.tradeBrandRows = brandRows;
  state.tradeRegionalRows = regionalRows;

  dom.tradeWeekLabel.textContent = `${formatTradeDateRange(periods.current)} | Compare ${formatTradeDateRange(periods.comparison)} (${periods.comparisonBasis.label})`;
  renderTradeAnalysis(buildTradeAnalysisBullets({
    currentSummary,
    comparisonSummary,
    hasComparison,
    statusRows,
    groupRows,
    brandRows,
    currentRecords: current
  }));
  renderTradeSummaryGrid(dom.tradeStatusSummary, statusRows);
  renderTradeSummaryGrid(dom.tradeGroupSummary, groupRows);
  renderTradeBrandTable(brandRows.slice(0, 10));
  renderTradeRegionalSections(regionalRows);
}

function getTradePeriods() {
  const periods = getAppliedPeriods();
  const current = getFiscalWeekRangeForSelection(periods.currentStart, periods.currentEnd);
  let comparison = null;
  let comparisonBasis = getComparisonBasis(periods);

  if (comparisonBasis.hasComparison) {
    comparison = {
      start: comparisonBasis.sourceStart,
      end: comparisonBasis.sourceEnd
    };
  } else if (current) {
    comparison = getPreviousFiscalWeekRange(current);
    comparisonBasis = {
      requestedMode: "total",
      mode: "total",
      label: "Previous Week",
      sourceStart: comparison.start,
      sourceEnd: comparison.end,
      scale: 1,
      hasComparison: true
    };
  }

  return { current, comparison, comparisonBasis };
}

function getFiscalWeekRangeForSelection(startKey, endKey) {
  if (startKey && endKey && isExactFiscalWeek(startKey, endKey)) {
    return { start: startKey, end: endKey };
  }

  const summary = getDatasetDateSummary();
  const anchor = endKey || startKey || summary?.max || todayKey();
  return getFiscalWeekRange(anchor);
}

function getFiscalWeekRange(anchorKey) {
  const anchor = dateFromKey(anchorKey);
  const start = addDays(anchor, -anchor.getUTCDay());
  const end = addDays(start, 6);
  return {
    start: dateKey(start),
    end: dateKey(end)
  };
}

function getPreviousFiscalWeekRange(range) {
  const end = addDays(dateFromKey(range.start), -1);
  const start = addDays(end, -6);
  return {
    start: dateKey(start),
    end: dateKey(end)
  };
}

function isExactFiscalWeek(startKey, endKey) {
  const start = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const days = Math.round((end - start) / 86400000);
  return start.getUTCDay() === 0 && days === 6;
}

function buildTradeBreakdownRows(currentRecords, comparisonRecords, hasComparison, getter, labels) {
  const currentMap = aggregateTradeBreakdown(currentRecords, getter);
  const comparisonMap = hasComparison ? aggregateTradeBreakdown(comparisonRecords, getter) : new Map();

  return labels.map((label) => {
    const current = currentMap.get(label) || emptyMetricAggregate();
    const comparison = comparisonMap.get(label) || emptyMetricAggregate();
    const change = hasComparison ? current.netSales - comparison.netSales : null;
    return {
      label,
      netSales: current.netSales,
      netUnits: current.netUnits,
      compareSales: hasComparison ? comparison.netSales : null,
      change,
      changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null
    };
  });
}

function aggregateTradeBreakdown(records, getter) {
  const map = new Map();
  for (const record of records) {
    const label = getter(record);
    if (!label || label === BLANK) continue;
    if (!map.has(label)) map.set(label, emptyMetricAggregate());
    const aggregate = map.get(label);
    aggregate.netSales += metricValue(record, "netSales");
    aggregate.netUnits += metricValue(record, "netUnits");
  }
  return map;
}

function emptyMetricAggregate() {
  return {
    netSales: 0,
    netUnits: 0
  };
}

function getTradeStatusCategory(record) {
  const status = normalizeStatus(record.status);
  if (status === "Full Price" || status === "Markdown") return status;
  return "";
}

function getTradeProductGroup(record) {
  const text = `${cleanText(record.group)} ${cleanText(record.department)}`.toLocaleLowerCase();
  if (text.includes("footwear")) return "Footwear";
  if (text.includes("apparel")) return "Apparel";
  if (text.includes("accessor")) return "Accessories";
  return cleanText(record.group) || cleanText(record.department) || BLANK;
}

function buildTradeBrandRows(currentRecords, comparisonRecords, hasComparison) {
  const currentMap = aggregateTradeBrands(currentRecords);
  const comparisonMap = hasComparison ? aggregateTradeBrands(comparisonRecords) : new Map();
  const keys = new Set([...currentMap.keys(), ...comparisonMap.keys()]);

  return Array.from(keys)
    .map((brand) => {
      const current = currentMap.get(brand) || emptyTradeBrandAggregate(brand);
      const comparison = comparisonMap.get(brand) || emptyTradeBrandAggregate(brand);
      const change = hasComparison ? current.netSales - comparison.netSales : null;
      const topSkus = Array.from(current.products.values())
        .sort((a, b) => b.netSales - a.netSales || collator.compare(a.productTitle, b.productTitle))
        .slice(0, 3);

      return {
        brand,
        netSales: current.netSales,
        netUnits: current.netUnits,
        compareSales: hasComparison ? comparison.netSales : null,
        change,
        changePct: hasComparison ? percentChange(current.netSales, comparison.netSales) : null,
        topSkus,
        keySkuText: formatTradeKeySkus(topSkus)
      };
    })
    .filter((row) => row.netSales !== 0 || row.netUnits !== 0)
    .sort((a, b) => b.netSales - a.netSales || collator.compare(a.brand, b.brand));
}

function aggregateTradeBrands(records) {
  const map = new Map();
  for (const record of records) {
    const brand = cleanDimension(record.brand);
    if (isHiddenResultValue(brand)) continue;
    if (!map.has(brand)) map.set(brand, emptyTradeBrandAggregate(brand));
    const aggregate = map.get(brand);
    aggregate.netSales += metricValue(record, "netSales");
    aggregate.netUnits += metricValue(record, "netUnits");

    const productKey = getProductKey(record);
    if (!aggregate.products.has(productKey)) {
      aggregate.products.set(productKey, {
        productKey,
        sku: formatDisplaySku(record.sku) || BLANK,
        productTitle: record.productTitle || BLANK,
        netSales: 0,
        netUnits: 0,
        statusBreakdown: new Map()
      });
    }
    const product = aggregate.products.get(productKey);
    product.netSales += metricValue(record, "netSales");
    product.netUnits += metricValue(record, "netUnits");
    addStatusBreakdown(product.statusBreakdown, record);
  }

  for (const aggregate of map.values()) {
    for (const product of aggregate.products.values()) {
      product.status = getStatusLabel(product.statusBreakdown);
    }
  }

  return map;
}

function emptyTradeBrandAggregate(brand) {
  return {
    brand,
    netSales: 0,
    netUnits: 0,
    products: new Map()
  };
}

function formatTradeKeySkus(products) {
  return products
    .map((product) => `${product.sku} | ${product.productTitle} (${formatCurrency(product.netSales)})`)
    .join("; ");
}

function buildTradeAnalysisBullets({ currentSummary, comparisonSummary, hasComparison, statusRows, groupRows, brandRows, currentRecords }) {
  const topStatus = getTopMetricRow(statusRows);
  const topGroup = getTopMetricRow(groupRows);
  const topBrand = brandRows[0];
  const nextBrands = brandRows.slice(1, 3);
  const biggestGain = hasComparison ? brandRows.slice().sort((a, b) => (b.change || 0) - (a.change || 0))[0] : null;
  const biggestDecline = hasComparison ? brandRows.slice().sort((a, b) => (a.change || 0) - (b.change || 0))[0] : null;
  const topProducts = Array.from(aggregateProducts(currentRecords).values())
    .sort((a, b) => b.netSales - a.netSales || collator.compare(a.productTitle, b.productTitle))
    .slice(0, 3);
  const mixDrivers = [
    topStatus ? `${topStatus.label} was the lead price bucket at ${formatCurrency(topStatus.netSales)}` : "",
    topGroup ? `${topGroup.label} was the lead product group at ${formatCurrency(topGroup.netSales)}` : ""
  ].filter(Boolean);
  const opening = `Fiscal week ${formatTradeDateRange(state.tradePeriods?.current)} delivered ${formatCurrency(currentSummary.netSales)} on ${formatNumber(currentSummary.netUnits)} units${hasComparison ? `, ${formatTradeMovement(currentSummary.netSales, comparisonSummary.netSales)} versus the compare week` : ""}.${mixDrivers.length ? ` ${mixDrivers.join("; ")}.` : ""}`;
  const narrative = [opening];

  if (topBrand) {
    const supportingBrands = nextBrands.length
      ? ` Supporting brand volume came from ${formatTradeBrandDriverList(nextBrands)}.`
      : "";
    narrative.push(`${topBrand.brand} anchored brand performance at ${formatCurrency(topBrand.netSales)}${hasComparison ? `, ${formatTradeMovement(topBrand.netSales, topBrand.compareSales)}` : ""}. Its key SKU drivers were ${topBrand.keySkuText || "not available"}.${supportingBrands}`);
  }

  if (topProducts.length) {
    narrative.push(`Product demand was concentrated in ${formatTradeProductDriverList(topProducts)}, giving the week its clearest SKU-level sales drivers.`);
  }

  if (hasComparison && biggestGain && biggestGain.change > 0) {
    const declineText = biggestDecline && biggestDecline.change < 0
      ? `, while ${biggestDecline.brand} was the largest brand faller, down ${formatCurrency(Math.abs(biggestDecline.change))}${biggestDecline.changePct === null ? "" : ` (${formatSignedPercent(biggestDecline.changePct)})`}`
      : "";
    narrative.push(`Momentum was led by ${biggestGain.brand}, up ${formatCurrency(Math.abs(biggestGain.change))}${biggestGain.changePct === null ? "" : ` (${formatSignedPercent(biggestGain.changePct)})`}${declineText}.`);
  }

  return narrative.filter((item) => cleanText(item));
}

function formatTradeBrandDriverList(brands) {
  return brands
    .map((brand) => `${brand.brand} (${formatCurrency(brand.netSales)})`)
    .join(" and ");
}

function formatTradeProductDriverList(products) {
  return products
    .map((product) => `${product.sku} | ${product.productTitle} (${formatCurrency(product.netSales)}, ${formatNumber(product.netUnits)} units)`)
    .join("; ");
}

function getTopMetricRow(rows) {
  return rows
    .filter((row) => row.netSales !== 0 || row.netUnits !== 0)
    .sort((a, b) => b.netSales - a.netSales || b.netUnits - a.netUnits)[0] || null;
}

function renderTradeAnalysis(bullets) {
  dom.tradeAnalysis.innerHTML = bullets.length
    ? `<div class="trade-narrative">${bullets.map((bullet) => `<p>${escapeHtml(bullet)}</p>`).join("")}</div>`
    : `<div class="empty-state">No weekly trade analysis available</div>`;
}

function renderTradeSummaryGrid(target, rows) {
  target.innerHTML = rows.map((row) => `
    <article class="trade-summary-card">
      <span>${escapeHtml(row.label)}</span>
      <strong>${formatCurrency(row.netSales)}</strong>
      <em>${formatNumber(row.netUnits)} units</em>
      <small class="${getDeltaClass({ hasComparison: row.change !== null, change: row.change }, "change")}">${row.change === null ? "" : `${formatCurrency(row.change)} ${row.changePct === null ? "n/a" : formatSignedPercent(row.changePct)}`}</small>
    </article>
  `).join("");
}

function renderTradeBrandTable(rows) {
  if (!rows.length) {
    dom.tradeBrandTbody.innerHTML = `<tr><td colspan="6">No brand results for the fiscal week and filters</td></tr>`;
    return;
  }

  dom.tradeBrandTbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${renderClip(row.brand)}</td>
      <td class="numeric">${formatCurrency(row.netSales)}</td>
      <td class="numeric">${formatNumber(row.netUnits)}</td>
      <td class="numeric ${getDeltaClass({ hasComparison: row.change !== null, change: row.change }, "change")}">${row.change === null ? "" : formatCurrency(row.change)}</td>
      <td class="numeric ${getDeltaClass({ hasComparison: row.change !== null, change: row.change }, "changePct")}">${row.changePct === null ? "n/a" : formatSignedPercent(row.changePct)}</td>
      <td>${renderClip(row.keySkuText)}</td>
    </tr>
  `).join("");
}

function buildTradeRegionalTopProducts(records, comparisonRecords = [], hasComparison = false) {
  const rows = [];
  for (const region of getTradeRegions()) {
    const regionalRecords = records.filter((record) => record.region === region.label);
    const regionalComparisonRecords = hasComparison
      ? comparisonRecords.filter((record) => record.region === region.label)
      : [];
    const comparisonProducts = hasComparison
      ? buildProductResults(regionalComparisonRecords)
        .sort((a, b) => sortRegionalProducts(a, b, "netSales"))
        .slice(0, 20)
      : [];
    const comparisonRanks = new Map(comparisonProducts.map((product, index) => [product.productKey, index + 1]));
    const productRecords = groupRecordsByProduct(regionalRecords);
    const products = buildProductResults(regionalRecords, regionalComparisonRecords, hasComparison)
      .filter((product) => product.netSales !== 0 || product.netUnits !== 0)
      .sort((a, b) => sortRegionalProducts(a, b, "netSales"))
      .slice(0, 20);

    products.forEach((product, index) => {
      const rank = index + 1;
      const comparisonRank = comparisonRanks.get(product.productKey) || null;
      rows.push({
        region: region.label,
        rank,
        rankChange: getRankChangeLabel(rank, comparisonRank, hasComparison),
        tradeGroup: getDominantTradeCategory(productRecords.get(product.productKey) || []),
        ...product
      });
    });
  }
  return rows;
}

function getTradeRegions() {
  return REGION_DEFS.filter((region) => isDimensionValueAllowed("region", region.label));
}

function groupRecordsByProduct(records) {
  const map = new Map();
  for (const record of records) {
    const key = getProductKey(record);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}

function getDominantTradeCategory(records) {
  const map = aggregateTradeBreakdown(records, getTradeProductGroup);
  return Array.from(map.entries())
    .sort((a, b) => b[1].netSales - a[1].netSales || collator.compare(a[0], b[0]))[0]?.[0] || "";
}

function renderTradeRegionalSections(rows) {
  if (!rows.length) {
    dom.tradeRegionalSections.innerHTML = `<div class="empty-state">No regional top sellers for the fiscal week and filters</div>`;
    return;
  }

  const rowsByRegion = new Map();
  for (const row of rows) {
    if (!rowsByRegion.has(row.region)) rowsByRegion.set(row.region, []);
    rowsByRegion.get(row.region).push(row);
  }

  dom.tradeRegionalSections.innerHTML = Array.from(rowsByRegion.entries()).map(([region, regionRows]) => `
    <section class="trade-region-section">
      <div class="trade-region-head">
        <div>
          <span class="panel-kicker">${escapeHtml(region)}</span>
          <h3>${escapeHtml(region)} Top 20</h3>
        </div>
        <div class="trade-region-analysis">
          <p class="trade-region-narrative">${escapeHtml(buildTradeRegionalNarrative(region, regionRows))}</p>
          <ul>
            ${buildTradeRegionalBullets(regionRows).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
        </div>
      </div>
      <div class="table-scroll">
        <table class="trade-regional-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Product Title</th>
              <th>Net Sales</th>
              <th>Units Sold</th>
              <th>Status</th>
              <th>Pos Change</th>
            </tr>
          </thead>
          <tbody>
            ${regionRows.map((row) => `
              <tr>
                <td class="numeric">${formatNumber(row.rank)}</td>
                <td>${renderClip(row.productTitle)}</td>
                <td class="numeric">${formatCurrency(row.netSales)}</td>
                <td class="numeric">${formatNumber(row.netUnits)}</td>
                <td>${escapeHtml(row.status)}</td>
                <td class="numeric rank-change ${getRankChangeClass(row.rankChange)}">${escapeHtml(row.rankChange)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `).join("");
}

function buildTradeRegionalNarrative(region, rows) {
  if (!rows.length) return "";

  const top = rows[0];
  const totalSales = sum(rows, "netSales");
  const totalUnits = sum(rows, "netUnits");
  const topProducts = rows.slice(0, 3);
  const topProductSales = sum(topProducts, "netSales");
  const topShare = totalSales ? topProductSales / totalSales : 0;
  const salesRiser = getTradeRegionalSalesRiser(rows);
  const salesFaller = getTradeRegionalSalesFaller(rows);
  const newItems = rows.filter((row) => row.rankChange === "NEW").slice(0, 2);
  const concentration = topShare >= 0.5
    ? "Performance was concentrated in the top of the list"
    : "Performance was spread across a broader top-20 base";
  const topProductText = topProducts
    .map((row) => row.productTitle)
    .filter(Boolean)
    .join(", ");
  const momentum = [];

  if (salesRiser) {
    momentum.push(`${salesRiser.productTitle} created the strongest net-sales lift, up ${formatCurrency(Math.abs(salesRiser.change))}${salesRiser.changePct === null ? "" : ` (${formatSignedPercent(salesRiser.changePct)})`}`);
  }
  if (salesFaller) {
    momentum.push(`${salesFaller.productTitle} was the main sales drag, down ${formatCurrency(Math.abs(salesFaller.change))}${salesFaller.changePct === null ? "" : ` (${formatSignedPercent(salesFaller.changePct)})`}`);
  }
  if (newItems.length) {
    momentum.push(`${newItems.map((row) => row.productTitle).join(" and ")} entered the top 20`);
  }

  return `${region}'s top 20 delivered ${formatCurrency(totalSales)} on ${formatNumber(totalUnits)} units, led by ${top.productTitle} at ${formatCurrency(top.netSales)}. ${concentration}${topProductText ? `, with ${topProductText} representing ${formatPercent(topShare)} of sales` : ""}. ${momentum.length ? `${momentum.join("; ")}.` : "The top sellers held their position without a major week-over-week movement signal."}`;
}

function buildTradeRegionalBullets(rows) {
  const top = rows[0];
  const salesRiser = getTradeRegionalSalesRiser(rows);
  const salesFaller = getTradeRegionalSalesFaller(rows);
  const risers = rows.filter((row) => String(row.rankChange).startsWith("+"))
    .sort((a, b) => Number(b.rankChange) - Number(a.rankChange))
    .slice(0, 2);
  const fallers = rows.filter((row) => String(row.rankChange).startsWith("-"))
    .sort((a, b) => Number(a.rankChange) - Number(b.rankChange))
    .slice(0, 2);
  const newItems = rows.filter((row) => row.rankChange === "NEW").slice(0, 2);
  const bullets = [];

  if (top) bullets.push(`Top seller: ${top.productTitle} at ${formatCurrency(top.netSales)} and ${formatNumber(top.netUnits)} units.`);
  if (salesRiser) bullets.push(`Net sales riser: ${salesRiser.productTitle}, up ${formatCurrency(Math.abs(salesRiser.change))}${salesRiser.changePct === null ? "" : ` (${formatSignedPercent(salesRiser.changePct)})`}.`);
  if (salesFaller) bullets.push(`Net sales faller: ${salesFaller.productTitle}, down ${formatCurrency(Math.abs(salesFaller.change))}${salesFaller.changePct === null ? "" : ` (${formatSignedPercent(salesFaller.changePct)})`}.`);

  const movers = [
    ...risers.map((row) => `${row.productTitle} (${row.rankChange})`),
    ...fallers.map((row) => `${row.productTitle} (${row.rankChange})`),
    ...newItems.map((row) => `${row.productTitle} (NEW)`)
  ].slice(0, 4);
  if (movers.length) bullets.push(`Key movers: ${movers.join("; ")}.`);
  return bullets;
}

function getTradeRegionalSalesRiser(rows) {
  return rows
    .filter((row) => Number(row.change) > 0)
    .sort((a, b) => (b.change || 0) - (a.change || 0))[0] || null;
}

function getTradeRegionalSalesFaller(rows) {
  return rows
    .filter((row) => Number(row.change) < 0)
    .sort((a, b) => (a.change || 0) - (b.change || 0))[0] || null;
}

function summarize(records) {
  const orders = new Map();
  let netSales = 0;
  let netUnits = 0;

  for (const record of records) {
    netSales += metricValue(record, "netSales");
    netUnits += metricValue(record, "netUnits");
    if (record.orderKey && !orders.has(record.orderKey)) orders.set(record.orderKey, metricWeight(record));
  }

  return {
    netSales,
    netUnits,
    orders: sumMapValues(orders)
  };
}

function filterAnalysisRecords(records) {
  return records.filter((record) => !isExcludedAnalysisRecord(record));
}

function getAnalysisRecords() {
  return Array.isArray(state.analysisRecords) ? state.analysisRecords : filterAnalysisRecords(state.records);
}

function isExcludedAnalysisRecord(record) {
  const title = normalizeExcludedProductTitle(record?.productTitle);
  return EXCLUDED_ANALYSIS_PRODUCT_TITLES.has(title);
}

function normalizeExcludedProductTitle(value) {
  const title = cleanText(value).toLocaleLowerCase();
  return title.replace(/^\[(.*)\]$/, "$1").trim();
}

function applyDimensionFilters(records) {
  return records.filter((record) => DIMENSIONS.every((dimension) => {
    return isDimensionValueAllowed(dimension.key, record[dimension.key] || BLANK);
  }));
}

function isDimensionValueAllowed(key, value) {
  const selected = state.filters[key];
  const excluded = state.filterExclusions[key];
  if (selected?.size) return selected.has(value);
  if (state.filterAllSelected[key]) return !excluded?.has(value);
  return true;
}

function inDateRange(record, start, end) {
  if (!record.dateKey) return false;
  if (start && record.dateKey < start) return false;
  if (end && record.dateKey > end) return false;
  return true;
}

function hasComparisonPeriod(periods = getAppliedPeriods()) {
  return getComparisonBasis(periods).hasComparison;
}

function getComparisonBasis(periods = getAppliedPeriods()) {
  const requestedMode = periods.compareBasis || COMPARE_BASIS_DEFAULT;
  const currentDays = getInclusiveDateSpanDays(periods.currentStart, periods.currentEnd);

  if (requestedMode === "rolling-4-week") {
    if (!periods.currentStart || !periods.currentEnd) return noComparisonBasis(requestedMode);
    const sourceEndDate = addDays(dateFromKey(periods.currentStart), -1);
    const sourceStartDate = addDays(sourceEndDate, -27);
    return {
      requestedMode,
      mode: "rolling-4-week",
      label: COMPARE_BASIS_LABELS["rolling-4-week"],
      sourceStart: dateKey(sourceStartDate),
      sourceEnd: dateKey(sourceEndDate),
      scale: 1 / 4,
      hasComparison: true
    };
  }

  if (!periods.compareStart || !periods.compareEnd) return noComparisonBasis(requestedMode);

  const compareDays = getInclusiveDateSpanDays(periods.compareStart, periods.compareEnd);
  let mode = requestedMode;
  if (mode === "auto") {
    mode = isExactFiscalWeek(periods.currentStart, periods.currentEnd) && compareDays > currentDays
      ? "average-week"
      : "total";
  }

  let scale = 1;
  if (mode === "average-week") {
    scale = 1 / Math.max(1, countFiscalWeeksInRange(periods.compareStart, periods.compareEnd));
  } else if (mode === "average-period") {
    scale = compareDays ? currentDays / compareDays : 1;
  }

  return {
    requestedMode,
    mode,
    label: mode === "total" && requestedMode === "auto" ? "Auto Total" : COMPARE_BASIS_LABELS[mode] || COMPARE_BASIS_LABELS.total,
    sourceStart: periods.compareStart,
    sourceEnd: periods.compareEnd,
    scale,
    hasComparison: true
  };
}

function noComparisonBasis(requestedMode = COMPARE_BASIS_DEFAULT) {
  return {
    requestedMode,
    mode: requestedMode === "auto" ? "total" : requestedMode,
    label: COMPARE_BASIS_LABELS[requestedMode] || COMPARE_BASIS_LABELS.auto,
    sourceStart: "",
    sourceEnd: "",
    scale: 1,
    hasComparison: false
  };
}

function getInclusiveDateSpanDays(startKey, endKey) {
  if (!startKey || !endKey) return 0;
  const start = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

function countFiscalWeeksInRange(startKey, endKey) {
  if (!startKey || !endKey || startKey > endKey) return 0;
  const weeks = new Set();
  let cursor = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  while (cursor <= end) {
    weeks.add(getFiscalWeekStartKey(dateKey(cursor)));
    cursor = addDays(cursor, 1);
  }
  return weeks.size;
}

function getFiscalWeekStartKey(key) {
  const date = dateFromKey(key);
  return dateKey(addDays(date, -date.getUTCDay()));
}

function applyComparisonBasis(records, basis) {
  if (!basis?.hasComparison) return [];
  const scale = Number(basis.scale);
  if (!Number.isFinite(scale) || scale === 1) return records;
  return records.map((record) => {
    const weighted = Object.create(record);
    weighted.__metricWeight = scale;
    return weighted;
  });
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
  clearTrendSelectionState();
  state.dateTouched = true;
  dom.currentStart.value = summary.min;
  dom.currentEnd.value = summary.max;
  setPreviousPeriod(false);
  markPeriodsDirty("All dates selected. Click Apply Periods to refresh the dashboard.");
}

function setPreviousPeriod(shouldRender = true, options = {}) {
  if (!dom.currentStart.value || !dom.currentEnd.value) return;
  if (!options.preserveTrendSelection) clearTrendSelectionState();
  const currentStart = dateFromKey(dom.currentStart.value);
  const currentEnd = dateFromKey(dom.currentEnd.value);
  const days = Math.max(1, Math.round((currentEnd - currentStart) / 86400000) + 1);
  const compareEnd = addDays(currentStart, -1);
  const compareStart = addDays(compareEnd, -(days - 1));
  dom.compareStart.value = dateKey(compareStart);
  dom.compareEnd.value = dateKey(compareEnd);
  state.dateTouched = true;
  if (shouldRender !== false) {
    syncAppliedPeriodsFromInputs();
    renderAll();
  } else {
    markPeriodsDirty("Previous comparison period selected. Click Apply Periods to refresh the dashboard.");
  }
}

function getDatasetDateSummary() {
  const records = getAnalysisRecords();
  if (!records.length) return null;
  let min = "";
  let max = "";

  for (const record of records) {
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
  const rows = getVisiblePivotRows();
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
  const periods = getAppliedPeriods();
  const start = periods.currentStart || "all";
  const end = periods.currentEnd || todayKey();
  downloadFile(`product-results-${start}-to-${end}.csv`, lines.map(csvLine).join("\n"), "text/csv");
}

function exportRegionalTopProductsCsv() {
  ensureViewFresh("regional");
  const rows = getVisibleRegionalTopProducts();
  const headers = ["Region", "Rank", "Pos Change", "Product", "SKU", "Status", "Net Sales", "Net Units Sold"];
  const lines = [
    headers,
    ...rows.map((row) => [
      row.region,
      row.rank,
      row.rankChange,
      row.productTitle,
      row.sku,
      row.status,
      row.netSales,
      row.netUnits
    ])
  ];
  const periods = getAppliedPeriods();
  const start = periods.currentStart || "all";
  const end = periods.currentEnd || todayKey();
  const region = getRegionalProductRegionFilter().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all-regions";
  downloadFile(`regional-top-20-${region}-${start}-to-${end}.csv`, lines.map(csvLine).join("\n"), "text/csv");
}

function exportTradeBrandCsv() {
  ensureViewFresh("trade");
  const periods = state.tradePeriods || getTradePeriods();
  const headers = ["Fiscal Week", "Compare Week", "Brand", "Net Sales", "Net Units", "Sales Change", "Change %", "Key SKUs"];
  const rows = (state.tradeBrandRows || []).slice(0, 10);
  const lines = [
    headers,
    ...rows.map((row) => [
      formatTradeDateRange(periods.current),
      formatTradeDateRange(periods.comparison),
      row.brand,
      row.netSales,
      row.netUnits,
      row.change === null ? "" : row.change,
      row.changePct === null ? "n/a" : row.changePct,
      row.keySkuText
    ])
  ];
  downloadFile(`trade-brand-performance-${periods.current.start}-to-${periods.current.end}.csv`, lines.map(csvLine).join("\n"), "text/csv");
}

function exportTradeRegionalCsv() {
  ensureViewFresh("trade");
  const periods = state.tradePeriods || getTradePeriods();
  const headers = ["Fiscal Week", "Region", "Rank", "Product Title", "Net Sales", "Units Sold", "Status", "Pos Change"];
  const rows = state.tradeRegionalRows || [];
  const lines = [
    headers,
    ...rows.map((row) => [
      formatTradeDateRange(periods.current),
      row.region,
      row.rank,
      row.productTitle,
      row.netSales,
      row.netUnits,
      row.status,
      row.rankChange
    ])
  ];
  downloadFile(`trade-regional-top-sellers-${periods.current.start}-to-${periods.current.end}.csv`, lines.map(csvLine).join("\n"), "text/csv");
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
  if (key === "unitChange") return row.hasComparison ? row.unitChange : "";
  if (key === "unitChangePct") return row.hasComparison ? (row.unitChangePct === null ? "n/a" : row.unitChangePct) : "";
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
  if (key === "unitChangePct") return row.hasComparison ? (row.unitChangePct === null ? "n/a" : row.unitChangePct) : "";
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

function truncateText(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function cleanDimension(value) {
  const text = cleanText(value);
  if (!text || isUnassignedAttributeValue(text)) return BLANK;
  return text;
}

function removeHiddenFilterSelections(selected) {
  if (!selected) return;
  for (const value of Array.from(selected)) {
    if (isHiddenFilterValue(value)) selected.delete(value);
  }
}

function isHiddenFilterValue(value) {
  return isBlankValue(value) || isReferenceErrorValue(value) || isUnassignedAttributeValue(value);
}

function isHiddenResultValue(value) {
  return isBlankValue(value) || isUnassignedAttributeValue(value);
}

function isBlankValue(value) {
  const text = cleanText(value);
  return !text || text === BLANK;
}

function isReferenceErrorValue(value) {
  const text = cleanText(value).toUpperCase();
  return text === "#REF" || text === "#REF!";
}

function isUnassignedAttributeValue(value) {
  return UNASSIGNED_ATTRIBUTE_VALUES.has(cleanText(value).toLocaleLowerCase());
}

function isCustomerTypeValue(value) {
  return CUSTOMER_TYPE_VALUES.has(cleanText(value).toLocaleLowerCase());
}

function repairMisplacedCustomerType(record) {
  const candidateKeys = ["customerType", "collection", "franchise"];
  const misplacedValue = candidateKeys.map((key) => record[key]).find(isCustomerTypeValue);
  if (!misplacedValue) return record;

  if (isBlankValue(record.customerType) || !record.customerType || isCustomerTypeValue(record.customerType)) {
    record.customerType = cleanDimension(misplacedValue);
  }
  if (isCustomerTypeValue(record.collection)) record.collection = BLANK;
  if (isCustomerTypeValue(record.franchise)) record.franchise = BLANK;
  return record;
}

function appendItems(target, items) {
  for (let index = 0; index < items.length; index += ARRAY_APPEND_CHUNK_SIZE) {
    const end = Math.min(index + ARRAY_APPEND_CHUNK_SIZE, items.length);
    for (let itemIndex = index; itemIndex < end; itemIndex += 1) {
      target.push(items[itemIndex]);
    }
  }
}

function buildRowKeySet(records) {
  const keys = new Set();
  for (const record of records) {
    keys.add(record.rowKey);
  }
  return keys;
}

function getMaxAbsValue(rows, key) {
  let max = 1;
  for (const row of rows) {
    const value = Math.abs(Number(row[key]) || 0);
    if (value > max) max = value;
  }
  return max;
}

function hydrateRecord(record) {
  const hydrated = {
    ...record,
    ...Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, cleanDimension(record[dimension.key])])),
    franchise: cleanDimension(record.franchise),
    status: normalizeStatus(record.status, record)
  };
  repairMisplacedCustomerType(hydrated);
  hydrated.region = getRegion(hydrated.shippingProvince);
  hydrated.orderKey = getOrderKey(hydrated);
  hydrated.rowKey = cleanText(hydrated.rowKey) || `${hydrated.sourceHash}|row:${hydrated.sourceRow}`;
  return hydrated;
}

function normalizeStatus(value, record = null) {
  const status = cleanDimension(value);
  if (isReturnStatus(status) || isReturnRecord(record)) return "Return";
  if (hasCompareAtPrice(record)) return Number(record.compareAtPrice) > 0 ? "Markdown" : "Full Price";
  return status.toUpperCase() === "#VALUE" || status.toUpperCase() === "#VALUE!" ? "Full Price" : status;
}

function isReturnStatus(status) {
  return cleanText(status).toLocaleLowerCase() === "return";
}

function isReturnRecord(record) {
  if (!record) return false;
  return isTruthyFlag(record.isReturn) || (Number(record.netUnits) || 0) < 0 || (Number(record.netSales) || 0) < 0;
}

function hasCompareAtPrice(record) {
  return record && record.compareAtPrice !== null && record.compareAtPrice !== undefined && Number.isFinite(Number(record.compareAtPrice));
}

function isTruthyFlag(value) {
  const text = cleanText(value).toLocaleLowerCase();
  return text === "yes" || text === "true" || text === "1";
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
  if (isBlankValue(province) || isUnassignedAttributeValue(province)) return BLANK;
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

function metricWeight(record) {
  const weight = Number(record?.__metricWeight);
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function metricValue(record, key) {
  return (Number(record?.[key]) || 0) * metricWeight(record);
}

function addWeightedOrder(target, record) {
  if (!record?.orderKey) return;
  if (!target.has(record.orderKey)) target.set(record.orderKey, metricWeight(record));
}

function sumMapValues(map) {
  let total = 0;
  for (const value of map.values()) total += Number(value) || 0;
  return total;
}

function getAggregateOrderCount(aggregate) {
  if (aggregate?.orderWeights instanceof Map) return sumMapValues(aggregate.orderWeights);
  return aggregate?.orders?.size || 0;
}

function sum(records, key) {
  return records.reduce((total, record) => total + metricValue(record, key), 0);
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

function formatSignedPercent(value) {
  if (value === null || value === undefined) return "n/a";
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`;
}

function formatTradeDateRange(range) {
  if (!range) return "";
  return `${formatTrendDateKey(range.start)} to ${formatTrendDateKey(range.end)}`;
}

function formatTradeMovement(current, comparison) {
  const change = (Number(current) || 0) - (Number(comparison) || 0);
  const changePct = percentChange(current, comparison);
  if (change === 0) return `flat at ${formatCurrency(current)}`;
  const direction = change > 0 ? "up" : "down";
  return `${direction} ${formatCurrency(Math.abs(change))}${changePct === null ? "" : ` (${formatSignedPercent(changePct)})`}`;
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
