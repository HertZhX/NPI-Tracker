import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BATCH_BYTES,
  attachmentPreviewKind,
  parseAttachmentPreview,
  validateAttachmentFiles,
} from "./attachmentPreview.js";

describe("attachment preview", () => {
  it("classifies browser and table preview formats", () => {
    expect(attachmentPreviewKind({ name: "drawing.PNG" })).toBe("image");
    expect(attachmentPreviewKind({ name: "report.pdf" })).toBe("pdf");
    expect(attachmentPreviewKind({ name: "notes.txt" })).toBe("text");
    expect(attachmentPreviewKind({ name: "bom.xlsx" })).toBe("table");
    expect(attachmentPreviewKind({ name: "slides.pptx" })).toBe("unsupported");
  });

  it("validates extension, count, and total upload size", () => {
    expect(validateAttachmentFiles([{ name: "safe.pdf", size: 128 }], 0)).toBe("");
    expect(validateAttachmentFiles([{ name: "unsafe.html", size: 128 }], 0)).toContain("不支持附件");
    expect(validateAttachmentFiles([{ name: "safe.pdf", size: 128 }], 20)).toContain("最多保留 20 个");
    expect(validateAttachmentFiles([
      { name: "large.pdf", size: MAX_ATTACHMENT_BATCH_BYTES + 1 },
    ], 0)).toContain("不能超过 10 MB");
  });

  it("parses quoted CSV cells for a safe table preview", async () => {
    const blob = new Blob(['料号,说明\nPN-001,"包含,逗号"\n'], { type: "text/csv" });
    const preview = await parseAttachmentPreview(blob, "交付.csv");
    expect(preview).toMatchObject({ sheetName: "CSV", totalRows: 2, totalColumns: 2 });
    expect(preview.rows[1]).toEqual(["PN-001", "包含,逗号"]);
  });

  it("loads the first populated XLSX worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("交付清单");
    worksheet.addRow(["料号", "状态"]);
    worksheet.addRow(["PN-001", "完成"]);
    const blob = new Blob([await workbook.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const preview = await parseAttachmentPreview(blob, "交付.xlsx");
    expect(preview).toMatchObject({
      sheetName: "交付清单",
      totalRows: 2,
      totalColumns: 2,
      rows: [["料号", "状态"], ["PN-001", "完成"]],
    });
  });
});
