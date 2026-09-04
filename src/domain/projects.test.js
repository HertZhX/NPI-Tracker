import { describe, expect, it } from "vitest";
import { addProductReferences } from "./projects.js";

describe("项目产品引用迁移", () => {
  it("把已有产品文件材料和任务统一迁移到产品的 MP 阶段", () => {
    const state = addProductReferences({
      projects: [{
        id: "project-files",
        code: "FILES",
        name: "文件迁移",
        products: [{
          id: "product-files",
          name: "文件产品",
          phases: [
            { id: "phase-files-p", type: "P" },
            { id: "phase-files-mp", type: "MP" },
          ],
        }],
      }],
      materials: [{
        id: "material-file",
        projectId: "project-files",
        productId: "product-files",
        phaseId: "phase-files-p",
        trackingScope: "product-file",
      }],
      tasks: [{
        id: "task-file",
        projectId: "project-files",
        productId: "product-files",
        phaseId: "phase-files-p",
        trackingScope: "product-file",
      }, {
        id: "task-normal",
        projectId: "project-files",
        productId: "product-files",
        phaseId: "phase-files-p",
      }],
    });

    expect(state.materials[0].phaseId).toBe("phase-files-mp");
    expect(state.tasks[0].phaseId).toBe("phase-files-mp");
    expect(state.tasks[1].phaseId).toBe("phase-files-p");
  });
});
