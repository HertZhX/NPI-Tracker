import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createNpiWorkbookBuffer, parseNpiWorkbook, parseStatus } from "./excel.js";

async function createWorkbookFile() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("产品");
  sheet.getCell("A1").value = "CL2557 MP评审表";
  sheet.getCell("I2").value = "PFM";
  sheet.getCell("J2").value = "钢网";
  sheet.getCell("K2").value = "\u6ce2\u5c01\u710a\u8f7d\u5177";
  sheet.getCell("I3").value = "QE+ME";
  sheet.getCell("J3").value = "PE";
  sheet.getCell("K3").value = "PE";
  sheet.getCell("B4").value = "CL2557 MP试产";
  sheet.getCell("C4").value = "2505-2557000";
  sheet.getCell("D4").value = "CL2557;照明灯板组件";
  sheet.getCell("G4").value = 400;
  sheet.getCell("H4").value = new Date("2026-08-14T00:00:00.000Z");
  sheet.getCell("I4").value = "完成";
  sheet.getCell("J4").value = "进行中 50%";
  sheet.getCell("C5").value = "2501-2636000";
  sheet.getCell("D5").value = "CL2636地刷板S01";
  sheet.getCell("G5").value = 8144;

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    name: "推进表示例.xlsx",
    arrayBuffer: async () => buffer,
  };
}

describe("Excel 导入", () => {
  it("将 PFM 识别为 PFMEA，并保留职责", async () => {
    const result = await parseNpiWorkbook(await createWorkbookFile());
    expect(result.definitions[0]).toMatchObject({
      key: "pfmea",
      label: "PFMEA",
      defaultRole: "QE+ME",
    });
    expect(result.definitions[2]).toMatchObject({
      key: "wave-carrier",
      label: "\u6ce2\u5cf0\u710a\u8f7d\u5177",
    });
  });

  it("识别混合项目、数量、日期与任务状态", async () => {
    const result = await parseNpiWorkbook(await createWorkbookFile());
    expect(result.materials).toHaveLength(2);
    expect(result.materials[0]).toMatchObject({
      projectCode: "CL2557",
      code: "2505-2557000",
      quantity: 400,
      dueDate: "2026-08-14",
    });
    expect(result.materials[0].progress.pfmea.status).toBe("done");
    expect(result.materials[0].progress.stencil.status).toBe("in_progress");
    expect(result.materials[1].projectCode).toBe("CL2636");
    expect(result.warnings).toHaveLength(1);
  });

  it("无法识别的进度文本作为备注保留", () => {
    expect(parseStatus("等待客户确认")).toEqual({
      status: "not_reported",
      notes: "等待客户确认",
    });
  });

  it("无损识别百分比和待确认状态", () => {
    expect(parseStatus("100%").status).toBe("done");
    expect(parseStatus("0%").status).toBe("not_started");
    expect(parseStatus("待确认")).toEqual({ status: "not_reported", notes: "" });
  });

  it("导出的推进表可以按同一列规则重新导入", async () => {
    const project = { code: "CL9001" };
    const phase = { label: "MP 量产评审" };
    const definitions = [
      { key: "pfmea", label: "PFMEA", category: "资料与程序", defaultRole: "QE+ME" },
      { key: "stencil", label: "钢网", category: "工装", defaultRole: "PE" },
    ];
    const materials = [{
      id: "material-1",
      code: "9001-1001",
      name: "控制板",
      manufacturer: "示例供应商",
      quantity: 120,
      dueDate: "2026-10-16",
    }];
    const tasks = [
      { materialId: "material-1", definitionKey: "pfmea", status: "done" },
      { materialId: "material-1", definitionKey: "stencil", status: "risk" },
    ];
    const buffer = await createNpiWorkbookBuffer({ project, phase, definitions, materials, tasks });
    const result = await parseNpiWorkbook({
      name: "CL9001-export.xlsx",
      arrayBuffer: async () => buffer,
    });

    expect(result.definitions.map(({ label }) => label)).toEqual(["PFMEA", "钢网"]);
    expect(result.materials[0]).toMatchObject({
      projectCode: "CL9001",
      code: "9001-1001",
      name: "控制板",
      manufacturer: "示例供应商",
      quantity: 120,
      dueDate: "2026-10-16",
    });
    expect(result.materials[0].progress.pfmea.status).toBe("done");
    expect(result.materials[0].progress.stencil.status).toBe("risk");
  });
});
