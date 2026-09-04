import { TASK_STATUS } from "./statuses.js";

export const STANDARD_STAGE_TYPES = Object.freeze(["P", "EB", "PP", "MP"]);

export const STAGE_TEMPLATES = Object.freeze({
  P: Object.freeze({
    label: "P 产品验证",
    shortLabel: "产品验证",
    description: "确认产品设计可制造、可测试，并形成首轮试产结论。",
    checkpoints: Object.freeze([
      { key: "dfm-review", title: "DFM 评审", criterion: "完成跨部门 DFM 评审并关闭关键问题", role: "PE" },
      { key: "ict-coverage-review", title: "ICT 测试覆盖率评审", criterion: "ICT 测试覆盖率 > 90%", role: "TE" },
      { key: "fct-coverage-review", title: "FCT 测试覆盖率评审", criterion: "FCT 测试覆盖率达到 100%", role: "TE" },
      { key: "pilot-report", title: "试产报告输出", criterion: "输出试产结论、问题清单与后续行动", role: "PE" },
    ]),
    deliverables: Object.freeze([
      { key: "dfm-review-form", title: "DFM 评审表", role: "PE" },
      { key: "ict-fct-evaluation", title: "ICT/FCT 评估表", role: "TE" },
    ]),
  }),
  EB: Object.freeze({
    label: "EB 工程验证",
    shortLabel: "工程验证",
    description: "验证工装、测试方案、PPAP 初版与可靠性计划的可执行性。",
    checkpoints: Object.freeze([
      { key: "fixture-review", title: "工装夹具评审", criterion: "完成生产与测试工装夹具方案评审", role: "ME" },
      { key: "manual-fct", title: "手动/半自动 FCT", criterion: "手动或半自动 FCT 方案具备试产能力", role: "TE" },
      { key: "ppap-initial", title: "PPAP 资料—PFMEA/QCP", criterion: "PFMEA 与 QCP 初版完成并受控", role: "QE" },
      { key: "reliability-plan", title: "可靠性测试计划", criterion: "测试项目、样本、方法与判定标准明确", role: "RD" },
      { key: "pilot-report", title: "试产报告输出", criterion: "输出 EB 试产结论与问题点清单", role: "PE" },
    ]),
    deliverables: Object.freeze([
      { key: "reliability-test-plan", title: "可靠性测试计划表", role: "RD" },
      { key: "fixture-list", title: "工装夹具清单", role: "ME" },
      { key: "manual-fct-equipment", title: "手动/半自动 FCT 测试设备", role: "TE" },
      { key: "ppap-initial-docs", title: "PPAP 资料初版", role: "QE" },
      { key: "pilot-issue-list", title: "试产问题点清单", role: "PE" },
    ]),
  }),
  PP: Object.freeze({
    label: "PP 量产验证",
    shortLabel: "量产验证",
    description: "在拟量产线体上完成自动化工装、可靠性测试与 48H 试产验证。",
    checkpoints: Object.freeze([
      { key: "line-approval", title: "线体承认", criterion: "量产线体、人员与关键工序通过承认", role: "ME" },
      { key: "automated-fixtures", title: "ICT/FCT 工装自动化导入", criterion: "自动化 ICT/FCT 工装完成导入和验收", role: "TE" },
      { key: "reliability-execution", title: "可靠性测试实操", criterion: "按计划完成可靠性测试实操并记录结果", role: "QE" },
      { key: "pilot-report", title: "试产报告输出", criterion: "输出 48H 试产报告与关闭计划", role: "PE" },
    ]),
    deliverables: Object.freeze([
      { key: "test-fixture-review", title: "测试工装评审表", role: "TE" },
      { key: "pilot-report-48h", title: "试产报告—48H", role: "PE" },
      { key: "test-report", title: "测试报告", role: "QE" },
    ]),
  }),
  MP: Object.freeze({
    label: "MP 量产准入",
    shortLabel: "量产准入",
    description: "完成规格签核、标准输出点检与量产质量控制文件签发。",
    checkpoints: Object.freeze([
      { key: "spec-signoff", title: "规格书签字（供方/SQE/RD）", criterion: "供方、SQE 与 RD 完成受控规格书签核", role: "SQE" },
      { key: "standard-output-check", title: "标准输出物点检", criterion: "量产准入标准输出物全部完成点检", role: "PE" },
      { key: "qcp-reliability-map", title: "QCP + 可靠性测试地图", criterion: "签字 QCP 与可靠性测试地图完成受控发布", role: "QE" },
    ]),
    deliverables: Object.freeze([
      { key: "signed-spec", title: "签字规格书", role: "SQE" },
      { key: "mp-entry-checklist", title: "量产准入点检表", role: "PE" },
      { key: "mp-approval-close-rate", title: "量产承认—问题关闭状况、直通率", role: "QE" },
      { key: "signed-qcp-reliability-map", title: "签字 QCP + 可靠性测试地图", role: "QE" },
    ]),
  }),
});

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(`${String(value || "").slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function safeIdPart(value) {
  return String(value).toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function createStage(project, type, planDate, index) {
  return {
    id: `phase-${safeIdPart(project.id)}-${type.toLocaleLowerCase()}`,
    type,
    label: STAGE_TEMPLATES[type].label,
    planDate,
    quantity: [5, 30, 100, 200][index],
  };
}

export function ensureStandardStages(project) {
  const phases = Array.isArray(project?.phases) ? project.phases : [];
  const existingByType = new Map(phases.map((phase) => [String(phase.type).toUpperCase(), phase]));
  const mpDate = existingByType.get("MP")?.planDate
    ?? phases.at(-1)?.planDate
    ?? addDays(new Date(), 120);
  const offsetsFromMp = { P: -90, EB: -60, PP: -30, MP: 0 };
  const standard = STANDARD_STAGE_TYPES.map((type, index) => {
    const existing = existingByType.get(type);
    if (existing) {
      return {
        ...existing,
        type,
        label: STAGE_TEMPLATES[type].label,
      };
    }
    return createStage(project, type, addDays(mpDate, offsetsFromMp[type]), index);
  });
  const custom = phases.filter((phase) => !STANDARD_STAGE_TYPES.includes(String(phase.type).toUpperCase()));
  return [...standard, ...custom];
}

export function createWorkflowItem(project, phase, kind, template, index = 0) {
  const baselineDate = phase.planDate || dateOnly(new Date());
  return {
    id: `workflow-${safeIdPart(project.id)}-${phase.type.toLocaleLowerCase()}-${kind}-${template.key}`,
    projectId: project.id,
    phaseId: phase.id,
    stageType: phase.type,
    kind,
    key: template.key,
    title: template.title,
    criterion: template.criterion ?? "完成文件编制、评审与受控归档",
    order: index,
    status: TASK_STATUS.NOT_STARTED,
    owner: "待分配",
    ownerAccountId: "",
    ownerRole: template.role ?? "PE",
    baselineDate,
    forecastDate: baselineDate,
    actualDate: null,
    blocker: "",
    notes: "",
    evidence: [],
    updatedAt: new Date().toISOString(),
  };
}

export function ensureWorkflowState(projects = [], workflowItems = []) {
  const nextProjects = projects.map((project) => ({
    ...project,
    phases: ensureStandardStages(project),
  }));
  const existingById = new Map(workflowItems.map((item) => [item.id, item]));
  const nextItems = [];

  nextProjects.forEach((project) => {
    STANDARD_STAGE_TYPES.forEach((type) => {
      const phase = project.phases.find((entry) => entry.type === type);
      const template = STAGE_TEMPLATES[type];
      ["checkpoints", "deliverables"].forEach((collection) => {
        const kind = collection === "checkpoints" ? "checkpoint" : "deliverable";
        template[collection].forEach((entry, index) => {
          const seed = createWorkflowItem(project, phase, kind, entry, index);
          const existing = existingById.get(seed.id);
          nextItems.push(existing ? {
            ...seed,
            ...existing,
            projectId: project.id,
            phaseId: phase.id,
            stageType: type,
            kind,
            key: entry.key,
            title: entry.title,
            criterion: entry.criterion ?? seed.criterion,
            order: index,
          } : seed);
          existingById.delete(seed.id);
        });
      });
    });
  });

  workflowItems.forEach((item) => {
    if (existingById.has(item.id)) nextItems.push(item);
  });

  return { projects: nextProjects, workflowItems: nextItems };
}

export function summarizeWorkflowItems(items = []) {
  const applicable = items.filter(({ status }) => status !== TASK_STATUS.NA);
  const completed = applicable.filter(({ status }) => status === TASK_STATUS.DONE).length;
  const blocked = applicable.filter(({ status }) => status === TASK_STATUS.BLOCKED).length;
  const risk = applicable.filter(({ status }) => status === TASK_STATUS.RISK).length;
  return {
    applicable: applicable.length,
    completed,
    blocked,
    risk,
    inProgress: applicable.filter(({ status }) => status === TASK_STATUS.IN_PROGRESS).length,
    readinessPct: applicable.length ? Math.round((completed / applicable.length) * 100) : 0,
  };
}

export function stageStateFromSummary(summary) {
  if (summary.blocked > 0) return "blocked";
  if (summary.risk > 0) return "risk";
  if (summary.applicable > 0 && summary.completed === summary.applicable) return "done";
  if (summary.completed > 0 || summary.inProgress > 0) return "active";
  return "upcoming";
}
