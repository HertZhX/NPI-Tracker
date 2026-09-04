import { describe, expect, it } from "vitest";
import { TASK_STATUS } from "./statuses.js";
import {
  ensureWorkflowState,
  getStageAdvance,
  getStageGateResult,
  isProjectWorkflowComplete,
  summarizeWorkflowItems,
} from "./workflow.js";

const LEGACY_PROJECT = {
  id: "project-legacy",
  code: "LEGACY",
  name: "旧版项目",
  productLine: "测试",
  manager: "张敏",
  managerAccountId: "account-zhangmin",
  type: "NPI",
  phases: [
    { id: "phase-legacy-eb", type: "EB", label: "EB", planDate: "2026-06-20", quantity: 30 },
    { id: "phase-legacy-mp", type: "MP", label: "MP", planDate: "2026-08-15", quantity: 200 },
    { id: "phase-legacy-mass", type: "MASS", label: "批量大货", planDate: "2026-09-20", quantity: 3000 },
  ],
};

describe("新品导入阶段门", () => {
  it("将历史跳阶段配置迁移为连续阶段链，但不补齐终止阶段之后的阶段", () => {
    const ensured = ensureWorkflowState([LEGACY_PROJECT], []);
    const project = ensured.projects[0];

    expect(project.products).toHaveLength(1);
    expect(project).toMatchObject({ manager: "", managerAccountId: "" });
    expect(project.products[0]).toMatchObject({
      name: "测试",
      partNumber: "",
      manager: "张敏",
      managerAccountId: "account-zhangmin",
    });
    expect(project.phases.map(({ type }) => type)).toEqual(["P", "EB", "PP", "MP", "MASS"]);
    expect(project.phases.find(({ type }) => type === "P")).toMatchObject({
      lifecycle: "completed",
      completionNote: "系统迁移：为保证阶段顺序补齐",
    });
    expect(project.phases.find(({ type }) => type === "EB").id).toBe("phase-legacy-eb");
    expect(project.phases.find(({ type }) => type === "MASS")).toMatchObject({
      id: "phase-legacy-mass",
      label: "批量大货",
    });
    expect(ensured.workflowItems).toHaveLength(30);
    expect(ensured.workflowItems.every(({ productId }) => productId === project.products[0].id)).toBe(true);
    expect(ensured.workflowItems.filter(({ stageType }) => stageType === "EB")).toHaveLength(5);
    expect(ensured.workflowItems.filter(({ kind }) => kind === "deliverable")).toHaveLength(14);
    expect(ensured.workflowItems.filter(({ kind }) => kind === "deliverable").every(({ stageType }) => (
      stageType === "MP"
    ))).toBe(true);
    expect(ensured.workflowItems.filter(({ stageType }) => stageType === "P").every(({ status }) => (
      status === TASK_STATUS.NA
    ))).toBe(true);
    expect(ensured.meetings.filter(({ stageType }) => stageType === "P").every(({ status }) => (
      status === "completed"
    ))).toBe(true);
    expect(ensured.workflowItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ stageType: "MP", title: "PPAP 资料初版", kind: "deliverable" }),
      expect.objectContaining({ stageType: "MP", title: "签字规格书", kind: "deliverable" }),
    ]));
  });

  it("重复初始化保持事项标识和已提交状态，并正确汇总阶段就绪度", () => {
    const initial = ensureWorkflowState([LEGACY_PROJECT], []);
    let ebIndex = 0;
    const edited = initial.workflowItems.map((item) => {
      if (item.stageType !== "EB") return item;
      const index = ebIndex;
      ebIndex += 1;
      return {
        ...item,
        status: index < 3 ? TASK_STATUS.DONE : index === 3 ? TASK_STATUS.RISK : item.status,
      };
    });
    const repeated = ensureWorkflowState(initial.projects, edited);
    const repeatedEbItems = repeated.workflowItems.filter(({ stageType }) => stageType === "EB");

    expect(repeated.workflowItems.map(({ id }) => id)).toEqual(initial.workflowItems.map(({ id }) => id));
    expect(repeatedEbItems[0].status).toBe(TASK_STATUS.DONE);
    expect(summarizeWorkflowItems(repeatedEbItems)).toMatchObject({
      applicable: 5,
      completed: 3,
      risk: 1,
      readinessPct: 60,
    });
  });

  it("保留手工新增事项和已手工修改的标准事项", () => {
    const initial = ensureWorkflowState([LEGACY_PROJECT], []);
    const standard = initial.workflowItems[0];
    const mpPhase = initial.projects[0].products[0].phases.find(({ type }) => type === "MP");
    const mpDeliverable = initial.workflowItems.find(({ key }) => key === "dfm-review-form");
    const customized = {
      ...standard,
      title: "手工调整后的事项名称",
      criterion: "按项目约定完成签核",
      customized: true,
    };
    const manual = {
      ...standard,
      id: "workflow-manual-extra",
      key: "manual-extra",
      title: "客户特殊交付文件",
      kind: "deliverable",
      source: "manual",
      customized: true,
      order: 99,
    };
    const legacyDeliverable = {
      ...mpDeliverable,
      id: "workflow-legacy-p-deliverable",
      phaseId: standard.phaseId,
      stageType: "P",
      status: TASK_STATUS.DONE,
      evidence: [{ id: "evidence-legacy", name: "DFM.xlsx" }],
    };

    const repeated = ensureWorkflowState(initial.projects, [
      customized,
      ...initial.workflowItems.slice(1).filter(({ id }) => id !== mpDeliverable.id),
      legacyDeliverable,
      manual,
    ]);

    expect(repeated.workflowItems.find(({ id }) => id === standard.id)).toMatchObject({
      title: "手工调整后的事项名称",
      criterion: "按项目约定完成签核",
      customized: true,
    });
    expect(repeated.workflowItems.find(({ id }) => id === manual.id)).toMatchObject({
      title: "客户特殊交付文件",
      source: "manual",
      phaseId: mpPhase.id,
      stageType: "MP",
    });
    expect(repeated.workflowItems.find(({ id }) => id === legacyDeliverable.id)).toMatchObject({
      phaseId: mpPhase.id,
      stageType: "MP",
      status: TASK_STATUS.DONE,
      evidence: [{ id: "evidence-legacy", name: "DFM.xlsx" }],
    });
  });

  it("只允许补充紧邻下一阶段，并以显式产品流程状态判定完结", () => {
    const phases = ["P"].map((type, index) => ({
      id: `phase-optional-${type.toLocaleLowerCase()}`,
      type,
      label: type,
      planDate: `2026-${String(index + 8).padStart(2, "0")}-01`,
      quantity: [5][index],
    }));
    const optionalProject = {
      ...LEGACY_PROJECT,
      id: "project-optional",
      phases,
    };
    const initial = ensureWorkflowState([optionalProject], []);
    const product = initial.projects[0].products[0];

    expect(getStageAdvance(product, initial.workflowItems)).toMatchObject({
      nextType: "EB",
      availableTypes: ["EB"],
      canAdd: true,
    });

    const completedConfigured = initial.workflowItems.map((item) => ({ ...item, status: TASK_STATUS.DONE }));
    expect(isProjectWorkflowComplete(initial.projects[0], completedConfigured)).toBe(false);
    const completedProject = {
      ...initial.projects[0],
      products: initial.projects[0].products.map((entry) => ({
        ...entry,
        workflowStatus: "completed",
      })),
    };
    expect(isProjectWorkflowComplete(completedProject, completedConfigured)).toBe(true);
    expect(isProjectWorkflowComplete({ ...initial.projects[0], status: "completed" }, [])).toBe(true);
  });

  it("P、EB、PP 只检查关键任务，MP 才检查产品全部交付文件", () => {
    const phases = ["P", "EB", "PP", "MP"].map((type, index) => ({
      id: `phase-gate-${type.toLocaleLowerCase()}`,
      type,
      label: type,
      planDate: `2026-${String(index + 8).padStart(2, "0")}-01`,
      quantity: [5, 30, 100, 200][index],
    }));
    const initialized = ensureWorkflowState([{
      ...LEGACY_PROJECT,
      id: "project-stage-gates",
      phases,
    }], []);
    const product = initialized.projects[0].products[0];
    const completedMeetings = initialized.meetings.map((meeting) => ({
      ...meeting,
      status: "completed",
    }));
    const onlyCheckpointsDone = initialized.workflowItems.map((item) => ({
      ...item,
      status: item.kind === "checkpoint" ? TASK_STATUS.DONE : TASK_STATUS.NOT_STARTED,
    }));

    const pGate = getStageGateResult(
      product,
      product.phases.find(({ type }) => type === "P"),
      onlyCheckpointsDone,
      completedMeetings,
    );
    expect(pGate).toMatchObject({
      checkpointReady: true,
      deliverableReady: true,
      readyForTransition: true,
    });

    const mpPhase = product.phases.find(({ type }) => type === "MP");
    const mpBlocked = getStageGateResult(product, mpPhase, onlyCheckpointsDone, completedMeetings);
    expect(mpBlocked).toMatchObject({ checkpointReady: true, deliverableReady: false });
    const allRequiredDone = onlyCheckpointsDone.map((item) => ({ ...item, status: TASK_STATUS.DONE }));
    expect(getStageGateResult(product, mpPhase, allRequiredDone, completedMeetings))
      .toMatchObject({ deliverableReady: true, readyForTransition: true });
  });
});
