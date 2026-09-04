export const MAX_ATTACHMENT_BATCH_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ENTITY = 20;
export const ACCEPTED_ATTACHMENT_EXTENSIONS = new Set([
  "bmp",
  "csv",
  "doc",
  "docx",
  "gif",
  "jpeg",
  "jpg",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "txt",
  "webp",
  "xls",
  "xlsx",
]);

const IMAGE_EXTENSIONS = new Set(["bmp", "gif", "jpeg", "jpg", "png", "webp"]);
const TABLE_EXTENSIONS = new Set(["csv", "xlsx"]);
const MAX_PREVIEW_ROWS = 100;
const MAX_PREVIEW_COLUMNS = 30;
const MAX_TEXT_CHARACTERS = 200_000;

export function attachmentExtension(name) {
  const normalized = String(name || "");
  return normalized.includes(".") ? normalized.split(".").pop().toLowerCase() : "";
}

export function attachmentPreviewKind(attachment) {
  const extension = attachmentExtension(attachment?.name);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "txt") return "text";
  if (TABLE_EXTENSIONS.has(extension)) return "table";
  return "unsupported";
}

export function validateAttachmentFiles(files, existingCount = 0) {
  const selected = Array.from(files || []);
  if (existingCount + selected.length > MAX_ATTACHMENTS_PER_ENTITY) {
    return `每个事项最多保留 ${MAX_ATTACHMENTS_PER_ENTITY} 个附件`;
  }
  const invalid = selected.find((file) => (
    !file.size || !ACCEPTED_ATTACHMENT_EXTENSIONS.has(attachmentExtension(file.name))
  ));
  if (invalid) {
    return `不支持附件 ${invalid.name}，请选择 PDF、图片、文本、CSV、Excel、Word 或 PowerPoint 文件`;
  }
  const totalBytes = selected.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_ATTACHMENT_BATCH_BYTES) return "单次新增附件总量不能超过 10 MB";
  return "";
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString("zh-CN", { hour12: false });
  if (typeof value !== "object") return String(value);
  if (Object.hasOwn(value, "result")) return cellText(value.result);
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.richText)) return value.richText.map(({ text }) => text).join("");
  if (typeof value.hyperlink === "string") return value.text || value.hyperlink;
  return JSON.stringify(value);
}

function parseDelimitedText(text) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";"]
    .map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 }))
    .toSorted((left, right) => right.count - left.count)[0]?.candidate ?? ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let truncated = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (rows.length < MAX_PREVIEW_ROWS) rows.push(row.slice(0, MAX_PREVIEW_COLUMNS));
      else truncated = true;
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (rows.length < MAX_PREVIEW_ROWS) rows.push(row.slice(0, MAX_PREVIEW_COLUMNS));
    else truncated = true;
  }
  const columnCount = rows.reduce((maximum, values) => Math.max(maximum, values.length), 0);
  return {
    sheetName: "CSV",
    rows,
    totalRows: rows.length + (truncated ? 1 : 0),
    totalColumns: columnCount,
    truncated,
  };
}

export async function parseAttachmentPreview(blob, name) {
  const extension = attachmentExtension(name);
  if (extension === "txt") {
    const text = await blob.text();
    return {
      text: text.slice(0, MAX_TEXT_CHARACTERS),
      truncated: text.length > MAX_TEXT_CHARACTERS,
    };
  }
  if (extension === "csv") return parseDelimitedText(await blob.text());
  if (extension !== "xlsx") throw new Error("该文件格式暂不支持在线预览");

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const worksheet = workbook.worksheets.find((sheet) => sheet.actualRowCount > 0)
    ?? workbook.worksheets[0];
  if (!worksheet) throw new Error("工作簿中没有可预览的工作表");
  const rowCount = Math.min(worksheet.actualRowCount, MAX_PREVIEW_ROWS);
  const columnCount = Math.min(worksheet.actualColumnCount, MAX_PREVIEW_COLUMNS);
  const rows = [];
  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const values = [];
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      values.push(cellText(worksheet.getCell(rowIndex, columnIndex).value));
    }
    rows.push(values);
  }
  return {
    sheetName: worksheet.name,
    rows,
    totalRows: worksheet.actualRowCount,
    totalColumns: worksheet.actualColumnCount,
    truncated: worksheet.actualRowCount > rowCount || worksheet.actualColumnCount > columnCount,
  };
}
