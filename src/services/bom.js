const HEADER_ALIASES = Object.freeze({
  itemNo: new Set(["ITEM", "序号", "项次"]),
  code: new Set(["CODE", "物料编码", "料号", "物料号"]),
  name: new Set(["NAME", "物料名称", "品名", "名称"]),
  internalCode: new Set(["列1", "厂内料号", "内部料号", "ERP编码", "ERP料号"]),
  comment: new Set(["COMMENT", "规格简称", "备注规格"]),
  spec: new Set(["SPEC", "规格", "规格参数"]),
  type: new Set(["TYPE", "贴装类型", "类型"]),
  pad: new Set(["PAD", "焊盘数", "引脚数"]),
  description: new Set(["DESCRIPTION", "封装", "封装描述"]),
  quantity: new Set(["QUANTITY", "QTY", "单位用量", "用量", "数量"]),
  designator: new Set(["DESIGNATOR", "位号", "位置号"]),
});

const NOT_FITTED_TOKENS = new Set(["NC", "DNP", "DNI", "NOTFITTED"]);

function plainCellValue(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if (value.text != null) return value.text;
    if (value.result != null) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  }
  return value;
}

function textValue(cell) {
  const value = plainCellValue(cell);
  return value == null ? "" : String(value).trim();
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .replace(/[\s_：:]/g, "")
    .toLocaleUpperCase();
}

function normalizeCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[‐‑‒–—﹘﹣－]/g, "-")
    .trim()
    .toLocaleUpperCase();
}

function parseQuantity(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isNotFitted(value) {
  const token = normalizeToken(value).replace(/-/g, "");
  return NOT_FITTED_TOKENS.has(token);
}

function fieldForHeader(value, sheetName) {
  const token = normalizeToken(value);
  if (!token) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.has(token)) {
      if (field === "internalCode" && token === "列1" && !sheetName.includes("厂内")) return null;
      return field;
    }
  }
  const vendorMatch = token.match(/VENDOR(\d+)/);
  if (vendorMatch) return `vendor${vendorMatch[1]}`;
  const mpnMatch = token.match(/MPN(\d+)/);
  if (mpnMatch) return `mpn${mpnMatch[1]}`;
  if (token.includes("供应商") || token.includes("品牌")) return "vendor1";
  if (token.includes("制造商料号")) return "mpn1";
  return null;
}

function findHeader(worksheet) {
  const lastColumn = Math.max(worksheet.actualColumnCount, worksheet.columnCount, 1);
  const maxHeaderRow = Math.min(worksheet.actualRowCount || worksheet.rowCount, 30);
  for (let row = 1; row <= maxHeaderRow; row += 1) {
    const columns = {};
    for (let column = 1; column <= lastColumn; column += 1) {
      const field = fieldForHeader(textValue(worksheet.getCell(row, column)), worksheet.name);
      if (field && columns[field] == null) columns[field] = column;
    }
    if ((columns.code || columns.internalCode) && columns.quantity && (columns.name || columns.spec || columns.comment)) {
      return { row, columns };
    }
  }
  return null;
}

function nextTextOnRow(worksheet, row, startColumn) {
  const lastColumn = Math.max(worksheet.actualColumnCount, worksheet.columnCount, startColumn + 1);
  for (let column = startColumn + 1; column <= lastColumn; column += 1) {
    const value = textValue(worksheet.getCell(row, column));
    if (value) return value;
  }
  return "";
}

function readMetadata(worksheet, headerRow) {
  const metadata = { productModel: "", assemblyCode: "", version: "" };
  const lastColumn = Math.max(worksheet.actualColumnCount, worksheet.columnCount, 1);
  for (let row = 1; row < headerRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const label = normalizeToken(textValue(worksheet.getCell(row, column)));
      if (!label) continue;
      if (!metadata.productModel && label.includes("产品型号")) {
        metadata.productModel = nextTextOnRow(worksheet, row, column);
      } else if (!metadata.assemblyCode && label.includes("物料编码")) {
        metadata.assemblyCode = nextTextOnRow(worksheet, row, column);
      } else if (!metadata.version && (label.includes("版本号") || label === "版本")) {
        metadata.version = nextTextOnRow(worksheet, row, column);
      }
    }
  }
  return metadata;
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function appendCsvText(current, incoming) {
  const values = uniqueText([
    ...String(current || "").split(/[,，]\s*/),
    ...String(incoming || "").split(/[,，]\s*/),
  ]);
  return values.join(", ");
}

function parseWorksheet(worksheet, fileName) {
  const header = findHeader(worksheet);
  if (!header) return null;
  const metadata = readMetadata(worksheet, header.row);
  const warnings = [];
  const itemsByCode = new Map();
  const maxRow = worksheet.actualRowCount || worksheet.rowCount;
  const vendorFields = Object.keys(header.columns).filter((field) => field.startsWith("vendor"));
  const mpnFields = Object.keys(header.columns).filter((field) => field.startsWith("mpn"));

  for (let row = header.row + 1; row <= maxRow; row += 1) {
    const itemNo = header.columns.itemNo
      ? textValue(worksheet.getCell(row, header.columns.itemNo))
      : "";
    const sourceCode = header.columns.code
      ? textValue(worksheet.getCell(row, header.columns.code))
      : "";
    const internalCode = header.columns.internalCode
      ? textValue(worksheet.getCell(row, header.columns.internalCode))
      : "";
    const missingCode = !sourceCode && !internalCode;
    const code = normalizeCode(sourceCode || internalCode)
      || (itemNo ? `__ITEM__${normalizeToken(itemNo)}` : "");
    if (!code || normalizeToken(code) === "CODE") continue;
    const comment = header.columns.comment ? textValue(worksheet.getCell(row, header.columns.comment)) : "";
    const spec = header.columns.spec ? textValue(worksheet.getCell(row, header.columns.spec)) : "";
    if (isNotFitted(comment) || isNotFitted(spec)) continue;
    const quantityValue = plainCellValue(worksheet.getCell(row, header.columns.quantity));
    const unitQuantity = parseQuantity(quantityValue);
    if (unitQuantity == null) {
      warnings.push(`第 ${row} 行料号 ${code} 的 Quantity 无效，已跳过`);
      continue;
    }
    const item = {
      sourceRow: row,
      itemNo,
      code,
      missingCode,
      name: header.columns.name ? textValue(worksheet.getCell(row, header.columns.name)) : "",
      internalCode: normalizeCode(internalCode),
      comment,
      spec,
      type: header.columns.type ? textValue(worksheet.getCell(row, header.columns.type)) : "",
      pad: header.columns.pad ? textValue(worksheet.getCell(row, header.columns.pad)) : "",
      description: header.columns.description
        ? textValue(worksheet.getCell(row, header.columns.description))
        : "",
      unitQuantity,
      designator: header.columns.designator
        ? textValue(worksheet.getCell(row, header.columns.designator))
        : "",
      vendors: uniqueText(vendorFields.map((field) => (
        textValue(worksheet.getCell(row, header.columns[field]))
      ))),
      mpns: uniqueText(mpnFields.map((field) => (
        textValue(worksheet.getCell(row, header.columns[field]))
      ))),
    };
    item.name = item.name || item.comment || item.spec || item.code;

    const key = normalizeCode(code);
    const existing = itemsByCode.get(key);
    if (!existing) {
      itemsByCode.set(key, item);
      continue;
    }
    if (normalizeToken(existing.name) !== normalizeToken(item.name) || normalizeToken(existing.spec) !== normalizeToken(item.spec)) {
      warnings.push(`第 ${row} 行料号 ${code} 与前一行名称或规格冲突，已保留首行信息`);
    }
    existing.unitQuantity += item.unitQuantity;
    existing.designator = appendCsvText(existing.designator, item.designator);
    existing.vendors = uniqueText([...existing.vendors, ...item.vendors]);
    existing.mpns = uniqueText([...existing.mpns, ...item.mpns]);
    warnings.push(`第 ${row} 行料号 ${code} 重复，已合并用量和位号`);
  }

  const items = [...itemsByCode.values()];
  if (!items.length) return null;
  const assemblyName = String(fileName || "BOM")
    .replace(/\.[^.]+$/, "")
    .trim();
  const projectCode = (metadata.productModel || assemblyName).match(/CL\d+/i)?.[0]?.toUpperCase() ?? "";

  return {
    name: worksheet.name,
    headerRow: header.row,
    ...metadata,
    projectCode,
    assemblyName,
    items,
    warnings,
  };
}

function resolveMissingCodes(sheets) {
  const internalSheet = sheets.find((sheet) => sheet.name.includes("厂内"));
  const internalByItemNo = new Map(
    (internalSheet?.items ?? [])
      .filter((item) => item.itemNo && !item.missingCode)
      .map((item) => [normalizeToken(item.itemNo), item]),
  );

  sheets.forEach((sheet) => {
    sheet.items.forEach((item) => {
      if (!item.missingCode) return;
      const match = internalByItemNo.get(normalizeToken(item.itemNo));
      if (match && sheet !== internalSheet) {
        item.code = match.code;
        item.internalCode = match.internalCode;
        sheet.warnings.push(`第 ${item.sourceRow} 行未填写 CODE，已按 ITEM ${item.itemNo} 使用厂内编码 ${match.code}`);
      } else {
        item.code = `未编码-${item.itemNo || item.sourceRow}`;
        sheet.warnings.push(`第 ${item.sourceRow} 行未填写 CODE，暂以 ${item.code} 标识，请导入后复核`);
      }
      delete item.missingCode;
    });
    sheet.items.forEach((item) => delete item.missingCode);
  });
}

export async function parseBomWorkbook(file) {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheets = workbook.worksheets
    .map((worksheet) => parseWorksheet(worksheet, file.name))
    .filter(Boolean);
  if (!sheets.length) {
    throw new Error("未识别到 BOM：需要包含 CODE/物料编码及 NAME、SPEC 或 Comment 表头");
  }
  resolveMissingCodes(sheets);

  const defaultSheet = sheets.find((sheet) => sheet.name.includes("厂内"))
    ?? sheets.find((sheet) => sheet.name.includes("客户"))
    ?? sheets[0];
  return {
    fileName: file.name,
    sheets,
    defaultSheetName: defaultSheet.name,
    projectCodeHint: defaultSheet.projectCode,
  };
}
