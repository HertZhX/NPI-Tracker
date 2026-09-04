import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { matchQuotationRows, parseQuotationTable } from "./quotation.js";

async function workbookFile(build, name = "供应商报价.xlsx") {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  return { name, size: buffer.byteLength, arrayBuffer: async () => buffer };
}

describe("报价单整表导入", () => {
  it("识别中文报价表头、单价、币种和供应商", async () => {
    const file = await workbookFile((workbook) => {
      const sheet = workbook.addWorksheet("正式报价");
      sheet.addRow(["供应商报价单"]);
      sheet.addRow(["料号", "物料名称", "含税单价", "币种", "供应商"]);
      sheet.addRow(["2307-0120000", "磁珠", 0.128, "RMB", "风华"]);
      sheet.addRow(["1010107347", "电容", "¥1.25", "", "三星"]);
    });

    const parsed = await parseQuotationTable(file);
    expect(parsed).toMatchObject({ sheetName: "正式报价", headerRow: 2 });
    expect(parsed.rows).toEqual([
      expect.objectContaining({ materialCode: "2307-0120000", unitPrice: "0.128", currency: "CNY", vendor: "风华", sourceRow: 3 }),
      expect.objectContaining({ materialCode: "1010107347", unitPrice: "1.25", currency: "CNY", vendor: "三星", sourceRow: 4 }),
    ]);
  });

  it("同时支持 CSV，并按 BOM 料号或厂内料号匹配", async () => {
    const text = "Part Number,Unit Price,Currency,Supplier\n23070120000,0.20,USD,Vendor A\n1010107347,1.50,CNY,Vendor B\nNO-MATCH,2.00,CNY,Vendor C\n";
    const bytes = new TextEncoder().encode(text);
    const parsed = await parseQuotationTable({
      name: "quote.csv",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    });
    const result = matchQuotationRows(parsed.rows, [
      { id: "bom-1", code: "2307-0120000", internalCode: "", name: "磁珠", vendors: [] },
      { id: "bom-2", code: "C-001", internalCode: "1010107347", name: "电容", vendors: [] },
    ]);

    expect(result.matchedMaterialCount).toBe(2);
    expect(result.matches).toEqual([
      expect.objectContaining({ bomItemId: "bom-1", bomCode: "2307-0120000", unitPrice: "0.20" }),
      expect.objectContaining({ bomItemId: "bom-2", bomCode: "C-001", materialCode: "1010107347" }),
    ]);
    expect(result.unmatched).toEqual([
      expect.objectContaining({ materialCode: "NO-MATCH", reason: "BOM 中未找到该料号" }),
    ]);
  });

  it("将空单价、非数字单价和重复料号反馈到预览结果", async () => {
    const text = "料号,单价\nA-01,1.25\nA-01,1.30\nB-02,待议\nC-03,\n";
    const bytes = new TextEncoder().encode(text);
    const parsed = await parseQuotationTable({
      name: "quote.csv",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    });
    const result = matchQuotationRows(parsed.rows, [
      { id: "bom-a", code: "A-01", internalCode: "", name: "A", vendors: ["默认供应商"] },
      { id: "bom-b", code: "B-02", internalCode: "", name: "B", vendors: [] },
      { id: "bom-c", code: "C-03", internalCode: "", name: "C", vendors: [] },
    ]);

    expect(result.matches).toHaveLength(2);
    expect(result.duplicateRowCount).toBe(1);
    expect(result.unmatched).toHaveLength(2);
    expect(result.unmatched.every(({ reason }) => reason === "单价无效或为空")).toBe(true);
  });

  it("拒绝没有料号和单价列的文件", async () => {
    const file = await workbookFile((workbook) => {
      workbook.addWorksheet("说明").addRow(["品名", "备注"]);
    }, "说明.xlsx");
    await expect(parseQuotationTable(file)).rejects.toThrow("需要包含料号和单价列");
  });
});
