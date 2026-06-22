"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");
const OUTPUT_PATH = path.join(DATA_DIR, "compiled-data.json");
const COMPILED_DATA_SCHEMA_VERSION = 1;
const COMPILED_CHUNK_RECORD_LIMIT = 175000;
const BLANK = "(blank)";
const UNASSIGNED_ATTRIBUTE_VALUES = new Set(["false"]);

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
  "dateKey",
  "compareAtPrice",
  "netSales",
  "netUnits",
  "isReturn",
  "sourceFile",
  "sourceHash",
  "sourceRow",
  ...DIMENSIONS.map((dimension) => dimension.key)
];
const NUMERIC_COMPILED_FIELDS = new Set(["compareAtPrice", "netSales", "netUnits", "sourceRow"]);
const RAW_COMPILED_FIELDS = new Set(["orderId"]);

main();

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const files = normalizeManifestFiles(manifest);
  const records = [];
  const fileMetas = [];
  const dictionary = [];
  const dictionaryIndex = new Map();

  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".csv")) {
      throw new Error(`${file.path} is not a CSV file. Convert it to CSV before compiling data.`);
    }
    if (/^https?:\/\//i.test(file.path)) {
      throw new Error(`${file.path} is a remote URL. The compiler expects CSV files committed in this repository.`);
    }

    const filePath = path.join(ROOT, ...file.path.split(/[\\/]+/));
    const sourceHash = `repo:${file.path}`;
    const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = parseSalesCsv(text, file.name, sourceHash);
    const addedRecords = parsed.records.map(hydrateRecord);
    records.push(...addedRecords.map((record) => compactRecord(record, dictionary, dictionaryIndex)));
    fileMetas.push({
      hash: sourceHash,
      name: file.name,
      path: file.path,
      source: "Compiled data",
      rowsRead: parsed.records.length,
      rowsAdded: addedRecords.length,
      rowsSkipped: 0,
      minDate: parsed.minDate,
      maxDate: parsed.maxDate,
      netSales: sum(addedRecords, "netSales"),
      netUnits: sum(addedRecords, "netUnits")
    });
    console.log(`Compiled ${file.name}: ${addedRecords.length.toLocaleString()} rows`);
  }

  const chunks = writeCompiledChunks(records);
  const compiled = {
    schemaVersion: COMPILED_DATA_SCHEMA_VERSION,
    encoding: "dictionary-v1",
    builtAt: new Date().toISOString(),
    manifestSignature: getManifestSignature(files),
    fields: COMPILED_RECORD_FIELDS,
    numericFields: Array.from(NUMERIC_COMPILED_FIELDS),
    rawFields: Array.from(RAW_COMPILED_FIELDS),
    dictionary,
    files: fileMetas,
    rowCount: records.length,
    chunks
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(compiled));
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} with ${records.length.toLocaleString()} rows across ${chunks.length} chunks.`);
}

function writeCompiledChunks(records) {
  for (const entry of fs.readdirSync(DATA_DIR)) {
    if (/^compiled-data-\d{4}\.json$/i.test(entry)) {
      fs.unlinkSync(path.join(DATA_DIR, entry));
    }
  }

  const chunks = [];
  for (let index = 0; index < records.length; index += COMPILED_CHUNK_RECORD_LIMIT) {
    const chunkNumber = String(chunks.length + 1).padStart(4, "0");
    const fileName = `compiled-data-${chunkNumber}.json`;
    const chunkRecords = records.slice(index, index + COMPILED_CHUNK_RECORD_LIMIT);
    fs.writeFileSync(path.join(DATA_DIR, fileName), JSON.stringify({ records: chunkRecords }));
    chunks.push({
      path: `data/${fileName}`,
      rows: chunkRecords.length
    });
  }
  return chunks;
}

function parseSalesCsv(text, fileName, sourceHash) {
  validateCsvText(text, fileName);
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
    if (!record) continue;
    records.push(record);
    if (!minDate || record.dateKey < minDate) minDate = record.dateKey;
    if (!maxDate || record.dateKey > maxDate) maxDate = record.dateKey;
  }

  if (!records.length) {
    throw new Error(`${fileName} did not contain usable CSV rows.`);
  }

  return { records, minDate, maxDate };
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
  record.status = normalizeStatus(record.status, record);
  record.region = getRegion(record.shippingProvince);
  record.orderKey = getOrderKey(record);
  return record;
}

function hydrateRecord(record) {
  const hydrated = {
    ...record,
    ...Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, cleanDimension(record[dimension.key])])),
    franchise: cleanDimension(record.franchise),
    status: normalizeStatus(record.status, record)
  };
  hydrated.region = getRegion(hydrated.shippingProvince);
  hydrated.orderKey = getOrderKey(hydrated);
  return hydrated;
}

function compactRecord(record, dictionary, dictionaryIndex) {
  return COMPILED_RECORD_FIELDS.map((field) => {
    const value = record[field] ?? "";
    if (NUMERIC_COMPILED_FIELDS.has(field) || RAW_COMPILED_FIELDS.has(field)) return value;
    const text = String(value);
    if (!dictionaryIndex.has(text)) {
      dictionaryIndex.set(text, dictionary.length);
      dictionary.push(text);
    }
    return dictionaryIndex.get(text);
  });
}

function getFranchiseValue(cells, fieldIndex) {
  if (fieldIndex.franchise !== undefined) return cleanDimension(cells[fieldIndex.franchise]);
  if (fieldIndex.collection !== undefined) return cleanDimension(cells[fieldIndex.collection]);
  return BLANK;
}

function validateCsvText(text, fileName) {
  const preview = text.slice(0, 500).trim();
  const lowerPreview = preview.toLowerCase();

  if (lowerPreview.startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(`${fileName} is a Git LFS pointer, not the actual CSV file.`);
  }
  if (lowerPreview.startsWith("<!doctype html") || lowerPreview.startsWith("<html") || lowerPreview.includes("<title>")) {
    throw new Error(`${fileName} loaded as HTML instead of a CSV file.`);
  }
  if (/^(404|not found)\b/.test(lowerPreview)) {
    throw new Error(`${fileName} was not found.`);
  }
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
    return {
      dateTime: text,
      dateKey: `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`
    };
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

function getManifestSignature(files) {
  return JSON.stringify(files.map((file) => ({
    path: file.path,
    name: file.name,
    version: file.version || ""
  })));
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

function cleanDimension(value) {
  const text = cleanText(value);
  if (!text || isUnassignedAttributeValue(text)) return BLANK;
  return text;
}

function isBlankValue(value) {
  const text = cleanText(value);
  return !text || text === BLANK;
}

function isUnassignedAttributeValue(value) {
  return UNASSIGNED_ATTRIBUTE_VALUES.has(cleanText(value).toLocaleLowerCase());
}

function isScientificNotation(value) {
  return /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(cleanText(value));
}

function normalizeHeader(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fileNameFromPath(value) {
  return decodeURIComponent(cleanText(value).split("/").pop() || cleanText(value) || "Data file");
}

function dateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
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

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}
