const HEADER_ALIASES = Object.freeze({
  code: new Set([
    "CODE", "PARTNUMBER", "PARTNO", "PN", "P/N", "ITEMNO", "ITEMNUMBER",
    "MATERIALCODE", "物料编码", "物料编号", "物料号", "料号", "编码", "厂内料号", "内部料号",
  ]),
  unitPrice: new Set([
    "PRICE", "UNITPRICE", "QUOTATION", "QUOTEDPRICE", "单价", "含税单价", "未税单价",
    "报价", "报价单价", "采购单价", "材料单价",
  ]),
  currency: new Set(["CURRENCY", "CUR", "币种", "货币", "货币单位"]),
  vendor: new Set(["VENDOR", "SUPPLIER", "MANUFACTURER", "供应商", "厂商", "制造商", "品牌"]),
  name: new Set(["NAME", "DESCRIPTION", "MATERIALNAME", "PARTNAME", "品名", "名称", "物料名称", "描述"]),
});

const CURRENCY_SYMBOLS = Object.freeze({
  "¥": "CNY",
  "￥": "CNY",
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
});

function cellValue(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text != null) return value.text;
    if (value.result != null) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  }
  return value;
}

function cellText(cell) {
  const text = String(cell?.text ?? "").trim();
  if (text) return text;
  return String(cellValue(cell) ?? "").trim();
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/[\s_：:（）()【】\[\]·.\-]/g, "")
    .toLocaleUpperCase();
}

export function normalizeQuotationCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[‐‑‒–—﹘﹣－]/g, "-")
    .replace(/\.0+$/, "")
    .trim()
    .toLocaleUpperCase();
}

function compactCode(value) {
  return normalizeQuotationCode(value).replace(/[^0-9A-Z\u4E00-\u9FFF]/g, "");
}

function fieldForHeader(value) {
  const token = normalizeHeader(value);
  if (!token) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.has(token)) return field;
  }
  if (token.includes("料号") || token.includes("物料编码") || token.includes("PARTNO")) return "code";
  if (token.includes("单价") || token.endsWith("PRICE")) return "unitPrice";
  if (token.includes("供应商") || token.includes("VENDOR") || token.includes("SUPPLIER")) return "vendor";
  if (token.includes("币种") || token.includes("CURRENCY")) return "currency";
  return null;
}

function findHeader(rows) {
  const maxRows = Math.min(rows.length, 30);
  let best = null;
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const columns = {};
    rows[rowIndex].forEach((value, columnIndex) => {
      const field = fieldForHeader(value);
      if (field && columns[field] == null) columns[field] = columnIndex;
    });
    if (columns.code == null || columns.unitPrice == null) continue;
    const score = Object.keys(columns).length;
    if (!best || score > best.score) best = { rowIndex, columns, score };
  }
  return best;
}

function inferCurrency(priceText, currencyText, headerText = "") {
  const explicit = String(currencyText || "").trim().toLocaleUpperCase();
  if (explicit) return explicit === "RMB" || explicit === "人民币" ? "CNY" : explicit.slice(0, 20);
  const combined = `${priceText} ${headerText}`;
  const symbol = Object.keys(CURRENCY_SYMBOLS).find((item) => combined.includes(item));
  if (symbol) return CURRENCY_SYMBOLS[symbol];
  const token = combined.toLocaleUpperCase();
  if (token.includes("RMB") || token.includes("CNY") || token.includes("人民币")) return "CNY";
  if (token.includes("USD")) return "USD";
  if (token.includes("EUR")) return "EUR";
  return "";
}

function normalizePrice(value) {
  const original = String(value ?? "").normalize("NFKC").trim();
  if (!original) return "";
  const numeric = original
    .replace(/[¥￥$€£]/g, "")
    .replace(/(?:CNY|RMB|USD|EUR|GBP)/gi, "")
    .replace(/[,，\s]/g, "")
    .trim();
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return "";
  const price = Number(numeric);
  return Number.isFinite(price) && price >= 0 ? numeric : "";
}

function parseRows(rows, sourceName) {
  const header = findHeader(rows);
  if (!header) return null;
  const parsedRows = [];
  const priceHeader = rows[header.rowIndex]?.[header.columns.unitPrice] ?? "";
  for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const materialCode = normalizeQuotationCode(row[header.columns.code]);
    if (!materialCode) continue;
    const rawPrice = String(row[header.columns.unitPrice] ?? "").trim();
    parsedRows.push({
      sourceRow: index + 1,
      materialCode,
      name: header.columns.name == null ? "" : String(row[header.columns.name] ?? "").trim(),
      unitPrice: normalizePrice(rawPrice),
      rawPrice,
      currency: inferCurrency(
        rawPrice,
        header.columns.currency == null ? "" : row[header.columns.currency],
        priceHeader,
      ),
      vendor: header.columns.vendor == null ? "" : String(row[header.columns.vendor] ?? "").trim(),
    });
  }
  return {
    sourceName,
    headerRow: header.rowIndex + 1,
    rows: parsedRows,
  };
}

function worksheetRows(worksheet) {
  const lastRow = worksheet.actualRowCount || worksheet.rowCount;
  const lastColumn = Math.max(worksheet.actualColumnCount, worksheet.columnCount, 1);
  const rows = [];
  for (let row = 1; row <= lastRow; row += 1) {
    const values = [];
    for (let column = 1; column <= lastColumn; column += 1) {
      values.push(cellText(worksheet.getCell(row, column)));
    }
    rows.push(values);
  }
  return rows;
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "," || character === "\t" || character === ";")) {
      row.push(value.trim());
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function csvRows(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("�")) {
    try {
      text = new TextDecoder("gb18030").decode(bytes);
    } catch {
      // Keep the UTF-8 result when GB18030 is unavailable.
    }
  }
  return parseCsvText(text.replace(/^\uFEFF/, ""));
}

export async function parseQuotationTable(file) {
  const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
  if (extension === "csv") {
    const result = parseRows(await csvRows(file), "CSV");
    if (!result?.rows.length) throw new Error("未识别到报价明细：需要包含料号和单价列");
    return { fileName: file.name, sheetName: result.sourceName, ...result };
  }
  if (extension !== "xlsx") throw new Error("整表匹配仅支持 .xlsx 或 .csv 报价单");

  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const candidates = workbook.worksheets
    .map((worksheet) => parseRows(worksheetRows(worksheet), worksheet.name))
    .filter((item) => item?.rows.length)
    .toSorted((left, right) => right.rows.length - left.rows.length);
  if (!candidates.length) throw new Error("未识别到报价明细：需要包含料号和单价列");
  const best = candidates[0];
  return { fileName: file.name, sheetName: best.sourceName, ...best };
}

function addIndex(index, key, item) {
  if (!key) return;
  const existing = index.get(key);
  if (!existing) index.set(key, item);
  else if (existing.id !== item.id) index.set(key, null);
}

export function matchQuotationRows(rows, bomItems, defaultVendor = "") {
  const exact = new Map();
  const compact = new Map();
  bomItems.forEach((item) => {
    [item.code, item.internalCode].forEach((code) => {
      addIndex(exact, normalizeQuotationCode(code), item);
      addIndex(compact, compactCode(code), item);
    });
  });

  const matches = [];
  const unmatched = [];
  const matchedItemIds = new Set();
  const codeCounts = new Map();
  rows.forEach((row) => {
    const normalized = normalizeQuotationCode(row.materialCode);
    const matchedItem = exact.get(normalized) ?? compact.get(compactCode(normalized)) ?? null;
    codeCounts.set(normalized, (codeCounts.get(normalized) ?? 0) + 1);
    if (!row.unitPrice) {
      unmatched.push({ ...row, reason: "单价无效或为空" });
      return;
    }
    if (!matchedItem) {
      unmatched.push({ ...row, reason: "BOM 中未找到该料号" });
      return;
    }
    matchedItemIds.add(matchedItem.id);
    matches.push({
      bomItemId: matchedItem.id,
      bomCode: matchedItem.code,
      bomName: matchedItem.name,
      materialCode: row.materialCode,
      sourceRow: row.sourceRow,
      unitPrice: row.unitPrice,
      currency: row.currency,
      vendor: row.vendor || defaultVendor.trim() || matchedItem.vendors?.[0] || "未指定供应商",
    });
  });

  return {
    matches,
    unmatched,
    matchedMaterialCount: matchedItemIds.size,
    duplicateRowCount: [...codeCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0),
  };
}
