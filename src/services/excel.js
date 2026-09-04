const TOOLING_LABELS = new Set([
  "钢网",
  "波峰焊载具",
  "ICT针床",
  "烧录工装",
  "FCT工装",
  "灌胶治具",
]);

const STATUS_ALIASES = [
  [/^(完成|已完成|已批准|done|ok|√|✅)$/i, "done"],
  [/(进行中|编制中|制作中|in.?progress|\d+%)/i, "in_progress"],
  [/(待审|待审核|待批准|审核中)/i, "pending_review"],
  [/(风险|risk)/i, "risk"],
  [/(阻塞|blocked|卡点)/i, "blocked"],
  [/(不适用|n\/?a)/i, "na"],
  [/(未开始|not.?started)/i, "not_started"],
];

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

function toIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86400000).toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalizeLabel(label) {
  const cleaned = String(label || "").replace(/\s+/g, "").trim();
  if (/^PFM$/i.test(cleaned)) return "PFMEA";

  // Normalize known wording variants in legacy推进表 so importing a workbook
  // does not create a duplicate delivery column beside the standard template.
  const aliases = new Map([
    ["\u6ce2\u5c01\u710a\u8f7d\u5177", "\u6ce2\u5cf0\u710a\u8f7d\u5177"],
  ]);
  return aliases.get(cleaned) || cleaned;
}

function slugify(label, index) {
  const aliases = {
    产品版本: "product-version",
    BOM: "bom",
    DFM: "dfm",
    PFMEA: "pfmea",
    质量控制计划: "control-plan",
    可制造工艺文件: "process-doc",
    检验规范: "inspection-spec",
    包装规范: "packaging-spec",
    "FAI(首件）": "fai",
    "FAI(首件)": "fai",
    烧录软件: "firmware",
    SMT程序: "smt-program",
    钢网: "stencil",
    波峰焊载具: "wave-carrier",
    ICT针床: "ict-fixture",
    烧录工装: "programming-fixture",
    FCT工装: "fct-fixture",
    灌胶治具: "potting-fixture",
    材料进度: "material-readiness",
  };
  return aliases[label] || `imported-${index}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function definitionCategory(label) {
  if (label === "材料进度") return "material";
  if (TOOLING_LABELS.has(label)) return "tooling";
  return "documents";
}

export function parseStatus(value) {
  const text = String(value ?? "").trim();
  if (!text) return { status: "not_reported", notes: "" };
  if (/^待确认$/i.test(text)) return { status: "not_reported", notes: "" };
  if (/(^|\D)100\s*%($|\D)/i.test(text)) return { status: "done", notes: "" };
  if (/^0\s*%$/i.test(text)) return { status: "not_started", notes: "" };
  const match = STATUS_ALIASES.find(([pattern]) => pattern.test(text));
  return match ? { status: match[1], notes: "" } : { status: "not_reported", notes: text };
}

export async function parseNpiWorkbook(file) {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const worksheet = workbook.getWorksheet("产品") ?? workbook.worksheets.find((sheet) => sheet.actualRowCount > 0);
  if (!worksheet) throw new Error("工作簿中没有可读取的数据工作表");

  const title = textValue(worksheet.getCell(1, 1));
  const projectCodeHint = title.match(/CL\d+/i)?.[0]?.toUpperCase() ?? "";
  const definitions = [];
  // actualColumnCount only counts non-empty columns and can under-report sparse
  // templates (for example a workbook with just PFM/PFMEA and one tooling item).
  const lastColumn = Math.max(worksheet.columnCount, worksheet.actualColumnCount, 8);

  for (let column = 9; column <= lastColumn; column += 1) {
    const label = normalizeLabel(textValue(worksheet.getCell(2, column)));
    if (!label) continue;
    definitions.push({
      key: slugify(label, column),
      label,
      category: definitionCategory(label),
      defaultRole: textValue(worksheet.getCell(3, column)) || "待分配",
      sourceColumn: column,
    });
  }

  if (!definitions.length) throw new Error("未识别到第2行的交付物表头，请检查模板格式");

  const materials = [];
  const warnings = [];
  for (let row = 4; row <= worksheet.actualRowCount; row += 1) {
    const code = textValue(worksheet.getCell(row, 3));
    if (!code) continue;
    const stageText = textValue(worksheet.getCell(row, 2));
    const name = textValue(worksheet.getCell(row, 4));
    const rowProjectCode = `${stageText} ${name}`.match(/CL\d+/i)?.[0]?.toUpperCase() ?? projectCodeHint;
    if (projectCodeHint && rowProjectCode && rowProjectCode !== projectCodeHint) {
      warnings.push(`第 ${row} 行识别为 ${rowProjectCode}，与标题项目 ${projectCodeHint} 不一致`);
    }
    const progress = Object.fromEntries(
      definitions.map((definition) => [
        definition.key,
        parseStatus(plainCellValue(worksheet.getCell(row, definition.sourceColumn))),
      ]),
    );
    materials.push({
      sourceRow: row,
      projectCode: rowProjectCode,
      code,
      name: name || code,
      manufacturer: textValue(worksheet.getCell(row, 5)),
      quantity: Number(plainCellValue(worksheet.getCell(row, 7))) || 0,
      dueDate: toIsoDate(plainCellValue(worksheet.getCell(row, 8))),
      progress,
    });
  }

  if (!materials.length) throw new Error("未识别到第4行之后的物料记录");

  return {
    fileName: file.name,
    sheetName: worksheet.name,
    title,
    projectCodeHint,
    definitions: definitions.map(({ sourceColumn: _sourceColumn, ...definition }) => definition),
    materials,
    warnings,
  };
}

export async function createNpiWorkbookBuffer({ project, phase, definitions, materials, tasks }) {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("产品", { views: [{ state: "frozen", xSplit: 4, ySplit: 3 }] });
  const columnCount = definitions.length + 8;

  worksheet.mergeCells(1, 1, 1, columnCount);
  worksheet.getCell(1, 1).value = `${project.code} ${phase.label} 进度表`;
  worksheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FF162033" } };
  worksheet.getCell(1, 1).alignment = { horizontal: "left", vertical: "middle" };
  worksheet.getRow(1).height = 30;

  // Keep the same I-column delivery layout as the source template so exported
  // workbooks can be imported again without a second mapping convention.
  const header = [
    "序号",
    "项目阶段",
    "物料编码",
    "物料名称",
    "制造商",
    "备注",
    "数量",
    "交期",
    ...definitions.map((definition) => definition.label),
  ];
  const owners = [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ...definitions.map((definition) => definition.defaultRole || ""),
  ];
  worksheet.addRow(header);
  worksheet.addRow(owners);
  worksheet.getRow(2).height = 32;
  worksheet.getRow(3).height = 22;
  for (let column = 1; column <= columnCount; column += 1) {
    for (const row of [2, 3]) {
      const cell = worksheet.getCell(row, column);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: column <= 8 ? "FFD9F1ED" : "FFFFF2B8" } };
      cell.font = { bold: row === 2, color: { argb: "FF344054" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D9E2" } },
        left: { style: "thin", color: { argb: "FFD0D9E2" } },
        bottom: { style: "thin", color: { argb: "FFD0D9E2" } },
        right: { style: "thin", color: { argb: "FFD0D9E2" } },
      };
    }
  }

  const taskLookup = new Map(tasks.map((task) => [`${task.materialId}:${task.definitionKey}`, task]));
  const statusLabels = {
    not_reported: "待确认",
    not_started: "未开始",
    in_progress: "进行中",
    pending_review: "待审核",
    done: "完成",
    risk: "风险",
    blocked: "阻塞",
    na: "N/A",
  };
  materials.forEach((material, index) => {
    worksheet.addRow([
      index + 1,
      `${project.code} ${phase.label}`,
      material.code,
      material.name,
      material.manufacturer || "",
      "",
      material.quantity || 0,
      material.dueDate || "",
      ...definitions.map((definition) => statusLabels[taskLookup.get(`${material.id}:${definition.key}`)?.status] || "待确认"),
    ]);
  });

  worksheet.getColumn(1).width = 8;
  worksheet.getColumn(2).width = 20;
  worksheet.getColumn(3).width = 18;
  worksheet.getColumn(4).width = 30;
  worksheet.getColumn(5).width = 18;
  worksheet.getColumn(6).width = 14;
  worksheet.getColumn(7).width = 10;
  worksheet.getColumn(8).width = 14;
  for (let column = 9; column <= columnCount; column += 1) worksheet.getColumn(column).width = 14;
  worksheet.autoFilter = { from: { row: 2, column: 3 }, to: { row: worksheet.rowCount, column: columnCount } };

  return workbook.xlsx.writeBuffer();
}

export async function exportNpiWorkbook(input) {
  const { project, phase } = input;
  const buffer = await createNpiWorkbookBuffer(input);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.code}-${phase.label}-进度表.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
