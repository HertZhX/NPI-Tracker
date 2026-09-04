import { TASK_STATUS } from "./statuses.js";
import {
  ensureProjectProducts,
  isProjectManuallyCompleted,
} from "./projects.js";

export const STANDARD_STAGE_TYPES = Object.freeze(["P", "EB", "PP", "MP"]);

export const PRODUCT_WORKFLOW_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

export const PHASE_LIFECYCLE = Object.freeze({
  PENDING_KICKOFF: "pending_kickoff",
  ACTIVE: "active",
  COMPLETED: "completed",
});

export const MEETING_TYPE = Object.freeze({
  KICKOFF: "kickoff",
  GATE_REVIEW: "gate_review",
});

export const MEETING_STATUS = Object.freeze({
  PENDING: "pending",
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

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
    deliverables: Object.freeze([]),
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
    deliverables: Object.freeze([]),
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
    deliverables: Object.freeze([]),
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
      { key: "dfm-review-form", title: "DFM 评审表", role: "PE" },
      { key: "ict-fct-evaluation", title: "ICT/FCT 评估表", role: "TE" },
      { key: "reliability-test-plan", title: "可靠性测试计划表", role: "RD" },
      { key: "fixture-list", title: "工装夹具清单", role: "ME" },
      { key: "manual-fct-equipment", title: "手动/半自动 FCT 测试设备", role: "TE" },
      { key: "ppap-initial-docs", title: "PPAP 资料初版", role: "QE" },
      { key: "pilot-issue-list", title: "试产问题点清单", role: "PE" },
      { key: "test-fixture-review", title: "测试工装评审表", role: "TE" },
      { key: "pilot-report-48h", title: "试产报告—48H", role: "PE" },
      { key: "test-report", title: "测试报告", role: "QE" },
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

function safeIdPart(value) {
  return String(value).toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ensureStandardStages(product) {
  const phases = Array.isArray(product?.phases) ? product.phases : [];
  const existingByType = new Map(phases.map((phase) => [String(phase.type).toUpperCase(), phase]));
  const existingStandardIndexes = STANDARD_STAGE_TYPES
    .map((type, index) => existingByType.has(type) ? index : -1)
    .filter((index) => index >= 0);
  const earliestExistingIndex = existingStandardIndexes.length
    ? Math.min(...existingStandardIndexes)
    : 0;
  const terminalIndex = existingStandardIndexes.length
    ? Math.max(...existingStandardIndexes)
    : 0;
  const anchorType = STANDARD_STAGE_TYPES[earliestExistingIndex];
  const anchorPhase = existingByType.get(anchorType);
  const anchorDate = new Date(`${String(anchorPhase?.planDate || dateOnly(new Date())).slice(0, 10)}T00:00:00.000Z`);
  const quantities = { P: 5, EB: 30, PP: 100, MP: 200 };
  const standard = STANDARD_STAGE_TYPES.slice(0, terminalIndex + 1).map((type, index) => {
    const existing = existingByType.get(type);
    if (existing) return {
      ...existing,
      type,
      label: STAGE_TEMPLATES[type].label,
    };
    const planDate = new Date(anchorDate);
    planDate.setUTCDate(planDate.getUTCDate() + ((index - earliestExistingIndex) * 30));
    const migratedAsCompleted = index < earliestExistingIndex;
    return {
      id: `phase-${safeIdPart(product?.id || "product")}-${type.toLocaleLowerCase()}`,
      type,
      label: STAGE_TEMPLATES[type].label,
      planDate: dateOnly(planDate),
      quantity: quantities[type],
      lifecycle: migratedAsCompleted ? PHASE_LIFECYCLE.COMPLETED : PHASE_LIFECYCLE.PENDING_KICKOFF,
      startedAt: "",
      completedAt: "",
      completedBy: "",
      completedByAccountId: "",
      completionNote: migratedAsCompleted ? "系统迁移：为保证阶段顺序补齐" : "",
    };
  });
  const custom = phases.filter((phase) => !STANDARD_STAGE_TYPES.includes(String(phase.type).toUpperCase()));
  return [...standard, ...custom];
}

export function getStandardPhases(product) {
  return (product?.phases ?? [])
    .filter(({ type }) => STANDARD_STAGE_TYPES.includes(String(type).toUpperCase()))
    .toSorted((left, right) => (
      STANDARD_STAGE_TYPES.indexOf(String(left.type).toUpperCase())
      - STANDARD_STAGE_TYPES.indexOf(String(right.type).toUpperCase())
    ));
}

export function isContinuousStageChain(product) {
  const types = getStandardPhases(product).map(({ type }) => String(type).toUpperCase());
  return types.length > 0 && types.every((type, index) => type === STANDARD_STAGE_TYPES[index]);
}

export function getCurrentStandardPhase(product) {
  const phases = getStandardPhases(product);
  if (!phases.length) return null;
  if (product?.workflowStatus === PRODUCT_WORKFLOW_STATUS.COMPLETED
    || product?.workflowStatus === PRODUCT_WORKFLOW_STATUS.CANCELLED) {
    return phases.find(({ type }) => type === product.terminalStageType) ?? phases.at(-1);
  }
  return phases.find(({ lifecycle }) => lifecycle !== PHASE_LIFECYCLE.COMPLETED) ?? phases.at(-1);
}

export function getNextStandardStageType(product) {
  const phases = getStandardPhases(product);
  if (!phases.length) return "P";
  const tailIndex = STANDARD_STAGE_TYPES.indexOf(String(phases.at(-1).type).toUpperCase());
  return tailIndex >= 0 ? (STANDARD_STAGE_TYPES[tailIndex + 1] ?? null) : "P";
}

export function getAvailableStageTypes(product) {
  const nextType = getNextStandardStageType(product);
  return nextType ? [nextType] : [];
}

export function isWorkflowStageComplete(items = [], phaseId) {
  if (!phaseId) return false;
  const summary = summarizeWorkflowItems(items.filter((item) => (
    item.phaseId === phaseId && item.kind === "checkpoint"
  )));
  return summary.applicable > 0 && summary.completed === summary.applicable;
}

export function getStageAdvance(product) {
  const availableTypes = getAvailableStageTypes(product);
  const existingStandardPhases = getStandardPhases(product);
  const previousPhase = existingStandardPhases.at(-1) ?? null;
  return {
    availableTypes,
    nextType: availableTypes[0] ?? null,
    previousType: previousPhase?.type ?? null,
    previousPhase,
    canAdd: availableTypes.length > 0,
  };
}

export function isProductDeliverableComplete(product, workflowItems = []) {
  const applicable = workflowItems.filter((item) => (
    item.productId === product?.id
    && item.kind === "deliverable"
    && !item.archivedAt
    && item.status !== TASK_STATUS.NA
  ));
  return applicable.length > 0 && applicable.every(({ status }) => status === TASK_STATUS.DONE);
}

export function getStageGateResult(product, phase, workflowItems = [], meetings = []) {
  const phaseItems = workflowItems.filter((item) => item.phaseId === phase?.id);
  const checkpointSummary = summarizeWorkflowItems(
    phaseItems.filter(({ kind }) => kind === "checkpoint"),
  );
  const productDeliverables = workflowItems.filter((item) => (
    item.productId === product?.id && item.kind === "deliverable"
  ));
  const deliverableSummary = summarizeWorkflowItems(productDeliverables);
  const checkpointReady = checkpointSummary.applicable > 0
    && checkpointSummary.completed === checkpointSummary.applicable;
  const deliverableReady = phase?.type !== "MP"
    || (deliverableSummary.applicable > 0
      && deliverableSummary.completed === deliverableSummary.applicable);
  const phaseMeetings = meetings.filter((meeting) => meeting.phaseId === phase?.id);
  const kickoffMeeting = phaseMeetings.find(({ type }) => type === MEETING_TYPE.KICKOFF) ?? null;
  const gateReviewMeeting = phaseMeetings.find(({ type }) => type === MEETING_TYPE.GATE_REVIEW) ?? null;
  const kickoffComplete = kickoffMeeting?.status === MEETING_STATUS.COMPLETED;
  const reviewComplete = gateReviewMeeting?.status === MEETING_STATUS.COMPLETED;

  return {
    checkpointSummary,
    deliverableSummary,
    checkpointReady,
    deliverableReady,
    contentReady: checkpointReady && deliverableReady,
    kickoffMeeting,
    gateReviewMeeting,
    kickoffComplete,
    reviewComplete,
    readyForReview: kickoffComplete && checkpointReady && deliverableReady,
    readyForTransition: kickoffComplete && checkpointReady && deliverableReady && reviewComplete,
  };
}

export function isProductWorkflowComplete(product, workflowItems = []) {
  if (product?.workflowStatus) {
    return product.workflowStatus === PRODUCT_WORKFLOW_STATUS.COMPLETED
      || product.workflowStatus === PRODUCT_WORKFLOW_STATUS.CANCELLED;
  }
  const configuredPhases = (product?.phases ?? []).filter(({ type }) => (
    STANDARD_STAGE_TYPES.includes(String(type).toUpperCase())
  ));
  return configuredPhases.length > 0 && configuredPhases.every((phase) => (
    isWorkflowStageComplete(workflowItems, phase.id)
  ));
}

export function isProjectWorkflowComplete(project, workflowItems = []) {
  return isProjectManuallyCompleted(project) || (Boolean(project?.products?.length) && project.products.every((product) => (
    isProductWorkflowComplete(
      product,
      workflowItems.filter((item) => item.projectId === project.id && item.productId === product.id),
    )
  )));
}

export function createWorkflowItem(project, product, phase, kind, template, index = 0) {
  const baselineDate = phase.planDate || dateOnly(new Date());
  return {
    id: `workflow-${safeIdPart(project.id)}-${safeIdPart(product.id)}-${phase.type.toLocaleLowerCase()}-${kind}-${template.key}`,
    projectId: project.id,
    productId: product.id,
    phaseId: phase.id,
    stageType: phase.type,
    kind,
    key: template.key,
    title: template.title,
    criterion: template.criterion ?? "完成文件编制、评审与受控归档",
    source: "standard",
    customized: false,
    required: true,
    archivedAt: "",
    archivedBy: "",
    archivedByAccountId: "",
    archiveReason: "",
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
    fileVersion: "",
    evidence: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createStageMeeting(project, product, phase, type) {
  const meetingLabel = type === MEETING_TYPE.KICKOFF ? "阶段前启动会" : "阶段后评审会";
  const idSuffix = type === MEETING_TYPE.KICKOFF ? "kickoff" : "gate-review";
  return {
    id: `meeting-${safeIdPart(project.id)}-${safeIdPart(product.id)}-${safeIdPart(phase.id)}-${idSuffix}`,
    projectId: project.id,
    productId: product.id,
    phaseId: phase.id,
    stageType: phase.type,
    type,
    subject: `${phase.type} ${meetingLabel}`,
    status: MEETING_STATUS.PENDING,
    scheduledAt: "",
    heldAt: "",
    attendees: [],
    conclusion: "",
    decision: "",
    ownerAccountId: product.managerAccountId || "",
    completedBy: "",
    completedByAccountId: "",
    completedAt: "",
    evidence: [],
    updatedAt: new Date().toISOString(),
  };
}

export function ensureWorkflowState(projects = [], workflowItems = [], meetings = []) {
  const nextProjects = ensureProjectProducts(projects).map((project) => {
    const products = project.products.map((product) => {
      const phases = ensureStandardStages(product);
      const standardPhases = phases.filter(({ type }) => STANDARD_STAGE_TYPES.includes(type));
      return {
        ...product,
        workflowStatus: Object.values(PRODUCT_WORKFLOW_STATUS).includes(product.workflowStatus)
          ? product.workflowStatus
          : PRODUCT_WORKFLOW_STATUS.ACTIVE,
        terminalStageType: String(product.terminalStageType || ""),
        workflowCompletedAt: String(product.workflowCompletedAt || ""),
        workflowCompletedBy: String(product.workflowCompletedBy || ""),
        workflowCompletedByAccountId: String(product.workflowCompletedByAccountId || ""),
        workflowCompletionNote: String(product.workflowCompletionNote || ""),
        phases: phases.map((phase) => ({
          ...phase,
          lifecycle: Object.values(PHASE_LIFECYCLE).includes(phase.lifecycle)
            ? phase.lifecycle
            : (phase.id === standardPhases[0]?.id
              ? PHASE_LIFECYCLE.PENDING_KICKOFF
              : PHASE_LIFECYCLE.PENDING_KICKOFF),
          startedAt: String(phase.startedAt || ""),
          completedAt: String(phase.completedAt || ""),
          completedBy: String(phase.completedBy || ""),
          completedByAccountId: String(phase.completedByAccountId || ""),
          completionNote: String(phase.completionNote || ""),
        })),
      };
    });
    return {
      ...project,
      products,
      phases: products[0]?.phases ?? [],
      productLine: project.productLine || products[0]?.name || "",
    };
  });
  const existingById = new Map(workflowItems.map((item) => [item.id, item]));
  const existingByReference = new Map(workflowItems.map((item) => [
    `${item.projectId}:${item.phaseId}:${item.kind}:${item.key}`,
    item,
  ]));
  const productContextById = new Map();
  const productContextByPhase = new Map();
  nextProjects.forEach((project) => {
    project.products.forEach((product) => {
      const context = {
        product,
        mpPhase: product.phases.find(({ type }) => type === "MP") ?? null,
      };
      productContextById.set(`${project.id}:${product.id}`, context);
      product.phases.forEach((phase) => {
        productContextByPhase.set(`${project.id}:${phase.id}`, context);
      });
    });
  });
  const existingDeliverableByProductReference = new Map();
  workflowItems.forEach((item) => {
    if (item.kind !== "deliverable") return;
    const context = productContextById.get(`${item.projectId}:${item.productId}`)
      ?? productContextByPhase.get(`${item.projectId}:${item.phaseId}`);
    if (!context) return;
    existingDeliverableByProductReference.set(
      `${item.projectId}:${context.product.id}:${item.kind}:${item.key}`,
      item,
    );
  });
  const remainingIds = new Set(workflowItems.map(({ id }) => id));
  const nextItems = [];

  nextProjects.forEach((project) => {
    project.products.forEach((product) => {
      STANDARD_STAGE_TYPES.forEach((type) => {
        const phase = product.phases.find((entry) => entry.type === type);
        if (!phase) return;
        const template = STAGE_TEMPLATES[type];
        ["checkpoints", "deliverables"].forEach((collection) => {
          const kind = collection === "checkpoints" ? "checkpoint" : "deliverable";
          template[collection].forEach((entry, index) => {
            const seed = createWorkflowItem(project, product, phase, kind, entry, index);
            const migratedCompleted = phase.lifecycle === PHASE_LIFECYCLE.COMPLETED
              && phase.completionNote === "系统迁移：为保证阶段顺序补齐";
            const defaultItem = migratedCompleted ? {
              ...seed,
              status: TASK_STATUS.NA,
              notes: "系统迁移补齐的历史阶段，不纳入当前阶段门计算",
            } : seed;
            const referenceKey = `${project.id}:${phase.id}:${kind}:${entry.key}`;
            const productReferenceKey = `${project.id}:${product.id}:${kind}:${entry.key}`;
            const existing = existingById.get(seed.id)
              ?? existingByReference.get(referenceKey)
              ?? (kind === "deliverable"
                ? existingDeliverableByProductReference.get(productReferenceKey)
                : undefined);
            nextItems.push(existing ? {
              ...seed,
              ...existing,
              id: existing.id,
              projectId: project.id,
              productId: product.id,
              phaseId: phase.id,
              stageType: type,
              kind,
              key: entry.key,
              title: existing.customized ? existing.title : entry.title,
              criterion: existing.customized
                ? existing.criterion
                : (entry.criterion ?? seed.criterion),
              source: existing.source ?? "standard",
              customized: Boolean(existing.customized),
              required: existing.required !== false,
              archivedAt: String(existing.archivedAt || ""),
              archivedBy: String(existing.archivedBy || ""),
              archivedByAccountId: String(existing.archivedByAccountId || ""),
              archiveReason: String(existing.archiveReason || ""),
              order: existing.customized ? existing.order : index,
            } : defaultItem);
            if (existing) remainingIds.delete(existing.id);
          });
        });
      });
    });
  });

  const validPhaseIds = new Set(nextProjects.flatMap((project) => (
    project.products.flatMap((product) => product.phases.map(({ id }) => id))
  )));
  workflowItems.forEach((item) => {
    if (!remainingIds.has(item.id)) return;
    const context = productContextById.get(`${item.projectId}:${item.productId}`)
      ?? productContextByPhase.get(`${item.projectId}:${item.phaseId}`);
    if (item.kind === "deliverable" && context?.mpPhase) {
      nextItems.push({
        ...item,
        productId: context.product.id,
        phaseId: context.mpPhase.id,
        stageType: "MP",
      });
      return;
    }
    if (validPhaseIds.has(item.phaseId)) nextItems.push(item);
  });

  const existingMeetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  const nextMeetings = [];
  nextProjects.forEach((project) => {
    project.products.forEach((product) => {
      product.phases
        .filter(({ type }) => STANDARD_STAGE_TYPES.includes(type))
        .forEach((phase) => {
          [MEETING_TYPE.KICKOFF, MEETING_TYPE.GATE_REVIEW].forEach((type) => {
            const seed = createStageMeeting(project, product, phase, type);
            const existing = existingMeetingById.get(seed.id);
            const migratedCompleted = phase.lifecycle === PHASE_LIFECYCLE.COMPLETED
              && phase.completionNote === "系统迁移：为保证阶段顺序补齐";
            const defaultMeeting = migratedCompleted ? {
              ...seed,
              status: MEETING_STATUS.COMPLETED,
              conclusion: "系统迁移补齐的历史阶段",
              completedBy: "系统迁移",
              completedAt: seed.updatedAt,
            } : seed;
            nextMeetings.push(existing ? {
              ...seed,
              ...existing,
              id: seed.id,
              projectId: project.id,
              productId: product.id,
              phaseId: phase.id,
              stageType: phase.type,
              type,
              attendees: Array.isArray(existing.attendees) ? existing.attendees : [],
              evidence: Array.isArray(existing.evidence) ? existing.evidence : [],
            } : defaultMeeting);
          });
        });
    });
  });

  return { projects: nextProjects, workflowItems: nextItems, meetings: nextMeetings };
}

export function summarizeWorkflowItems(items = []) {
  const applicable = items.filter(({ status, archivedAt, required }) => (
    !archivedAt && required !== false && status !== TASK_STATUS.NA
  ));
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
