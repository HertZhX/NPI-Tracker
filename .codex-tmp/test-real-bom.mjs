import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { parseBomWorkbook } from "../src/services/bom.js";

const sourcePath = "C:/software/wechat/document/xwechat_files/wxid_bmxbv2tlfvci22_2a11/msg/file/2026-07/CL2627主控板.xlsx";
const bytes = await fs.readFile(sourcePath);
const file = {
  name: "CL2627主控板.xlsx",
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
};
const result = await parseBomWorkbook(file);
console.log(JSON.stringify({
  fileName: result.fileName,
  defaultSheetName: result.defaultSheetName,
  projectCodeHint: result.projectCodeHint,
  sheets: result.sheets.map((sheet) => ({
    name: sheet.name,
    items: sheet.items.length,
    productModel: sheet.productModel,
    assemblyCode: sheet.assemblyCode,
    version: sheet.version,
    warnings: sheet.warnings,
    fallbackCodes: sheet.items.filter((item) => item.code === item.internalCode).map((item) => item.code),
  })),
}, null, 2));

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(bytes);
const customer = workbook.getWorksheet("客户BOM");
const blankCodeRows = [];
for (let row = 5; row <= customer.actualRowCount; row += 1) {
  const code = String(customer.getCell(row, 2).value ?? "").trim();
  const comment = String(customer.getCell(row, 4).value ?? "").trim();
  const spec = String(customer.getCell(row, 5).value ?? "").trim();
  if (!code && !["NC", "DNP", "DNI", "NOT FITTED"].includes(comment.toUpperCase()) && !["NC", "DNP", "DNI", "NOT FITTED"].includes(spec.toUpperCase())) {
    blankCodeRows.push({ row, values: customer.getRow(row).values });
  }
}
console.log(JSON.stringify({ blankCodeRows }, null, 2));
