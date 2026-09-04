import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOM_STATUS } from "../domain/bom.js";

let useNpiStore;

const BOM_ITEMS = [
  { code: "C-001", name: "贴片电容", spec: "0.1uF", unitQuantity: 2, vendors: ["风华"] },
  { code: "R-001", name: "贴片电阻", spec: "10K", unitQuantity: 1, vendors: ["厚声"] },
];

function createTestProject() {
  return useNpiStore.getState().createProject({
    id: "project-bom-test",
    code: "CL-BOM-TEST",
    name: "BOM 测试项目",
    startDate: "2026-07-25",
  });
}

function importTestBom(project, phase, items = BOM_ITEMS) {
  return useNpiStore.getState().importBomItems({
    projectId: project.id,
    phaseId: phase.id,
    meta: {
      fileName: "BOM.xlsx",
      sheetName: "厂内BOM",
      assemblyCode: "2501-TEST",
      assemblyName: "测试主控板",
      version: "V1",
    },
    items,
  });
}

describe("BOM 材料状态存储", () => {
  beforeAll(async () => {
    const data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    });
    ({ useNpiStore } = await import("./useNpiStore.js"));
  });

  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => useNpiStore.getState().resetData());
  afterEach(() => useNpiStore.getState().resetData());

  it("按阶段导入材料，并将逐料状态汇总到材料进度任务", () => {
    const project = createTestProject();
    const pPhase = project.phases.find(({ type }) => type === "P");
    const result = importTestBom(project, pPhase);

    expect(result).toMatchObject({ createdCount: 2, updatedCount: 0 });
    const importedItems = useNpiStore.getState().bomItems.filter((item) => (
      item.projectId === project.id && item.phaseId === pPhase.id
    ));
    expect(importedItems).toHaveLength(2);
    expect(importedItems.every(({ status }) => status === BOM_STATUS.PENDING)).toBe(true);

    useNpiStore.getState().updateBomItem(importedItems[0].id, { status: BOM_STATUS.READY });
    const state = useNpiStore.getState();
    const readinessTask = state.tasks.find((task) => (
      task.materialId === result.parentMaterialId && task.definitionKey === "material-readiness"
    ));
    expect(readinessTask.status).toBe("in_progress");
    expect(state.bomItems.find(({ id }) => id === importedItems[0].id)).toMatchObject({
      status: BOM_STATUS.READY,
      confirmedBy: "张伟",
      confirmedByAccountId: "account-zhangwei",
    });
    expect(state.bomItems.some((item) => item.phaseId !== pPhase.id && item.code === "C-001")).toBe(false);
  });

  it("重复导入保留未变化材料的确认状态，变化后要求复核", () => {
    const project = createTestProject();
    const pPhase = project.phases.find(({ type }) => type === "P");
    importTestBom(project, pPhase);
    const readyItem = useNpiStore.getState().bomItems.find(({ code }) => code === "C-001");
    useNpiStore.getState().updateBomItem(readyItem.id, { status: BOM_STATUS.READY });

    const unchanged = importTestBom(project, pPhase);
    expect(unchanged).toMatchObject({ createdCount: 0, updatedCount: 0, unchangedCount: 2 });
    expect(useNpiStore.getState().bomItems.find(({ id }) => id === readyItem.id).status).toBe(BOM_STATUS.READY);

    const changedItems = BOM_ITEMS.map((item) => (
      item.code === "C-001" ? { ...item, unitQuantity: 3 } : item
    ));
    const changed = importTestBom(project, pPhase, changedItems);
    expect(changed).toMatchObject({ updatedCount: 1, reviewCount: 1 });
    expect(useNpiStore.getState().bomItems.find(({ id }) => id === readyItem.id)).toMatchObject({
      status: BOM_STATUS.PENDING,
      issue: "BOM 信息已变更，请重新确认",
      confirmedBy: "",
      confirmedAt: "",
    });
  });
});
