import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let useNpiStore;

describe("项目与产品两级结构", () => {
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

  it("创建项目时按终止阶段为每个产品生成连续的适用阶段", () => {
    const project = useNpiStore.getState().createProject({
      id: "project-products-test",
      code: "CL-PRODUCTS",
      startDate: "2026-08-04",
      products: [
        { name: "主机", partNumber: "2307-0120000", version: "V1.0", manager: "张敏", managerAccountId: "account-zhangmin", stageTypes: ["P", "PP"] },
        { name: "遥控器", partNumber: "2307-0120001", version: "V2.3", manager: "李晨", managerAccountId: "account-lichen", stageTypes: ["EB"] },
      ],
    });

    expect(project.name).toBe("CL-PRODUCTS");
    expect(project).toMatchObject({ manager: "", managerAccountId: "" });
    expect(project.products.map(({ name }) => name)).toEqual(["主机", "遥控器"]);
    expect(project.products.map(({ partNumber }) => partNumber)).toEqual([
      "2307-0120000",
      "2307-0120001",
    ]);
    expect(project.products.map(({ version }) => version)).toEqual(["V1.0", "V2.3"]);
    expect(project.products.map(({ managerAccountId }) => managerAccountId)).toEqual([
      "account-zhangmin",
      "account-lichen",
    ]);
    expect(project.products.map((product) => product.phases.map(({ type }) => type))).toEqual([
      ["P", "EB", "PP"],
      ["P", "EB"],
    ]);
    const workflowItems = useNpiStore.getState().workflowItems.filter(({ projectId }) => (
      projectId === project.id
    ));
    expect(workflowItems).toHaveLength(22);
    expect(new Set(workflowItems.map(({ productId }) => productId))).toEqual(
      new Set(project.products.map(({ id }) => id)),
    );
  });

  it("项目和新品改名只更新显示名称，并保留关联数据与当前选择", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-rename",
      code: "CL-RENAME-BEFORE",
      startDate: "2026-08-04",
      products: [
        { id: "product-rename", name: "改名前新品", partNumber: "RENAME-001" },
        { id: "product-rename-existing", name: "已存在新品", partNumber: "RENAME-002" },
      ],
    });
    state.createProject({
      id: "project-rename-existing",
      code: "CL-RENAME-EXISTING",
      startDate: "2026-08-04",
      products: [{ name: "其他新品", partNumber: "OTHER-001" }],
    });
    state.selectProject(project.id);
    state.selectProduct("product-rename");

    const before = useNpiStore.getState();
    const workflowItemIds = before.workflowItems
      .filter(({ productId }) => productId === "product-rename")
      .map(({ id }) => id);
    const originalProduct = before.projects
      .find(({ id }) => id === project.id)
      .products.find(({ id }) => id === "product-rename");

    const renamedProject = before.renameProject(project.id, "  CL-RENAME-AFTER  ");
    const renamedProduct = useNpiStore.getState().renameProduct(
      project.id,
      "product-rename",
      "  改名后新品  ",
    );

    expect(renamedProject).toMatchObject({ code: "CL-RENAME-BEFORE", name: "CL-RENAME-AFTER" });
    expect(renamedProduct).toMatchObject({
      id: "product-rename",
      name: "改名后新品",
      partNumber: "RENAME-001",
    });
    const next = useNpiStore.getState();
    const nextProject = next.projects.find(({ id }) => id === project.id);
    const nextProduct = nextProject.products.find(({ id }) => id === "product-rename");
    expect(nextProject).toMatchObject({
      code: "CL-RENAME-BEFORE",
      name: "CL-RENAME-AFTER",
      productLine: "改名后新品",
    });
    expect(nextProduct.phases).toBe(originalProduct.phases);
    expect(next.workflowItems.filter(({ productId }) => productId === "product-rename").map(({ id }) => id)).toEqual(workflowItemIds);
    expect(next).toMatchObject({
      selectedProjectId: project.id,
      selectedProductId: "product-rename",
      selectedPhaseId: originalProduct.phases[0].id,
    });

    expect(next.renameProject(project.id, "cl-rename-existing")).toMatchObject({
      code: "CL-RENAME-BEFORE",
      name: "cl-rename-existing",
    });
    expect(next.renameProduct(project.id, "product-rename", "已存在新品")).toBeNull();
    const unchanged = useNpiStore.getState().projects.find(({ id }) => id === project.id);
    expect(unchanged.code).toBe("CL-RENAME-BEFORE");
    expect(unchanged.products.find(({ id }) => id === "product-rename").name).toBe("改名后新品");
  });

  it("产品版本以文本方式保存并可更新，不影响阶段和任务", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-version",
      code: "CL-VERSION",
      products: [{ id: "product-version", name: "版本产品", partNumber: "VERSION-001", version: "V1.0" }],
    });
    const product = project.products[0];
    const workflowItemIds = useNpiStore.getState().workflowItems.map(({ id }) => id);

    const updated = state.updateProductDetails(project.id, product.id, {
      name: "版本产品",
      partNumber: "VERSION-002",
      version: "  V1.1  ",
    });

    expect(updated).toMatchObject({ id: product.id, partNumber: "VERSION-002", version: "V1.1" });
    expect(updated.phases).toBe(product.phases);
    expect(useNpiStore.getState().workflowItems.map(({ id }) => id)).toEqual(workflowItemIds);
    expect(useNpiStore.getState().updateProductDetails(project.id, product.id, {
      name: "版本产品",
      version: "",
    })).toBeNull();
  });

  it("新增产品和材料后，数据只归属当前产品", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-product-scope",
      code: "CL-SCOPE",
      startDate: "2026-08-04",
      products: [{ name: "控制板", partNumber: "CTRL-001", manager: "张敏", managerAccountId: "account-zhangmin" }],
    });
    const added = state.addProduct(project.id, {
      name: "显示板",
      partNumber: "DISPLAY-001",
      manager: "李晨",
      managerAccountId: "account-lichen",
      startDate: "2026-08-05",
    });
    const refreshed = useNpiStore.getState().projects.find(({ id }) => id === project.id);
    const pPhase = refreshed.products.find(({ id }) => id === added.id).phases.find(({ type }) => type === "P");

    state.addMaterial({
      projectId: project.id,
      productId: added.id,
      phaseId: pPhase.id,
      code: "DISPLAY-PCBA",
      name: "显示板 PCBA",
      quantity: 20,
    });

    const material = useNpiStore.getState().materials.find(({ code }) => code === "DISPLAY-PCBA");
    expect(material).toMatchObject({ projectId: project.id, productId: added.id, phaseId: pPhase.id });
    expect(added).toMatchObject({
      partNumber: "DISPLAY-001",
      manager: "李晨",
      managerAccountId: "account-lichen",
    });
    const materialTasks = useNpiStore.getState().tasks.filter(({ materialId }) => materialId === material.id);
    expect(materialTasks.length).toBeGreaterThan(0);
    expect(materialTasks.every(({ productId }) => productId === added.id)).toBe(true);
    expect(useNpiStore.getState()).toMatchObject({
      selectedProjectId: project.id,
      selectedProductId: added.id,
      selectedPhaseId: pPhase.id,
    });
  });

  it("只允许按 P、EB、PP、MP 的固定顺序补加阶段", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-stage-sequence",
      code: "CL-SEQUENCE",
      startDate: "2026-08-04",
      products: [{ id: "product-stage-sequence", name: "顺序产品", partNumber: "SEQ-001" }],
    });
    const product = project.products[0];
    const ppInput = {
      type: "PP",
      label: "PP 量产验证",
      planDate: "2026-11-01",
      quantity: 100,
    };

    expect(state.addPhase(project.id, product.id, ppInput)).toBeNull();
    const ebInput = {
      type: "EB",
      label: "EB 工程验证",
      planDate: "2026-10-01",
      quantity: 30,
    };
    const eb = state.addPhase(project.id, product.id, ebInput);
    expect(eb).toMatchObject({ type: "EB", label: "EB 工程验证" });
    const added = useNpiStore.getState().addPhase(project.id, product.id, ppInput);
    expect(added).toMatchObject({ type: "PP", label: "PP 量产验证" });
    expect(useNpiStore.getState().addPhase(project.id, product.id, ppInput)).toBeNull();

    const refreshed = useNpiStore.getState().projects.find(({ id }) => id === project.id);
    expect(refreshed.products[0].phases.map(({ type }) => type)).toEqual(["P", "EB", "PP"]);
    expect(useNpiStore.getState().workflowItems.filter(({ productId }) => productId === product.id)).toHaveLength(13);
  });

  it("只撤销末尾阶段，并级联清理关联数据后切换到前一阶段", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-stage-delete",
      code: "CL-STAGE-DELETE",
      products: [{
        id: "product-stage-delete",
        name: "阶段删除产品",
        partNumber: "STAGE-DELETE-001",
        stageTypes: ["P", "PP"],
      }],
    });
    const product = project.products[0];
    const pPhase = product.phases.find(({ type }) => type === "P");
    const ebPhase = product.phases.find(({ type }) => type === "EB");
    const ppPhase = product.phases.find(({ type }) => type === "PP");
    state.addMaterial({
      projectId: project.id,
      productId: product.id,
      phaseId: ppPhase.id,
      code: "DELETE-STAGE-MATERIAL",
      name: "随阶段删除的物料",
      quantity: 1,
    });
    state.selectPhase(ppPhase.id);

    useNpiStore.getState().removeStageRecord(project.id, product.id, pPhase.id, 21);
    expect(useNpiStore.getState().projects.find(({ id }) => id === project.id).products[0].phases)
      .toHaveLength(3);
    useNpiStore.getState().removeStageRecord(project.id, product.id, ppPhase.id, 22);

    const next = useNpiStore.getState();
    const nextProduct = next.projects.find(({ id }) => id === project.id).products[0];
    expect(nextProduct.phases.map(({ id }) => id)).toEqual([pPhase.id, ebPhase.id]);
    for (const collection of [next.materials, next.tasks, next.workflowItems, next.bomItems, next.bomImports]) {
      expect(collection.some(({ phaseId }) => phaseId === ppPhase.id)).toBe(false);
    }
    expect(next).toMatchObject({ selectedPhaseId: ebPhase.id, revision: 22 });

    next.removeStageRecord(project.id, product.id, ebPhase.id, 23);
    expect(useNpiStore.getState().projects.find(({ id }) => id === project.id).products[0].phases)
      .toHaveLength(1);
  });

  it("删除产品时级联清理关联数据并切换到保留产品", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-product-delete",
      code: "CL-DELETE",
      startDate: "2026-08-04",
      products: [
        { id: "product-delete", name: "待删除产品", partNumber: "DEL-001" },
        { id: "product-keep", name: "保留产品", partNumber: "KEEP-001" },
      ],
    });
    const product = project.products.find(({ id }) => id === "product-delete");
    const phase = product.phases[0];
    state.addMaterial({
      projectId: project.id,
      productId: product.id,
      phaseId: phase.id,
      code: "DELETE-PCBA",
      name: "待删除 PCBA",
      quantity: 1,
    });
    state.selectProduct(product.id);

    useNpiStore.getState().removeProductRecord(project.id, product.id, 12);

    const next = useNpiStore.getState();
    const nextProject = next.projects.find(({ id }) => id === project.id);
    expect(nextProject.products.map(({ id }) => id)).toEqual(["product-keep"]);
    expect(next.materials.some(({ productId }) => productId === product.id)).toBe(false);
    expect(next.tasks.some(({ productId }) => productId === product.id)).toBe(false);
    expect(next.workflowItems.some(({ productId }) => productId === product.id)).toBe(false);
    expect(next).toMatchObject({
      selectedProjectId: project.id,
      selectedProductId: "product-keep",
      revision: 12,
    });
  });

  it("首次点击空文件单元格时建立独立的产品文件跟踪事项", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-product-file",
      code: "CL-FILE",
      startDate: "2026-08-04",
      endStageType: "MP",
      products: [{ id: "product-file", name: "文件产品", partNumber: "FILE-001" }],
    });
    const product = project.products[0];

    const task = state.ensureProductFileTask({
      projectId: project.id,
      productId: product.id,
      definitionKey: "dfm",
    });
    const repeated = useNpiStore.getState().ensureProductFileTask({
      projectId: project.id,
      productId: product.id,
      definitionKey: "dfm",
    });
    state.updateTask(task.id, { fileVersion: "  R02  " });

    expect(task).toMatchObject({
      projectId: project.id,
      productId: product.id,
      phaseId: product.phases.find(({ type }) => type === "MP").id,
      definitionKey: "dfm",
      trackingScope: "product-file",
    });
    expect(repeated.id).toBe(task.id);
    expect(useNpiStore.getState().tasks.find(({ id }) => id === task.id).fileVersion).toBe("  R02  ");
    expect(useNpiStore.getState().materials.filter(({ trackingScope }) => trackingScope === "product-file")).toEqual([
      expect.objectContaining({ phaseId: product.phases.find(({ type }) => type === "MP").id }),
    ]);
    expect(useNpiStore.getState().tasks.filter(({ trackingScope }) => trackingScope === "product-file")).toHaveLength(1);
  });

  it("产品未配置 MP 阶段时不建立交付物确认事项", () => {
    const state = useNpiStore.getState();
    const project = state.createProject({
      id: "project-without-mp",
      code: "CL-NO-MP",
      products: [{ id: "product-without-mp", name: "仅 P 阶段产品" }],
    });

    expect(state.ensureProductFileTask({
      projectId: project.id,
      productId: project.products[0].id,
      definitionKey: "dfm",
    })).toBeNull();
    expect(useNpiStore.getState().tasks.some(({ trackingScope }) => trackingScope === "product-file"))
      .toBe(false);
  });
});
