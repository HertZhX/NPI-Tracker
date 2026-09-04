import { describe, expect, it } from "vitest";
import { calculateSelectWidth, productOptionLabel, projectOptionLabel } from "./topbarSizing.js";

describe("Topbar 下拉框宽度", () => {
  it("为 CL2627 预留文本、内边距和原生下拉箭头空间", () => {
    expect(calculateSelectWidth(["CL2627"], { minimum: 136, maximum: 260 })).toBe("136px");
  });

  it("按最长项目代码扩展并限制最大宽度", () => {
    expect(calculateSelectWidth(["CL2627", "CUSTOMER-PROJECT-2026"], {
      minimum: 136,
      maximum: 260,
    })).toBe("260px");
  });

  it("为中文产品名称使用更宽的字符权重", () => {
    expect(calculateSelectWidth(["智能控制器主板"], { minimum: 180, maximum: 320 })).toBe("199px");
  });

  it("项目选项优先显示可修改名称，让重命名结果覆盖原显示", () => {
    expect(projectOptionLabel({ code: "2561", name: "ZS2561" })).toBe("ZS2561");
    expect(projectOptionLabel({ code: "CL2557", name: "CL2557" })).toBe("CL2557");
    expect(projectOptionLabel({ name: "无代码项目" })).toBe("无代码项目");
    expect(projectOptionLabel({ code: "ONLY-CODE" })).toBe("ONLY-CODE");
  });

  it("产品选项优先显示料号并兼容旧产品", () => {
    expect(productOptionLabel({ name: "地刷主机", partNumber: "2307-0120000" }))
      .toBe("2307-0120000 · 地刷主机");
    expect(productOptionLabel({ name: "旧产品" })).toBe("旧产品");
  });
});
