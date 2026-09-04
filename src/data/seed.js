import { TASK_STATUS } from "../domain/statuses.js";
import { DEFAULT_ACCOUNTS } from "../domain/accounts.js";

export const DEFINITIONS = Object.freeze([
  { key: "product-version", label: "产品版本", category: "资料与程序", defaultRole: "PE" },
  { key: "bom", label: "BOM", category: "资料与程序", defaultRole: "PE" },
  { key: "dfm", label: "DFM", category: "资料与程序", defaultRole: "PE" },
  { key: "pfmea", label: "PFMEA", category: "资料与程序", defaultRole: "ME" },
  { key: "control-plan", label: "质量控制计划", category: "资料与程序", defaultRole: "QE" },
  { key: "process-doc", label: "可制造工艺文件", category: "资料与程序", defaultRole: "PE" },
  { key: "inspection-spec", label: "检验规范", category: "资料与程序", defaultRole: "QE" },
  { key: "packaging-spec", label: "包装规范", category: "资料与程序", defaultRole: "PE" },
  { key: "fai", label: "FAI（首件）", category: "资料与程序", defaultRole: "QE" },
  { key: "firmware", label: "烧录软件", category: "资料与程序", defaultRole: "PE" },
  { key: "smt-program", label: "SMT程序", category: "资料与程序", defaultRole: "ME" },
  { key: "stencil", label: "钢网", category: "工装", defaultRole: "PE" },
  { key: "wave-carrier", label: "波峰焊载具", category: "工装", defaultRole: "PE" },
  { key: "ict-fixture", label: "ICT针床", category: "工装", defaultRole: "PE" },
  { key: "programming-fixture", label: "烧录工装", category: "工装", defaultRole: "PE" },
  { key: "fct-fixture", label: "FCT工装", category: "工装", defaultRole: "PE" },
  { key: "potting-fixture", label: "灌胶治具", category: "工装", defaultRole: "PE" },
  { key: "material-readiness", label: "材料进度", category: "材料", defaultRole: "PUR" },
]);

const ROLE_OWNERS = Object.freeze({
  PE: "张伟",
  ME: "赵峰",
  QE: "刘婷",
  PUR: "孙洁",
});

const ACCOUNT_ID_BY_NAME = Object.freeze(Object.fromEntries(
  DEFAULT_ACCOUNTS.map((account) => [account.name, account.id]),
));

const DEFINITION_DAY_OFFSETS = Object.freeze([
  -42, -38, -35, -32, -30, -28, -25, -23, -21,
  -20, -17, -15, -13, -12, -8, -5, -3, 0,
]);

function shiftDate(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function phase(id, type, label, planDate, quantity) {
  return { id, type, label, planDate, quantity };
}

const PROJECTS = Object.freeze([
  {
    id: "project-cl2557",
    code: "CL2557",
    name: "CL2557 智能控制器新品导入",
    productLine: "智能控制器",
    manager: "张敏",
    managerAccountId: "account-zhangmin",
    type: "NPI",
    phases: [
      phase("phase-cl2557-p", "P", "P 产品验证", "2026-05-20", 5),
      phase("phase-cl2557-eb", "EB", "EB 工程验证", "2026-06-20", 30),
      phase("phase-cl2557-pp", "PP", "PP 量产验证", "2026-07-20", 100),
      phase("phase-cl2557-mp", "MP", "MP 量产评审", "2026-08-15", 200),
      phase("phase-cl2557-mass", "MASS", "批量大货", "2026-09-18", 5000),
    ],
  },
  {
    id: "project-cl2636",
    code: "CL2636",
    name: "CL2636 智能终端新品导入",
    productLine: "智能终端",
    manager: "李晨",
    managerAccountId: "account-lichen",
    type: "NPI",
    phases: [
      phase("phase-cl2636-p", "P", "P 产品验证", "2026-06-18", 5),
      phase("phase-cl2636-eb", "EB", "EB 工程验证", "2026-07-18", 20),
      phase("phase-cl2636-pp", "PP", "PP 量产验证", "2026-08-18", 100),
      phase("phase-cl2636-mp", "MP", "MP 量产评审", "2026-09-05", 150),
      phase("phase-cl2636-mass", "MASS", "批量大货", "2026-10-20", 3000),
    ],
  },
]);

const MATERIALS = Object.freeze([
  { id: "mat-2557-01", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-1001", name: "上盖组件", quantity: 200, dueDate: "2026-07-28" },
  { id: "mat-2557-02", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-1002", name: "底壳组件", quantity: 200, dueDate: "2026-07-30" },
  { id: "mat-2557-03", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-2001", name: "主控 PCBA", quantity: 220, dueDate: "2026-08-01" },
  { id: "mat-2557-04", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-3001", name: "按键硅胶", quantity: 220, dueDate: "2026-08-03" },
  { id: "mat-2557-05", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-3002", name: "密封圈", quantity: 220, dueDate: "2026-08-05" },
  { id: "mat-2557-06", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-4001", name: "线束组件", quantity: 210, dueDate: "2026-08-06" },
  { id: "mat-2557-07", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-5001", name: "包装彩盒", quantity: 250, dueDate: "2026-08-08" },
  { id: "mat-2557-08", projectId: "project-cl2557", phaseId: "phase-cl2557-mp", code: "2557-5002", name: "整机标签", quantity: 250, dueDate: "2026-08-08" },
  { id: "mat-2557-eb-01", projectId: "project-cl2557", phaseId: "phase-cl2557-eb", code: "2557-EB-KIT", name: "EB 验证套料", quantity: 30, dueDate: "2026-06-18" },
  { id: "mat-2557-mass-01", projectId: "project-cl2557", phaseId: "phase-cl2557-mass", code: "2557-MASS-KIT", name: "大货齐套", quantity: 5000, dueDate: "2026-09-12" },
  { id: "mat-2636-01", projectId: "project-cl2636", phaseId: "phase-cl2636-mp", code: "2636-1001", name: "终端面壳", quantity: 150, dueDate: "2026-08-24" },
  { id: "mat-2636-02", projectId: "project-cl2636", phaseId: "phase-cl2636-mp", code: "2636-2001", name: "核心板 PCBA", quantity: 170, dueDate: "2026-08-26" },
  { id: "mat-2636-03", projectId: "project-cl2636", phaseId: "phase-cl2636-eb", code: "2636-EB-KIT", name: "EB 验证套料", quantity: 20, dueDate: "2026-07-14" },
]);

function statusForSeed(material, definitionIndex) {
  if (material.id === "mat-2557-eb-01") {
    return definitionIndex < 16 ? TASK_STATUS.DONE : TASK_STATUS.PENDING_REVIEW;
  }
  if (material.id === "mat-2557-mass-01") {
    return definitionIndex < 3 ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.NOT_STARTED;
  }
  if (material.id === "mat-2636-03") {
    if (definitionIndex < 12) return TASK_STATUS.DONE;
    if (definitionIndex === 13) return TASK_STATUS.BLOCKED;
    return TASK_STATUS.IN_PROGRESS;
  }
  if (material.projectId === "project-cl2636") {
    if (definitionIndex < 5) return TASK_STATUS.DONE;
    if (definitionIndex === 9) return TASK_STATUS.RISK;
    if (definitionIndex < 12) return TASK_STATUS.IN_PROGRESS;
    return TASK_STATUS.NOT_REPORTED;
  }

  const materialIndex = Number(material.id.slice(-2)) - 1;
  const completedUntil = Math.max(4, 13 - materialIndex);
  if (materialIndex === 1 && definitionIndex === 10) return TASK_STATUS.BLOCKED;
  if (materialIndex === 2 && definitionIndex === 13) return TASK_STATUS.RISK;
  if (materialIndex === 4 && definitionIndex === 12) return TASK_STATUS.NA;
  if (definitionIndex < completedUntil) return TASK_STATUS.DONE;
  if (definitionIndex === completedUntil) return TASK_STATUS.IN_PROGRESS;
  if (definitionIndex === completedUntil + 1) return TASK_STATUS.PENDING_REVIEW;
  if (materialIndex >= 5 && definitionIndex > 14) return TASK_STATUS.NOT_REPORTED;
  return TASK_STATUS.NOT_STARTED;
}

export function createTaskForMaterial(material, definition, options = {}) {
  const definitionIndex = options.definitionIndex ?? DEFINITIONS.findIndex(({ key }) => key === definition.key);
  const status = options.status ?? TASK_STATUS.NOT_REPORTED;
  const baselineOffset = definitionIndex >= 0
    ? (DEFINITION_DAY_OFFSETS[definitionIndex] ?? 0)
    : 0;
  const baselineDate = options.baselineDate
    ?? shiftDate(material.dueDate, baselineOffset);
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const owner = options.owner ?? ROLE_OWNERS[definition.defaultRole] ?? "待分配";

  return {
    id: options.id ?? `task-${material.id}-${definition.key}`,
    projectId: material.projectId,
    productId: material.productId ?? "",
    phaseId: material.phaseId,
    materialId: material.id,
    definitionKey: definition.key,
    status,
    owner,
    ownerAccountId: options.ownerAccountId ?? ACCOUNT_ID_BY_NAME[owner] ?? "",
    ownerRole: options.ownerRole ?? definition.defaultRole,
    baselineDate,
    forecastDate: options.forecastDate ?? baselineDate,
    actualDate: options.actualDate ?? null,
    blocker: options.blocker ?? "",
    notes: options.notes ?? "",
    fileVersion: options.fileVersion ?? "",
    evidence: options.evidence ?? [],
    updatedAt,
  };
}

function createSeedTasks(materials, definitions) {
  return materials.flatMap((material) => definitions.map((definition, definitionIndex) => {
    const status = statusForSeed(material, definitionIndex);
    const baselineDate = shiftDate(material.dueDate, DEFINITION_DAY_OFFSETS[definitionIndex]);
    const done = status === TASK_STATUS.DONE;
    const forecastDelay = status === TASK_STATUS.RISK ? 5 : status === TASK_STATUS.BLOCKED ? 7 : 0;
    const evidence = done && definitionIndex % 4 === 0
      ? [{
          id: `evidence-${material.id}-${definition.key}`,
          name: `${definition.label}-已确认.pdf`,
          type: "application/pdf",
          size: 428000,
          addedAt: "2026-07-22T08:30:00.000Z",
        }]
      : [];

    return createTaskForMaterial(material, definition, {
      definitionIndex,
      status,
      baselineDate,
      forecastDate: shiftDate(baselineDate, forecastDelay),
      actualDate: done ? shiftDate(baselineDate, definitionIndex % 3 === 0 ? -1 : 0) : null,
      blocker: status === TASK_STATUS.BLOCKED
        ? "供应商交期未确认，需项目经理升级协调"
        : status === TASK_STATUS.RISK
          ? "预计比基准计划晚 5 天"
          : "",
      notes: status === TASK_STATUS.PENDING_REVIEW ? "资料已提交，等待责任部门签核" : "",
      evidence,
      updatedAt: "2026-07-24T08:30:00.000Z",
    });
  }));
}

export function createSeedData() {
  const projects = PROJECTS.map((project) => ({
    ...project,
    phases: project.phases.map((item) => ({ ...item })),
  }));
  const materials = MATERIALS.map((material) => ({ ...material }));
  const definitions = DEFINITIONS.map((definition) => ({ ...definition }));

  return {
    projects,
    materials,
    definitions,
    tasks: createSeedTasks(materials, definitions),
  };
}

export const SEED_DATA = createSeedData();
export const seedData = SEED_DATA;
