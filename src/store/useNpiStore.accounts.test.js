import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accountAssignmentPatch } from "../domain/accounts.js";
import { BOM_STATUS } from "../domain/bom.js";
import { createSeedData } from "../data/seed.js";

let sanitizePersistedState;
let useNpiStore;

describe("本机账号与责任人分配", () => {
  beforeAll(async () => {
    const data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    });
    ({ sanitizePersistedState, useNpiStore } = await import("./useNpiStore.js"));
  });

  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => useNpiStore.getState().resetData());
  afterEach(() => useNpiStore.getState().resetData());

  it("可创建、切换和停用非当前成员，账号名不允许重复", () => {
    const account = useNpiStore.getState().createAccount({
      username: "LiFang",
      name: "李芳",
      department: "采购部",
      jobRole: "PUR",
    });

    expect(account).toMatchObject({ username: "lifang", name: "李芳", active: true });
    expect(useNpiStore.getState().createAccount({
      username: " lifang ",
      name: "另一个人",
      department: "工程部",
      jobRole: "PE",
    })).toBeNull();
    expect(useNpiStore.getState().selectAccount(account.id)).toBe(true);
    expect(useNpiStore.getState().currentAccountId).toBe(account.id);
    expect(useNpiStore.getState().updateAccount(account.id, { active: false })).toBeNull();

    useNpiStore.getState().selectAccount("account-zhangwei");
    expect(useNpiStore.getState().updateAccount(account.id, { active: false })).toMatchObject({
      id: account.id,
      active: false,
    });
  });

  it("任务与 BOM 均按账号 ID 分配，完成确认记录当前操作人且普通编辑不覆盖", () => {
    const state = useNpiStore.getState();
    const assignee = state.accounts.find(({ id }) => id === "account-sunjie");
    const task = state.tasks[0];
    state.updateTask(task.id, accountAssignmentPatch(assignee));
    expect(useNpiStore.getState().tasks.find(({ id }) => id === task.id)).toMatchObject({
      ownerAccountId: assignee.id,
      owner: assignee.name,
      ownerRole: assignee.jobRole,
    });

    const project = state.createProject({
      id: "project-account-test",
      code: "CL-ACCOUNT",
      name: "账号分配测试",
      startDate: "2026-07-25",
      products: [{
        name: "账号分配测试产品",
        partNumber: "ACCOUNT-001",
        manager: assignee.name,
        managerAccountId: assignee.id,
      }],
    });
    const phase = project.phases.find(({ type }) => type === "P");
    state.importBomItems({
      projectId: project.id,
      phaseId: phase.id,
      meta: { fileName: "BOM.xlsx", sheetName: "BOM", assemblyCode: "TEST-PCBA" },
      items: [{ code: "C-001", name: "贴片电容", unitQuantity: 2 }],
    });
    const bomItem = useNpiStore.getState().bomItems.find(({ code }) => code === "C-001");
    expect(state.assignBomItems([bomItem.id], assignee.id)).toBe(1);
    expect(state.selectAccount(assignee.id)).toBe(true);
    expect(state.updateBomItem(bomItem.id, { status: BOM_STATUS.READY })).toBe(true);

    const confirmed = useNpiStore.getState().bomItems.find(({ id }) => id === bomItem.id);
    expect(confirmed).toMatchObject({
      ownerAccountId: assignee.id,
      confirmedBy: assignee.name,
      confirmedByAccountId: assignee.id,
      status: BOM_STATUS.READY,
    });
    expect(confirmed.confirmedAt).not.toBe("");

    state.updateBomItem(bomItem.id, { issue: "普通备注修改" });
    expect(useNpiStore.getState().bomItems.find(({ id }) => id === bomItem.id)).toMatchObject({
      confirmedBy: assignee.name,
      confirmedByAccountId: assignee.id,
      confirmedAt: confirmed.confirmedAt,
      issue: "普通备注修改",
    });
  });

  it("旧版姓名责任人自动迁移为账号 ID，并保留原项目与任务", () => {
    const legacy = createSeedData();
    const persisted = {
      ...legacy,
      projects: legacy.projects.map(({ managerAccountId: _managerAccountId, ...project }) => project),
      tasks: legacy.tasks.map(({ ownerAccountId: _ownerAccountId, ...task }) => task),
      selectedProjectId: "project-cl2557",
      selectedPhaseId: "phase-cl2557-mp",
    };

    const migrated = sanitizePersistedState(persisted);
    expect(migrated.accounts.length).toBeGreaterThan(0);
    expect(migrated.currentAccountId).toBe("account-zhangwei");
    const migratedProject = migrated.projects.find(({ id }) => id === "project-cl2557");
    expect(migratedProject).toMatchObject({ manager: "", managerAccountId: "" });
    expect(migratedProject.products[0]).toMatchObject({
      manager: "张敏",
      managerAccountId: "account-zhangmin",
    });
    expect(migrated.tasks.find(({ owner }) => owner === "孙洁").ownerAccountId)
      .toBe("account-sunjie");
  });

  it("允许持久化状态中没有项目，并清空项目与阶段选择", () => {
    const seed = createSeedData();
    const sanitized = sanitizePersistedState({
      ...seed,
      projects: [],
      materials: [],
      tasks: [],
      bomItems: [],
      bomImports: [],
      selectedProjectId: seed.projects[0].id,
      selectedPhaseId: seed.projects[0].phases[0].id,
    });

    expect(sanitized).not.toBeNull();
    expect(sanitized.projects).toEqual([]);
    expect(sanitized.selectedProjectId).toBeNull();
    expect(sanitized.selectedPhaseId).toBeNull();
  });

  it("在服务端确认删除后原子移除项目关联数据并切换选择", () => {
    const state = useNpiStore.getState();
    const removedProject = state.projects[0];
    const remainingProject = state.projects[1];

    state.selectProject(removedProject.id);
    state.removeProjectRecord(removedProject.id, 7);

    const next = useNpiStore.getState();
    expect(next.projects.some(({ id }) => id === removedProject.id)).toBe(false);
    expect(next.materials.some(({ projectId }) => projectId === removedProject.id)).toBe(false);
    expect(next.tasks.some(({ projectId }) => projectId === removedProject.id)).toBe(false);
    expect(next.bomItems.some(({ projectId }) => projectId === removedProject.id)).toBe(false);
    expect(next.bomImports.some(({ projectId }) => projectId === removedProject.id)).toBe(false);
    expect(next.selectedProjectId).toBe(remainingProject.id);
    expect(next.selectedPhaseId).toBe(
      remainingProject.phases.find(({ type }) => type === "MP")?.id,
    );
    expect(next.revision).toBe(7);
  });
});
