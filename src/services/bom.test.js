import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseBomWorkbook } from "./bom.js";

async function workbookFile(build, name = "CL2627主控板.xlsx") {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  return { name, arrayBuffer: async () => buffer };
}

function addBomSheet(workbook, name, { internal = false, rows = [] } = {}) {
  const sheet = workbook.addWorksheet(name);
  sheet.getCell("F1").value = "产 品 型 号";
  sheet.getCell("G1").value = "CL2627";
  sheet.getCell("F2").value = "物 料 编 码";
  sheet.getCell("G2").value = "2501-2627000";
  sheet.getCell("F3").value = "版本号";
  sheet.getCell("G3").value = "2026.7.23";
  sheet.addRow([]);
  sheet.getRow(4).values = internal
    ? ["ITEM", "CODE", "NAME", "列1", "Comment", "SPEC", "TYPE", "PAD", "Description", "Quantity", "Designator", "VENDOR1", "MPN1"]
    : ["ITEM", "CODE", "NAME", "Comment", "SPEC", "TYPE", "PAD", "Description", "Quantity", "Designator", "VENDOR1", "MPN1"];
  rows.forEach((row) => sheet.addRow(internal
    ? [row.item, row.code, row.name, row.internalCode, row.comment, row.spec, "SMD", 2, row.package, row.quantity, row.designator, row.vendor, row.mpn]
    : [row.item, row.code, row.name, row.comment, row.spec, "SMD", 2, row.package, row.quantity, row.designator, row.vendor, row.mpn]));
  return sheet;
}

describe("BOM Excel 导入", () => {
  it("优先选择厂内 BOM，并识别项目、成品和厂内编码", async () => {
    const file = await workbookFile((workbook) => {
      workbook.addWorksheet("变更明细").addRow(["序号", "变更类型"]);
      addBomSheet(workbook, "客户BOM", { rows: [
        { item: 1, code: "2307-01", name: "磁珠", comment: "120R", spec: "120Ω", package: "0603", quantity: 2 },
      ] });
      addBomSheet(workbook, "厂内BOM", { internal: true, rows: [
        { item: 1, code: "2307-01", name: "磁珠", internalCode: 1010105015, comment: "120R", spec: "120Ω", package: "0603", quantity: 2, designator: "B2,B3", vendor: "风华", mpn: "CBW" },
      ] });
    });

    const result = await parseBomWorkbook(file);
    const internalSheet = result.sheets.find(({ name }) => name === "厂内BOM");
    expect(result.defaultSheetName).toBe("厂内BOM");
    expect(internalSheet).toMatchObject({
      projectCode: "CL2627",
      productModel: "CL2627",
      assemblyCode: "2501-2627000",
      version: "2026.7.23",
      headerRow: 4,
    });
    expect(internalSheet.items[0]).toMatchObject({
      code: "2307-01",
      internalCode: "1010105015",
      unitQuantity: 2,
      designator: "B2,B3",
      vendors: ["风华"],
      mpns: ["CBW"],
    });
  });

  it("合并相同料号并累计用量和位号", async () => {
    const file = await workbookFile((workbook) => {
      addBomSheet(workbook, "客户BOM", { rows: [
        { item: 1, code: "C-001", name: "电容", comment: "0.1uF", spec: "50V", quantity: 2, designator: "C1,C2", vendor: "风华" },
        { item: 2, code: "C-001", name: "电容", comment: "0.1uF", spec: "50V", quantity: 1, designator: "C3", vendor: "三星" },
      ] });
    });

    const result = await parseBomWorkbook(file);
    expect(result.sheets[0].items).toHaveLength(1);
    expect(result.sheets[0].items[0]).toMatchObject({
      unitQuantity: 3,
      designator: "C1, C2, C3",
      vendors: ["风华", "三星"],
    });
    expect(result.sheets[0].warnings[0]).toContain("重复");
  });

  it("拒绝没有 BOM 表头的工作簿", async () => {
    const file = await workbookFile((workbook) => {
      workbook.addWorksheet("说明").addRow(["这不是 BOM"]);
    }, "说明.xlsx");
    await expect(parseBomWorkbook(file)).rejects.toThrow("未识别到 BOM");
  });

  it("使用厂内编码补足空 CODE，并过滤 NC 行", async () => {
    const file = await workbookFile((workbook) => {
      addBomSheet(workbook, "厂内BOM", { internal: true, rows: [
        { item: 1, code: "", name: "电容", internalCode: 1010107347, comment: "10uF", spec: "25V", quantity: 1 },
        { item: 2, code: "C-NC", name: "电容", internalCode: 1010107000, comment: "NC", spec: "50V", quantity: 1 },
      ] });
    });

    const result = await parseBomWorkbook(file);
    expect(result.sheets[0].items).toHaveLength(1);
    expect(result.sheets[0].items[0]).toMatchObject({
      code: "1010107347",
      internalCode: "1010107347",
      unitQuantity: 1,
    });
  });

  it("客户 BOM 的空 CODE 可按 ITEM 从厂内 BOM 对齐", async () => {
    const file = await workbookFile((workbook) => {
      addBomSheet(workbook, "客户BOM", { rows: [
        { item: 7, code: "", name: "电容", comment: "10uF", spec: "25V", quantity: 1 },
      ] });
      addBomSheet(workbook, "厂内BOM", { internal: true, rows: [
        { item: 7, code: "", name: "电容", internalCode: 1010107347, comment: "10uF", spec: "25V", quantity: 1 },
      ] });
    });

    const result = await parseBomWorkbook(file);
    const customerSheet = result.sheets.find(({ name }) => name === "客户BOM");
    expect(customerSheet.items[0]).toMatchObject({
      code: "1010107347",
      internalCode: "1010107347",
    });
    expect(customerSheet.warnings[0]).toContain("按 ITEM 7");
  });
});
