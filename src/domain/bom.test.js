import { describe, expect, it } from "vitest";
import {
  BOM_STATUS,
  bomItemFingerprint,
  bomSummaryToTaskStatus,
  summarizeBomItems,
} from "./bom.js";

describe("BOM 材料汇总", () => {
  it("按适用料号计算齐套率，并排除不适用和已移出项", () => {
    const summary = summarizeBomItems([
      { status: BOM_STATUS.READY },
      { status: BOM_STATUS.PENDING },
      { status: BOM_STATUS.NA },
      { status: BOM_STATUS.REMOVED },
    ]);

    expect(summary).toMatchObject({
      total: 3,
      applicable: 2,
      ready: 1,
      pending: 1,
      na: 1,
      removed: 1,
      readinessPct: 50,
    });
  });

  it("将缺料优先聚合为交付任务阻塞", () => {
    expect(bomSummaryToTaskStatus([
      { status: BOM_STATUS.READY },
      { status: BOM_STATUS.SHORTAGE },
    ])).toBe("blocked");
  });

  it("全部完成时将材料进度聚合为完成", () => {
    expect(bomSummaryToTaskStatus([
      { status: BOM_STATUS.READY },
      { status: BOM_STATUS.READY },
      { status: BOM_STATUS.NA },
    ])).toBe("done");
  });

  it("关键 BOM 字段变化会改变指纹", () => {
    const item = { name: "贴片电容", spec: "0.1uF", unitQuantity: 2, vendors: ["风华"] };
    expect(bomItemFingerprint(item)).not.toBe(bomItemFingerprint({ ...item, unitQuantity: 3 }));
  });
});
