import { create } from "zustand";
import { z } from "zod";
import {
  createDefaultAccounts,
  normalizeUsername,
} from "../domain/accounts.js";
import {
  BOM_STATUS,
  bomItemFingerprint,
  bomSummaryToTaskStatus,
  isBomStatus,
} from "../domain/bom.js";
import { TASK_STATUS, isTaskStatus } from "../domain/statuses.js";
import {
  addProductReferences,
  findProductByPhase,
} from "../domain/projects.js";
import { PRODUCT_FILE_SCOPE } from "../domain/productFiles.js";
import {
  ensureWorkflowState,
  STANDARD_STAGE_TYPES,
  STAGE_TEMPLATES,
} from "../domain/workflow.js";
import { createSeedData, createTaskForMaterial } from "../data/seed.js";

export const STORAGE_KEY = "npi-tracker:v1";

function createId(prefix) {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomId}`;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return dateOnly(shifted);
}

function trimOr(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createDefinitionKey(label, category, existingKeys) {
  const asciiSlug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const base = asciiSlug || `item-${hashText(`${category}:${label}`)}`;
  let key = base;
  let suffix = 2;
  while (existingKeys.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return key;
}

function normalizeDefinitionToken(value) {
  return String(value || "")
    .trim()
    .replace(/^PFM$/i, "PFMEA")
    .replace(/[（）]/g, (character) => (character === "（" ? "(" : ")"))
    .replace(/\s+/g, "")
    .toLocaleLowerCase();
}

const phaseSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  planDate: z.string(),
  quantity: z.number().finite(),
  lifecycle: z.enum(["pending_kickoff", "active", "completed"]).optional().default("pending_kickoff"),
  startedAt: z.string().optional().default(""),
  completedAt: z.string().optional().default(""),
  completedBy: z.string().optional().default(""),
  completedByAccountId: z.string().optional().default(""),
  completionNote: z.string().optional().default(""),
});

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  partNumber: z.string().optional().default(""),
  version: z.string().optional().default(""),
  manager: z.string().optional().default("待分配"),
  managerAccountId: z.string().optional().default(""),
  workflowStatus: z.enum(["active", "completed", "cancelled"]).optional().default("active"),
  terminalStageType: z.string().optional().default(""),
  workflowCompletedAt: z.string().optional().default(""),
  workflowCompletedBy: z.string().optional().default(""),
  workflowCompletedByAccountId: z.string().optional().default(""),
  workflowCompletionNote: z.string().optional().default(""),
  phases: z.array(phaseSchema).min(1),
});

const projectSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().optional().default(""),
  status: z.enum(["active", "completed"]).optional().default("active"),
  completedAt: z.string().optional().default(""),
  completedBy: z.string().optional().default(""),
  completedByAccountId: z.string().optional().default(""),
  completionNote: z.string().optional().default(""),
  productLine: z.string().optional().default(""),
  manager: z.string().optional().default(""),
  managerAccountId: z.string().optional().default(""),
  type: z.string(),
  phases: z.array(phaseSchema).optional().default([]),
  products: z.array(productSchema).optional().default([]),
});

const materialSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  productId: z.string().optional().default(""),
  phaseId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  manufacturer: z.string().optional().default(""),
  quantity: z.number().finite(),
  dueDate: z.string(),
});

const definitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  category: z.string().min(1),
  defaultRole: z.string(),
});

const evidenceSchema = z.object({
  id: z.string().optional().default(""),
  name: z.string().min(1),
  type: z.string().optional().default(""),
  size: z.number().nonnegative().optional().default(0),
  addedAt: z.string().optional().default(""),
}).passthrough();

const taskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  productId: z.string().optional().default(""),
  phaseId: z.string().min(1),
  materialId: z.string().min(1),
  definitionKey: z.string().min(1),
  status: z.string().refine(isTaskStatus),
  owner: z.string(),
  ownerAccountId: z.string().optional().default(""),
  ownerRole: z.string(),
  baselineDate: z.string(),
  forecastDate: z.string(),
  actualDate: z.string().nullable(),
  blocker: z.string(),
  notes: z.string(),
  fileVersion: z.string().optional().default(""),
  evidence: z.array(evidenceSchema),
  updatedAt: z.string(),
});

const workflowItemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  productId: z.string().optional().default(""),
  phaseId: z.string().min(1),
  stageType: z.string().min(1),
  kind: z.enum(["checkpoint", "deliverable"]),
  key: z.string().min(1),
  title: z.string().min(1),
  criterion: z.string().optional().default(""),
  source: z.enum(["standard", "manual"]).optional().default("standard"),
  customized: z.boolean().optional().default(false),
  required: z.boolean().optional().default(true),
  archivedAt: z.string().optional().default(""),
  archivedBy: z.string().optional().default(""),
  archivedByAccountId: z.string().optional().default(""),
  archiveReason: z.string().optional().default(""),
  order: z.number().int().nonnegative().optional().default(0),
  status: z.string().refine(isTaskStatus),
  owner: z.string(),
  ownerAccountId: z.string().optional().default(""),
  ownerRole: z.string(),
  baselineDate: z.string(),
  forecastDate: z.string(),
  actualDate: z.string().nullable(),
  blocker: z.string(),
  notes: z.string(),
  fileVersion: z.string().optional().default(""),
  evidence: z.array(evidenceSchema),
  updatedAt: z.string(),
});

const meetingSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  productId: z.string().min(1),
  phaseId: z.string().min(1),
  stageType: z.string().min(1),
  type: z.enum(["kickoff", "gate_review", "extra"]),
  subject: z.string().min(1),
  status: z.enum(["pending", "scheduled", "completed", "cancelled"]),
  scheduledAt: z.string().optional().default(""),
  heldAt: z.string().optional().default(""),
  attendees: z.array(z.string()).optional().default([]),
  conclusion: z.string().optional().default(""),
  decision: z.string().optional().default(""),
  ownerAccountId: z.string().optional().default(""),
  completedBy: z.string().optional().default(""),
  completedByAccountId: z.string().optional().default(""),
  completedAt: z.string().optional().default(""),
  evidence: z.array(evidenceSchema).optional().default([]),
  updatedAt: z.string(),
});

const bomItemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  productId: z.string().optional().default(""),
  phaseId: z.string().min(1),
  parentMaterialId: z.string().min(1),
  importId: z.string().min(1),
  itemNo: z.string().optional().default(""),
  code: z.string().min(1),
  name: z.string().min(1),
  internalCode: z.string().optional().default(""),
  comment: z.string().optional().default(""),
  spec: z.string().optional().default(""),
  type: z.string().optional().default(""),
  pad: z.string().optional().default(""),
  description: z.string().optional().default(""),
  unitQuantity: z.number().finite().optional().default(0),
  designator: z.string().optional().default(""),
  vendors: z.array(z.string()).optional().default([]),
  mpns: z.array(z.string()).optional().default([]),
  status: z.string().refine(isBomStatus),
  owner: z.string().optional().default(""),
  ownerAccountId: z.string().optional().default(""),
  issue: z.string().optional().default(""),
  eta: z.string().optional().default(""),
  confirmedBy: z.string().optional().default(""),
  confirmedByAccountId: z.string().optional().default(""),
  confirmedAt: z.string().optional().default(""),
  sourceRow: z.number().int().nonnegative().optional().default(0),
  sourceSheet: z.string().optional().default(""),
  sourceVersion: z.string().optional().default(""),
  updatedAt: z.string(),
});

const bomImportSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  productId: z.string().optional().default(""),
  phaseId: z.string().min(1),
  parentMaterialId: z.string().min(1),
  fileName: z.string().min(1),
  sheetName: z.string().min(1),
  productModel: z.string().optional().default(""),
  assemblyCode: z.string().optional().default(""),
  assemblyName: z.string().optional().default(""),
  version: z.string().optional().default(""),
  itemCount: z.number().int().nonnegative(),
  importedAt: z.string(),
});

const quotationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  phaseId: z.string().min(1),
  bomItemId: z.string().min(1),
  vendor: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string(),
  size: z.number().positive(),
  uploadedByAccountId: z.string().min(1),
  uploadedBy: z.string().min(1),
  uploadedAt: z.string(),
  matchedItemCount: z.number().int().nonnegative().optional().default(0),
  matches: z.array(z.object({
    bomItemId: z.string().min(1),
    materialCode: z.string().min(1),
    sourceRow: z.number().int().positive(),
    unitPrice: z.string().min(1),
    currency: z.string(),
    vendor: z.string().min(1),
  })).optional().default([]),
});

const accountSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string().min(1),
  department: z.string(),
  jobRole: z.string(),
  active: z.boolean(),
});

const persistedStateSchema = z.object({
  projects: z.array(projectSchema),
  materials: z.array(materialSchema),
  definitions: z.array(definitionSchema).min(1),
  tasks: z.array(taskSchema),
  workflowItems: z.array(workflowItemSchema).optional().default([]),
  meetings: z.array(meetingSchema).optional().default([]),
  bomItems: z.array(bomItemSchema).optional().default([]),
  bomImports: z.array(bomImportSchema).optional().default([]),
  quotations: z.array(quotationSchema).optional().default([]),
  accounts: z.array(accountSchema).optional(),
  currentAccountId: z.string().nullable().optional(),
  selectedProjectId: z.string().nullable(),
  selectedProductId: z.string().nullable().optional(),
  selectedPhaseId: z.string().nullable(),
});

export function sanitizePersistedState(value) {
  const parsed = persistedStateSchema.safeParse(value);
  if (!parsed.success) return null;

  const referenced = addProductReferences(parsed.data);
  const ensured = ensureWorkflowState(referenced.projects, referenced.workflowItems, referenced.meetings);
  const state = addProductReferences({ ...referenced, ...ensured });
  const projectIds = new Set(state.projects.map(({ id }) => id));
  const productIdsByProject = new Map(state.projects.map((project) => [
    project.id,
    new Set(project.products.map(({ id }) => id)),
  ]));
  const phaseProductByProject = new Map(state.projects.map((project) => [
    project.id,
    new Map(project.products.flatMap((product) => (
      product.phases.map((phase) => [phase.id, product.id])
    ))),
  ]));
  const materialIds = new Set(state.materials.map(({ id }) => id));
  const definitionKeys = new Set(state.definitions.map(({ key }) => key));
  const invalidScope = (item) => (
    !projectIds.has(item.projectId)
    || !productIdsByProject.get(item.projectId)?.has(item.productId)
    || phaseProductByProject.get(item.projectId)?.get(item.phaseId) !== item.productId
  );
  const invalidReference = state.materials.some((material) => (
    invalidScope(material)
  )) || state.tasks.some((task) => (
    invalidScope(task)
    || !materialIds.has(task.materialId)
    || !definitionKeys.has(task.definitionKey)
  )) || state.workflowItems.some((item) => (
    invalidScope(item)
  )) || state.meetings.some((meeting) => (
    invalidScope(meeting)
  )) || state.bomItems.some((item) => (
    invalidScope(item)
    || !materialIds.has(item.parentMaterialId)
  )) || state.bomImports.some((item) => (
    invalidScope(item)
    || !materialIds.has(item.parentMaterialId)
  )) || state.quotations.some((item) => (
    !projectIds.has(item.projectId)
    || !phaseIdsByProject.get(item.projectId)?.has(item.phaseId)
    || !state.bomItems.some(({ id }) => id === item.bomItemId)
  ));
  if (invalidReference) return null;

  const selectedProject = state.projects.find(({ id }) => id === state.selectedProjectId)
    ?? state.projects[0]
    ?? null;
  const selectedProduct = selectedProject?.products.find(({ id }) => id === state.selectedProductId)
    ?? findProductByPhase(selectedProject, state.selectedPhaseId)
    ?? selectedProject?.products[0]
    ?? null;
  const selectedPhase = selectedProduct?.phases.find(({ id }) => id === state.selectedPhaseId)
    ?? selectedProduct?.phases.find(({ type }) => type === "MP")
    ?? selectedProduct?.phases[0]
    ?? null;

  const accountCandidates = state.accounts?.length ? state.accounts : createDefaultAccounts();
  const seenUsernames = new Set();
  const accounts = accountCandidates
    .map((account) => ({ ...account, username: normalizeUsername(account.username) }))
    .filter((account) => {
      if (seenUsernames.has(account.username)) return false;
      seenUsernames.add(account.username);
      return true;
    });
  const accountIds = new Set(accounts.map(({ id }) => id));
  const uniqueAccountByName = new Map();
  accounts.forEach((account) => {
    if (uniqueAccountByName.has(account.name)) uniqueAccountByName.set(account.name, null);
    else uniqueAccountByName.set(account.name, account);
  });
  const resolveAccountId = (accountId, name) => {
    if (accountIds.has(accountId)) return accountId;
    return uniqueAccountByName.get(String(name || "").trim())?.id ?? "";
  };
  const projects = state.projects.map((project) => ({
    ...project,
    products: project.products.map((product) => {
      const managerAccountId = resolveAccountId(product.managerAccountId, product.manager);
      const manager = accounts.find(({ id }) => id === managerAccountId)?.name
        ?? product.manager
        ?? "待分配";
      return { ...product, manager, managerAccountId };
    }),
  }));
  const tasks = state.tasks.map((task) => ({
    ...task,
    ownerAccountId: resolveAccountId(task.ownerAccountId, task.owner),
  }));
  const workflowItems = state.workflowItems.map((item) => ({
    ...item,
    ownerAccountId: resolveAccountId(item.ownerAccountId, item.owner),
  }));
  const bomItems = state.bomItems.map((item) => ({
    ...item,
    ownerAccountId: resolveAccountId(item.ownerAccountId, item.owner),
    confirmedByAccountId: resolveAccountId(item.confirmedByAccountId, item.confirmedBy),
  }));
  const currentAccount = accounts.find((account) => (
    account.id === state.currentAccountId && account.active
  )) ?? accounts.find(({ active }) => active) ?? accounts[0];

  return {
    ...state,
    projects,
    tasks,
    workflowItems,
    meetings: state.meetings,
    bomItems,
    accounts,
    currentAccountId: currentAccount?.id ?? null,
    selectedProjectId: selectedProject?.id ?? null,
    selectedProductId: selectedProduct?.id ?? null,
    selectedPhaseId: selectedPhase?.id ?? null,
  };
}

function createDefaultPhases(projectId, input = {}) {
  const requestedDate = input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : new Date();
  const baseDate = Number.isNaN(requestedDate.getTime()) ? new Date() : requestedDate;
  const requestedStageTypes = Array.isArray(input.stageTypes)
    ? input.stageTypes.map((type) => String(type).toUpperCase())
    : [];
  const requestedEndType = String(input.endStageType || "").toUpperCase();
  const requestedEndIndex = Math.max(
    STANDARD_STAGE_TYPES.indexOf(requestedEndType),
    ...requestedStageTypes.map((type) => STANDARD_STAGE_TYPES.indexOf(type)),
    0,
  );
  const quantities = { P: 5, EB: 30, PP: 100, MP: 200 };
  const phaseInputs = STANDARD_STAGE_TYPES
    .slice(0, requestedEndIndex + 1)
    .map((type, index) => ({
      type,
      label: STAGE_TEMPLATES[type].label,
      offset: (index + 1) * 30,
      quantity: quantities[type],
    }));

  if (!phaseInputs.length) {
    phaseInputs.push({ type: "P", label: STAGE_TEMPLATES.P.label, offset: 30, quantity: quantities.P });
  }

  return phaseInputs.map((item) => ({
    id: createId(`phase-${projectId}-${item.type.toLowerCase()}`),
    type: item.type,
    label: item.label,
    planDate: addDays(baseDate, item.offset),
    quantity: item.quantity,
    lifecycle: "pending_kickoff",
    startedAt: "",
    completedAt: "",
    completedBy: "",
    completedByAccountId: "",
    completionNote: "",
  }));
}

function normalizePhaseInput(input) {
  const type = trimOr(input.type, "CUSTOM").toUpperCase();
  return {
    id: input.id ?? createId(`phase-${type.toLowerCase()}`),
    type,
    label: trimOr(input.label ?? input.name, type === "MASS" ? "批量大货" : type),
    planDate: input.planDate ?? input.plannedDate ?? dateOnly(new Date()),
    quantity: Number.isFinite(Number(input.quantity ?? input.plannedQuantity))
      ? Number(input.quantity ?? input.plannedQuantity)
      : 0,
    lifecycle: "pending_kickoff",
    startedAt: "",
    completedAt: "",
    completedBy: "",
    completedByAccountId: "",
    completionNote: "",
  };
}

function syncMaterialReadinessTask(tasks, bomItems, parentMaterialId, now) {
  const taskIndex = tasks.findIndex((task) => (
    task.materialId === parentMaterialId && task.definitionKey === "material-readiness"
  ));
  if (taskIndex < 0) return tasks;
  const status = bomSummaryToTaskStatus(
    bomItems.filter((item) => item.parentMaterialId === parentMaterialId),
  );
  const task = tasks[taskIndex];
  const nextTasks = [...tasks];
  nextTasks[taskIndex] = {
    ...task,
    status,
    actualDate: status === TASK_STATUS.DONE ? (task.actualDate || dateOnly(new Date())) : "",
    updatedAt: now,
  };
  return nextTasks;
}

export function selectBusinessState(state) {
  return {
    projects: state.projects,
    materials: state.materials,
    definitions: state.definitions,
    tasks: state.tasks,
    workflowItems: state.workflowItems,
    meetings: state.meetings,
    bomItems: state.bomItems,
    bomImports: state.bomImports,
  };
}

const initialData = {
  projects: [],
  materials: [],
  definitions: [],
  tasks: [],
  workflowItems: [],
  meetings: [],
  quotations: [],
};
const initialAccounts = [];
const initialProjectId = "project-cl2557";
const initialProductId = "product-project-cl2557-default";
const initialPhaseId = "phase-cl2557-mp";
const initialAccountId = null;

export const useNpiStore = create(
    (set, get) => ({
      ...initialData,
      accounts: initialAccounts,
      currentAccountId: initialAccountId,
      bomItems: [],
      bomImports: [],
      selectedProjectId: null,
      selectedProductId: null,
      selectedPhaseId: null,
      revision: 0,
      permissions: { canManage: false, canAssign: false, canImport: false },
      serverBacked: false,

      hydrateServerState: (payload = {}) => {
        set((current) => {
          const ensured = ensureWorkflowState(
            Array.isArray(payload.projects) ? payload.projects : [],
            Array.isArray(payload.workflowItems) ? payload.workflowItems : [],
            Array.isArray(payload.meetings) ? payload.meetings : [],
          );
          const referenced = addProductReferences({
            ...payload,
            projects: ensured.projects,
            materials: Array.isArray(payload.materials) ? payload.materials : [],
            tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
            workflowItems: ensured.workflowItems,
            meetings: ensured.meetings,
            bomItems: Array.isArray(payload.bomItems) ? payload.bomItems : [],
            bomImports: Array.isArray(payload.bomImports) ? payload.bomImports : [],
          });
          const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
          const accountById = new Map(accounts.map((account) => [account.id, account]));
          const projects = referenced.projects.map((project) => ({
            ...project,
            products: project.products.map((product) => ({
              ...product,
              manager: accountById.get(product.managerAccountId)?.name ?? product.manager,
            })),
          }));
          const preservedProject = projects.find(({ id }) => id === current.selectedProjectId);
          const selectedProject = preservedProject
            ?? projects.find(({ id }) => id === payload.selectedProjectId)
            ?? projects[0]
            ?? null;
          const selectedProduct = selectedProject?.products.find(({ id }) => id === current.selectedProductId)
            ?? selectedProject?.products.find(({ id }) => id === payload.selectedProductId)
            ?? findProductByPhase(selectedProject, current.selectedPhaseId || payload.selectedPhaseId)
            ?? selectedProject?.products[0]
            ?? null;
          const preservedPhase = selectedProduct?.phases.find(({ id }) => id === current.selectedPhaseId);
          const selectedPhase = preservedPhase
            ?? selectedProduct?.phases.find(({ id }) => id === payload.selectedPhaseId)
            ?? selectedProduct?.phases[0]
            ?? null;
          return {
          projects,
          materials: referenced.materials,
          definitions: Array.isArray(payload.definitions) ? payload.definitions : [],
          tasks: referenced.tasks,
          workflowItems: referenced.workflowItems,
          meetings: referenced.meetings,
          bomItems: referenced.bomItems,
          bomImports: referenced.bomImports,
          quotations: Array.isArray(payload.quotations) ? payload.quotations : [],
          accounts,
          currentAccountId: payload.currentAccountId ?? null,
          selectedProjectId: selectedProject?.id ?? null,
          selectedProductId: selectedProduct?.id ?? null,
          selectedPhaseId: selectedPhase?.id ?? null,
          revision: Number(payload.revision) || 0,
          permissions: payload.permissions ?? { canManage: false, canAssign: false, canImport: false },
          serverBacked: true,
          };
        });
      },

      clearServerState: () => set({
        ...initialData,
        accounts: [],
        currentAccountId: null,
        bomItems: [],
        bomImports: [],
        quotations: [],
        selectedProjectId: null,
        selectedProductId: null,
        selectedPhaseId: null,
        revision: 0,
        permissions: { canManage: false, canAssign: false, canImport: false },
        serverBacked: false,
      }),

      setRevision: (revision) => set({ revision: Number(revision) || 0 }),

      replaceProjectRecord: (project, revision) => set((state) => ({
        projects: state.projects.map((entry) => entry.id === project.id ? project : entry),
        revision: Number(revision) || state.revision,
      })),

      replaceTaskRecord: (task, revision) => set((state) => ({
        tasks: state.tasks.map((item) => item.id === task.id ? task : item),
        revision: Number(revision) || state.revision,
      })),

      replaceWorkflowItemRecord: (item, revision) => set((state) => ({
        workflowItems: state.workflowItems.some((entry) => entry.id === item.id)
          ? state.workflowItems.map((entry) => entry.id === item.id ? item : entry)
          : [...state.workflowItems, item],
        revision: Number(revision) || state.revision,
      })),

      replaceMeetingRecord: (meeting, revision) => set((state) => ({
        meetings: state.meetings.some((entry) => entry.id === meeting.id)
          ? state.meetings.map((entry) => entry.id === meeting.id ? meeting : entry)
          : [...state.meetings, meeting],
        revision: Number(revision) || state.revision,
      })),

      replaceBomItemRecord: (item, revision) => set((state) => ({
        bomItems: state.bomItems.map((entry) => entry.id === item.id ? item : entry),
        revision: Number(revision) || state.revision,
      })),

      addQuotationRecord: (quotation) => set((state) => ({
        quotations: [quotation, ...state.quotations.filter(({ id }) => id !== quotation.id)],
      })),

      removeQuotationRecord: (quotationId) => set((state) => ({
        quotations: state.quotations.filter(({ id }) => id !== quotationId),
      })),

      renameProject: (projectId, nextName) => {
        const name = trimOr(nextName);
        const state = get();
        const project = state.projects.find(({ id }) => id === projectId);
        if (!project || !name) return null;

        const renamed = { ...project, name };
        set((current) => ({
          projects: current.projects.map((entry) => entry.id === projectId ? renamed : entry),
        }));
        return renamed;
      },

      renameProduct: (projectId, productId, nextName) => {
        const name = trimOr(nextName);
        const state = get();
        const project = state.projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId);
        if (!project || !product || !name) return null;
        const duplicate = project.products.some(({ id, name: existingName }) => (
          id !== productId && existingName.toLocaleLowerCase() === name.toLocaleLowerCase()
        ));
        if (duplicate) return null;

        const renamed = { ...product, name };
        set((current) => ({
          projects: current.projects.map((entry) => {
            if (entry.id !== projectId) return entry;
            return {
              ...entry,
              products: entry.products.map((item) => item.id === productId ? renamed : item),
              productLine: entry.products[0]?.id === productId ? name : entry.productLine,
            };
          }),
        }));
        return renamed;
      },

      updateProductDetails: (projectId, productId, input = {}) => {
        const name = trimOr(input.name);
        const version = trimOr(input.version);
        const state = get();
        const project = state.projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId);
        const partNumber = Object.hasOwn(input, "partNumber")
          ? trimOr(input.partNumber)
          : product?.partNumber;
        if (!project || !product || !name || !partNumber || !version) return null;
        const duplicate = project.products.some((entry) => (
          entry.id !== productId
          && (
            entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()
            || entry.partNumber.toLocaleLowerCase() === partNumber.toLocaleLowerCase()
          )
        ));
        if (duplicate) return null;

        const updated = { ...product, name, partNumber, version };
        set((current) => ({
          projects: current.projects.map((entry) => {
            if (entry.id !== projectId) return entry;
            return {
              ...entry,
              products: entry.products.map((item) => item.id === productId ? updated : item),
              productLine: entry.products[0]?.id === productId ? name : entry.productLine,
            };
          }),
        }));
        return updated;
      },

      removeProjectRecord: (projectId, revision) => set((state) => {
        if (!state.projects.some(({ id }) => id === projectId)) return state;
        const projects = state.projects.filter(({ id }) => id !== projectId);
        const selectedProject = projects.find(({ id }) => id === state.selectedProjectId)
          ?? projects[0]
          ?? null;
        const selectedProduct = selectedProject?.products.find(({ id }) => id === state.selectedProductId)
          ?? selectedProject?.products[0]
          ?? null;
        const selectedPhase = selectedProduct?.phases.find(({ id }) => id === state.selectedPhaseId)
          ?? selectedProduct?.phases.find(({ type }) => type === "MP")
          ?? selectedProduct?.phases[0]
          ?? null;
        const nextRevision = Number(revision);

        return {
          projects,
          materials: state.materials.filter((item) => item.projectId !== projectId),
          tasks: state.tasks.filter((item) => item.projectId !== projectId),
          workflowItems: state.workflowItems.filter((item) => item.projectId !== projectId),
          meetings: state.meetings.filter((item) => item.projectId !== projectId),
          bomItems: state.bomItems.filter((item) => item.projectId !== projectId),
          bomImports: state.bomImports.filter((item) => item.projectId !== projectId),
          quotations: state.quotations.filter((item) => item.projectId !== projectId),
          selectedProjectId: selectedProject?.id ?? null,
          selectedProductId: selectedProduct?.id ?? null,
          selectedPhaseId: selectedPhase?.id ?? null,
          revision: Number.isFinite(nextRevision) ? nextRevision : state.revision,
        };
      }),

      removeProductRecord: (projectId, productId, revision) => set((state) => {
        const project = state.projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId);
        if (!project || !product || project.products.length <= 1) return state;

        const phaseIds = new Set(product.phases.map(({ id }) => id));
        const remainingProducts = project.products.filter(({ id }) => id !== productId);
        const projects = state.projects.map((entry) => entry.id === projectId
          ? {
            ...entry,
            products: remainingProducts,
            phases: remainingProducts[0]?.phases ?? [],
            productLine: remainingProducts[0]?.name ?? "",
          }
          : entry);
        const selectedProduct = state.selectedProductId === productId
          ? remainingProducts[0]
          : remainingProducts.find(({ id }) => id === state.selectedProductId) ?? remainingProducts[0];
        const selectedPhase = selectedProduct?.phases.find(({ id }) => id === state.selectedPhaseId)
          ?? selectedProduct?.phases.find(({ type }) => type === "P")
          ?? selectedProduct?.phases[0]
          ?? null;
        const belongsToProduct = (item) => (
          item.projectId === projectId
          && (item.productId === productId || phaseIds.has(item.phaseId))
        );
        const nextRevision = Number(revision);

        return {
          projects,
          materials: state.materials.filter((item) => !belongsToProduct(item)),
          tasks: state.tasks.filter((item) => !belongsToProduct(item)),
          workflowItems: state.workflowItems.filter((item) => !belongsToProduct(item)),
          meetings: state.meetings.filter((item) => !belongsToProduct(item)),
          bomItems: state.bomItems.filter((item) => !belongsToProduct(item)),
          bomImports: state.bomImports.filter((item) => !belongsToProduct(item)),
          quotations: state.quotations.filter((item) => !belongsToProduct(item)),
          selectedProjectId: projectId,
          selectedProductId: selectedProduct?.id ?? null,
          selectedPhaseId: selectedPhase?.id ?? null,
          revision: Number.isFinite(nextRevision) ? nextRevision : state.revision,
        };
      }),

      removeStageRecord: (projectId, productId, phaseId, revision) => set((state) => {
        const project = state.projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId);
        const phaseIndex = product?.phases.findIndex(({ id }) => id === phaseId) ?? -1;
        const standardPhases = product?.phases.filter(({ type }) => STANDARD_STAGE_TYPES.includes(type)) ?? [];
        if (
          !project
          || !product
          || phaseIndex < 0
          || standardPhases.length <= 1
          || standardPhases.at(-1)?.id !== phaseId
        ) return state;

        const remainingPhases = product.phases.filter(({ id }) => id !== phaseId);
        const products = project.products.map((item) => item.id === productId
          ? { ...item, phases: remainingPhases }
          : item);
        const projects = state.projects.map((entry) => entry.id === projectId
          ? { ...entry, products, phases: products[0]?.phases ?? [] }
          : entry);
        const selectedPhase = state.selectedProjectId === projectId
          && state.selectedProductId === productId
          ? remainingPhases.find(({ id }) => id === state.selectedPhaseId)
            ?? remainingPhases[Math.min(phaseIndex, remainingPhases.length - 1)]
          : null;
        const belongsToStage = (item) => item.projectId === projectId && item.phaseId === phaseId;
        const nextRevision = Number(revision);

        return {
          projects,
          materials: state.materials.filter((item) => !belongsToStage(item)),
          tasks: state.tasks.filter((item) => !belongsToStage(item)),
          workflowItems: state.workflowItems.filter((item) => !belongsToStage(item)),
          meetings: state.meetings.filter((item) => !belongsToStage(item)),
          bomItems: state.bomItems.filter((item) => !belongsToStage(item)),
          bomImports: state.bomImports.filter((item) => !belongsToStage(item)),
          quotations: state.quotations.filter((item) => !belongsToStage(item)),
          selectedPhaseId: selectedPhase?.id ?? state.selectedPhaseId,
          revision: Number.isFinite(nextRevision) ? nextRevision : state.revision,
        };
      }),

      replaceAccounts: (accounts) => set({ accounts }),

      selectAccount: (accountId) => {
        if (get().serverBacked) return false;
        const account = get().accounts.find((item) => item.id === accountId && item.active);
        if (!account) return false;
        set({ currentAccountId: account.id });
        return true;
      },

      createAccount: (input = {}) => {
        const username = normalizeUsername(input.username);
        const name = trimOr(input.name);
        const department = trimOr(input.department);
        const jobRole = trimOr(input.jobRole);
        if (!username || !name || !department || !jobRole) return null;
        if (get().accounts.some((account) => normalizeUsername(account.username) === username)) {
          return null;
        }
        const account = {
          id: input.id ?? createId("account"),
          username,
          name,
          department,
          jobRole,
          active: true,
        };
        set((state) => ({ accounts: [...state.accounts, account] }));
        return account;
      },

      updateAccount: (accountId, patch = {}) => {
        const current = get().accounts.find((account) => account.id === accountId);
        if (!current) return null;
        const username = patch.username == null
          ? current.username
          : normalizeUsername(patch.username);
        if (!username || get().accounts.some((account) => (
          account.id !== accountId && normalizeUsername(account.username) === username
        ))) return null;
        if (accountId === get().currentAccountId && patch.active === false) return null;
        const updated = {
          ...current,
          ...patch,
          id: current.id,
          username,
          name: trimOr(patch.name, current.name),
          department: trimOr(patch.department, current.department),
          jobRole: trimOr(patch.jobRole, current.jobRole),
          active: patch.active == null ? current.active : Boolean(patch.active),
        };
        set((state) => ({
          accounts: state.accounts.map((account) => account.id === accountId ? updated : account),
          projects: state.projects.map((project) => ({
            ...project,
            products: project.products.map((product) => product.managerAccountId === accountId
              ? { ...product, manager: updated.name }
              : product),
          })),
          tasks: state.tasks.map((task) => task.ownerAccountId === accountId
            ? { ...task, owner: updated.name }
            : task),
          workflowItems: state.workflowItems.map((item) => item.ownerAccountId === accountId
            ? { ...item, owner: updated.name }
            : item),
          bomItems: state.bomItems.map((item) => item.ownerAccountId === accountId
            ? { ...item, owner: updated.name }
            : item),
        }));
        return updated;
      },

      selectProject: (projectId) => {
        const project = get().projects.find(({ id }) => id === projectId);
        if (!project) return;
        const product = project.products[0];
        if (!product) return;
        const productItems = get().workflowItems.filter((item) => item.productId === product.id);
        const preferredPhase = product.phases.find((phase) => {
          if (!["P", "EB", "PP", "MP"].includes(phase.type)) return false;
          const phaseItems = productItems.filter((item) => item.phaseId === phase.id && item.status !== TASK_STATUS.NA);
          return phaseItems.some((item) => item.status !== TASK_STATUS.DONE);
        }) ?? product.phases.find(({ type }) => type === "MP") ?? product.phases[0];
        set({
          selectedProjectId: project.id,
          selectedProductId: product.id,
          selectedPhaseId: preferredPhase?.id ?? null,
        });
      },

      selectProduct: (productId) => {
        const project = get().projects.find(({ id }) => id === get().selectedProjectId);
        const product = project?.products.find(({ id }) => id === productId);
        if (!project || !product) return;
        const productItems = get().workflowItems.filter((item) => item.productId === product.id);
        const preferredPhase = product.phases.find((phase) => {
          if (!["P", "EB", "PP", "MP"].includes(phase.type)) return false;
          const phaseItems = productItems.filter((item) => item.phaseId === phase.id && item.status !== TASK_STATUS.NA);
          return phaseItems.some((item) => item.status !== TASK_STATUS.DONE);
        }) ?? product.phases.find(({ type }) => type === "MP") ?? product.phases[0];
        set({ selectedProductId: product.id, selectedPhaseId: preferredPhase?.id ?? null });
      },

      selectPhase: (phaseId) => {
        const project = get().projects.find(({ id }) => id === get().selectedProjectId);
        const product = project?.products.find(({ id }) => id === get().selectedProductId);
        if (!product?.phases.some(({ id }) => id === phaseId)) return;
        set({ selectedPhaseId: phaseId });
      },

      updateTask: (taskIdOrPatch, maybePatch = {}) => {
        const taskId = typeof taskIdOrPatch === "string" ? taskIdOrPatch : taskIdOrPatch?.id;
        const patch = typeof taskIdOrPatch === "string" ? maybePatch : taskIdOrPatch;
        if (!taskId || !patch) return;

        set((state) => ({
          tasks: state.tasks.map((task) => {
            if (task.id !== taskId) return task;
            const nextStatus = isTaskStatus(patch.status) ? patch.status : task.status;
            const actualDate = nextStatus === TASK_STATUS.DONE
              ? (patch.actualDate ?? task.actualDate ?? dateOnly(new Date()))
              : "";
            return {
              ...task,
              ...patch,
              id: task.id,
              status: nextStatus,
              actualDate,
              evidence: Array.isArray(patch.evidence) ? patch.evidence : task.evidence,
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      updateWorkflowItem: (itemId, patch = {}) => {
        if (!itemId || !patch) return;
        set((state) => ({
          workflowItems: state.workflowItems.map((item) => {
            if (item.id !== itemId) return item;
            const nextStatus = isTaskStatus(patch.status) ? patch.status : item.status;
            return {
              ...item,
              ...patch,
              id: item.id,
              status: nextStatus,
              actualDate: nextStatus === TASK_STATUS.DONE
                ? (patch.actualDate ?? item.actualDate ?? dateOnly(new Date()))
                : "",
              evidence: Array.isArray(patch.evidence) ? patch.evidence : item.evidence,
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      createProject: (input = {}) => {
        const id = input.id ?? createId("project");
        const code = trimOr(input.code, `NPI-${Date.now().toString().slice(-6)}`);
        const legacyManager = trimOr(input.manager ?? input.owner, "待分配");
        const legacyManagerAccountId = trimOr(input.managerAccountId);
        const productInputs = Array.isArray(input.products) && input.products.length
          ? input.products
          : [{ name: input.productLine || "默认产品" }];
        const products = productInputs.map((productInput, index) => {
          const productId = productInput.id ?? createId(`product-${id}`);
          return {
            id: productId,
            name: trimOr(productInput.name, `产品 ${index + 1}`),
            partNumber: trimOr(productInput.partNumber),
            version: trimOr(productInput.version),
            manager: trimOr(productInput.manager, legacyManager),
            managerAccountId: trimOr(productInput.managerAccountId, legacyManagerAccountId),
            workflowStatus: "active",
            terminalStageType: "",
            workflowCompletedAt: "",
            workflowCompletedBy: "",
            workflowCompletedByAccountId: "",
            workflowCompletionNote: "",
            phases: createDefaultPhases(productId, { ...input, ...productInput }),
          };
        });
        const project = {
          id,
          code,
          name: trimOr(input.name, code),
          status: "active",
          completedAt: "",
          completedBy: "",
          completedByAccountId: "",
          completionNote: "",
          productLine: products[0].name,
          manager: "",
          managerAccountId: "",
          type: trimOr(input.type, "NPI"),
          phases: products[0].phases,
          products,
        };
        const ensured = ensureWorkflowState([project], []);
        const firstProduct = ensured.projects[0].products[0];
        const firstPhase = firstProduct.phases.find(({ type }) => type === "P")
          ?? firstProduct.phases[0];

        set((state) => ({
          projects: [...state.projects, ensured.projects[0]],
          workflowItems: [...state.workflowItems, ...ensured.workflowItems],
          meetings: [...state.meetings, ...ensured.meetings],
          selectedProjectId: project.id,
          selectedProductId: firstProduct.id,
          selectedPhaseId: firstPhase.id,
        }));
        return ensured.projects[0];
      },

      addProduct: (projectId, input = {}) => {
        const project = get().projects.find(({ id }) => id === projectId);
        const name = trimOr(input.name);
        if (!project || !name) return null;
        const productId = input.id ?? createId(`product-${projectId}`);
        const product = {
          id: productId,
          name,
          partNumber: trimOr(input.partNumber),
          version: trimOr(input.version),
          manager: trimOr(input.manager, "待分配"),
          managerAccountId: trimOr(input.managerAccountId),
          workflowStatus: "active",
          terminalStageType: "",
          workflowCompletedAt: "",
          workflowCompletedBy: "",
          workflowCompletedByAccountId: "",
          workflowCompletionNote: "",
          phases: createDefaultPhases(productId, input),
        };
        set((state) => {
          const projects = state.projects.map((item) => {
            if (item.id !== projectId) return item;
            const products = [...item.products, product];
            return { ...item, products };
          });
          const ensured = ensureWorkflowState(projects, state.workflowItems, state.meetings);
          const addedProduct = ensured.projects
            .find(({ id }) => id === projectId)
            ?.products.find(({ id }) => id === productId);
          const firstPhase = addedProduct?.phases.find(({ type }) => type === "P")
            ?? addedProduct?.phases[0]
            ?? null;
          return {
            projects: ensured.projects,
            workflowItems: ensured.workflowItems,
            meetings: ensured.meetings,
            selectedProjectId: projectId,
            selectedProductId: productId,
            selectedPhaseId: firstPhase?.id ?? null,
          };
        });
        return product;
      },

      ensureProductFileTask: ({ projectId, productId, definitionKey }) => {
        const state = get();
        const project = state.projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId);
        const definition = state.definitions.find(({ key }) => key === definitionKey);
        if (!project || !product || !definition) return null;

        const existing = state.tasks.find((task) => (
          task.projectId === projectId
          && task.productId === productId
          && task.definitionKey === definitionKey
          && task.trackingScope === PRODUCT_FILE_SCOPE
        ));
        if (existing) return existing;

        const phase = product.phases.find(({ type }) => type === "MP");
        if (!phase) return null;
        const existingMaterial = state.materials.find((material) => (
          material.projectId === projectId
          && material.productId === productId
          && material.trackingScope === PRODUCT_FILE_SCOPE
        ));
        const material = existingMaterial ?? {
          id: createId("product-file"),
          projectId,
          productId,
          phaseId: phase.id,
          code: product.partNumber || product.name,
          name: "产品文件收集",
          manufacturer: "",
          quantity: 1,
          dueDate: phase.planDate || "",
          trackingScope: PRODUCT_FILE_SCOPE,
        };
        const task = {
          ...createTaskForMaterial(material, definition, {
            id: createId("product-file-task"),
            owner: "待分配",
            ownerAccountId: "",
            ownerRole: definition.defaultRole,
            status: TASK_STATUS.NOT_REPORTED,
          }),
          trackingScope: PRODUCT_FILE_SCOPE,
        };

        set((current) => ({
          materials: existingMaterial ? current.materials : [...current.materials, material],
          tasks: [...current.tasks, task],
        }));
        return task;
      },

      addPhase: (projectIdOrInput, productIdOrInput = {}, maybeInput = {}) => {
        const singleInput = typeof projectIdOrInput === "object" && projectIdOrInput !== null;
        const projectId = singleInput ? projectIdOrInput.projectId : projectIdOrInput;
        const productId = singleInput
          ? projectIdOrInput.productId
          : (typeof productIdOrInput === "string" ? productIdOrInput : get().selectedProductId);
        const input = singleInput
          ? projectIdOrInput
          : (typeof productIdOrInput === "string" ? maybeInput : productIdOrInput);
        const project = get().projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId);
        if (!project || !product) return null;
        const newPhase = normalizePhaseInput(input);
        const stageExists = product.phases.some(({ type }) => (
          String(type).toUpperCase() === newPhase.type
        ));
        const standardPhases = product.phases
          .filter(({ type }) => STANDARD_STAGE_TYPES.includes(type))
          .toSorted((left, right) => STANDARD_STAGE_TYPES.indexOf(left.type) - STANDARD_STAGE_TYPES.indexOf(right.type));
        const previousType = standardPhases.at(-1)?.type;
        const expectedType = STANDARD_STAGE_TYPES[STANDARD_STAGE_TYPES.indexOf(previousType) + 1] ?? null;
        if (!STANDARD_STAGE_TYPES.includes(newPhase.type) || stageExists || newPhase.type !== expectedType) return null;

        set((state) => {
          const projects = state.projects.map((item) => item.id === projectId
            ? {
              ...item,
              products: item.products.map((entry) => entry.id === productId
                ? { ...entry, phases: [...entry.phases, newPhase] }
                : entry),
            }
            : item);
          const ensured = ensureWorkflowState(projects, state.workflowItems, state.meetings);
          return {
            projects: ensured.projects,
            workflowItems: ensured.workflowItems,
            meetings: ensured.meetings,
            selectedProjectId: projectId,
            selectedProductId: productId,
            selectedPhaseId: newPhase.id,
          };
        });
        return newPhase;
      },

      addDefinition: (input = {}) => {
        const label = trimOr(input.label);
        if (!label) return null;
        const category = trimOr(input.category, "其他");
        const defaultRole = trimOr(input.defaultRole, "待分配");
        const existingDefinition = get().definitions.find((definition) => (
          definition.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase()
          && definition.category === category
        ));
        if (existingDefinition) return existingDefinition.key;
        const existingKeys = new Set(get().definitions.map(({ key }) => key));
        const definition = {
          key: createDefinitionKey(label, category, existingKeys),
          label,
          category,
          defaultRole,
        };
        const now = new Date().toISOString();
        const tasks = get().materials.map((material) => createTaskForMaterial(material, definition, {
          updatedAt: now,
        }));

        set((state) => ({
          definitions: [...state.definitions, definition],
          tasks: [...state.tasks, ...tasks],
        }));
        return definition.key;
      },

      addMaterial: (input = {}) => {
        const project = get().projects.find(({ id }) => id === input.projectId);
        const product = project?.products.find(({ id }) => id === input.productId)
          ?? findProductByPhase(project, input.phaseId);
        const selectedPhase = product?.phases.find(({ id }) => id === input.phaseId);
        if (!project || !product || !selectedPhase) return null;
        const material = {
          id: input.id ?? createId("material"),
          projectId: project.id,
          productId: product.id,
          phaseId: selectedPhase.id,
          code: trimOr(input.code, `${project.code}-${Date.now().toString().slice(-4)}`),
          name: trimOr(input.name, "未命名物料"),
          manufacturer: trimOr(input.manufacturer),
          quantity: Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : 0,
          dueDate: input.dueDate ?? selectedPhase.planDate,
        };
        const tasks = get().definitions.map((definition) => createTaskForMaterial(material, definition));

        set((state) => ({
          materials: [...state.materials, material],
          tasks: [...state.tasks, ...tasks],
          selectedProjectId: project.id,
          selectedProductId: product.id,
          selectedPhaseId: selectedPhase.id,
        }));
        return material.id;
      },

      importWorkbookRows: ({ projectId, productId, phaseId, definitions: importedDefinitions, materials: importedMaterials }) => {
        const project = get().projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId)
          ?? findProductByPhase(project, phaseId);
        const phase = product?.phases.find(({ id }) => id === phaseId);
        if (!project || !product || !phase) return { createdCount: 0, updatedCount: 0 };

        let result = { createdCount: 0, updatedCount: 0 };
        set((state) => {
          const now = new Date().toISOString();
          const nextDefinitions = [...state.definitions];
          const nextMaterials = [...state.materials];
          const nextTasks = [...state.tasks];
          const existingKeys = new Set(nextDefinitions.map(({ key }) => key));
          const definitionKeyMap = new Map();
          const taskIndex = new Map(
            nextTasks.map((task, index) => [`${task.materialId}:${task.definitionKey}`, index]),
          );

          importedDefinitions.forEach((importedDefinition) => {
            const existing = nextDefinitions.find((definition) => (
              normalizeDefinitionToken(definition.label)
              === normalizeDefinitionToken(importedDefinition.label)
            ));
            let definition = existing;
            if (!definition) {
              definition = {
                key: createDefinitionKey(
                  trimOr(importedDefinition.label, "未命名交付项"),
                  trimOr(importedDefinition.category, "其他"),
                  existingKeys,
                ),
                label: trimOr(importedDefinition.label, "未命名交付项"),
                category: trimOr(importedDefinition.category, "其他"),
                defaultRole: trimOr(importedDefinition.defaultRole, "待分配"),
              };
              existingKeys.add(definition.key);
              nextDefinitions.push(definition);
              nextMaterials.forEach((material) => {
                const task = createTaskForMaterial(material, definition, { updatedAt: now });
                taskIndex.set(`${material.id}:${definition.key}`, nextTasks.length);
                nextTasks.push(task);
              });
            }
            definitionKeyMap.set(importedDefinition.key, definition.key);
          });

          importedMaterials.forEach((importedMaterial) => {
            let materialIndex = nextMaterials.findIndex((material) => (
              material.projectId === projectId
              && material.productId === product.id
              && material.phaseId === phaseId
              && material.code.toLocaleLowerCase() === importedMaterial.code.toLocaleLowerCase()
            ));
            let material;
            if (materialIndex >= 0) {
              const current = nextMaterials[materialIndex];
              material = {
                ...current,
                name: trimOr(importedMaterial.name, current.name),
                manufacturer: trimOr(importedMaterial.manufacturer, current.manufacturer),
                quantity: Number.isFinite(Number(importedMaterial.quantity))
                  ? Number(importedMaterial.quantity)
                  : current.quantity,
                dueDate: trimOr(importedMaterial.dueDate, current.dueDate),
              };
              nextMaterials[materialIndex] = material;
              result.updatedCount += 1;
            } else {
              material = {
                id: createId("material"),
                projectId,
                productId: product.id,
                phaseId,
                code: trimOr(importedMaterial.code, `${project.code}-${Date.now().toString().slice(-4)}`),
                name: trimOr(importedMaterial.name, "未命名物料"),
                manufacturer: trimOr(importedMaterial.manufacturer),
                quantity: Number.isFinite(Number(importedMaterial.quantity))
                  ? Number(importedMaterial.quantity)
                  : 0,
                dueDate: trimOr(importedMaterial.dueDate, phase.planDate),
              };
              materialIndex = nextMaterials.length;
              nextMaterials.push(material);
              nextDefinitions.forEach((definition) => {
                const task = createTaskForMaterial(material, definition, { updatedAt: now });
                taskIndex.set(`${material.id}:${definition.key}`, nextTasks.length);
                nextTasks.push(task);
              });
              result.createdCount += 1;
            }

            importedDefinitions.forEach((importedDefinition) => {
              const definitionKey = definitionKeyMap.get(importedDefinition.key);
              const index = taskIndex.get(`${material.id}:${definitionKey}`);
              const progress = importedMaterial.progress?.[importedDefinition.key];
              if (index === undefined || !progress || !isTaskStatus(progress.status)) return;
              const task = nextTasks[index];
              nextTasks[index] = {
                ...task,
                status: progress.status,
                notes: progress.notes || task.notes,
                ownerRole: trimOr(importedDefinition.defaultRole, task.ownerRole),
                actualDate: progress.status === TASK_STATUS.DONE
                  ? (task.actualDate || dateOnly(new Date()))
                  : "",
                updatedAt: now,
              };
            });
          });

          return {
            definitions: nextDefinitions,
            materials: nextMaterials,
            tasks: nextTasks,
            selectedProjectId: projectId,
            selectedProductId: product.id,
            selectedPhaseId: phaseId,
          };
        });
        return result;
      },

      importBomItems: ({
        projectId,
        productId,
        phaseId,
        parentMaterialId,
        meta = {},
        items: importedItems = [],
      }) => {
        const project = get().projects.find(({ id }) => id === projectId);
        const product = project?.products.find(({ id }) => id === productId)
          ?? findProductByPhase(project, phaseId);
        const phase = product?.phases.find(({ id }) => id === phaseId);
        if (!project || !product || !phase || !importedItems.length) return null;

        let result = null;
        set((state) => {
          const now = new Date().toISOString();
          const importId = createId("bom-import");
          const nextMaterials = [...state.materials];
          let nextTasks = [...state.tasks];
          let parentMaterial = nextMaterials.find((material) => (
            material.id === parentMaterialId
            && material.projectId === projectId
            && material.productId === product.id
            && material.phaseId === phaseId
          ));
          let parentCreated = false;

          if (!parentMaterial) {
            const assemblyCode = trimOr(meta.assemblyCode, `${project.code}-BOM`);
            parentMaterial = nextMaterials.find((material) => (
              material.projectId === projectId
              && material.productId === product.id
              && material.phaseId === phaseId
              && material.code.toLocaleLowerCase() === assemblyCode.toLocaleLowerCase()
            ));
          }

          if (!parentMaterial) {
            parentMaterial = {
              id: createId("material"),
              projectId,
              productId: product.id,
              phaseId,
              code: trimOr(meta.assemblyCode, `${project.code}-BOM`),
              name: trimOr(meta.assemblyName, `${project.code} BOM组件`),
              manufacturer: "",
              quantity: Number(phase.quantity) || 0,
              dueDate: phase.planDate,
            };
            nextMaterials.push(parentMaterial);
            nextTasks.push(...state.definitions.map((definition) => (
              createTaskForMaterial(parentMaterial, definition, { updatedAt: now })
            )));
            parentCreated = true;
          }

          const existingItems = state.bomItems.filter((item) => (
            item.projectId === projectId
            && item.productId === product.id
            && item.phaseId === phaseId
            && item.parentMaterialId === parentMaterial.id
          ));
          const existingByCode = new Map(
            existingItems.map((item) => [item.code.toLocaleLowerCase(), item]),
          );
          const importedCodes = new Set(importedItems.map((item) => item.code.toLocaleLowerCase()));
          const nextBomItems = state.bomItems.map((item) => (
            item.projectId === projectId
            && item.productId === product.id
            && item.phaseId === phaseId
            && item.parentMaterialId === parentMaterial.id
            && !importedCodes.has(item.code.toLocaleLowerCase())
              ? { ...item, status: BOM_STATUS.REMOVED, updatedAt: now }
              : item
          ));

          let createdCount = 0;
          let updatedCount = 0;
          let unchangedCount = 0;
          let reviewCount = 0;
          for (const importedItem of importedItems) {
            const existing = existingByCode.get(importedItem.code.toLocaleLowerCase());
            const changed = existing
              ? bomItemFingerprint(existing) !== bomItemFingerprint(importedItem)
              : false;
            const reintroduced = existing?.status === BOM_STATUS.REMOVED;
            const needsReview = Boolean(existing && (changed || reintroduced) && existing.status === BOM_STATUS.READY);
            const status = needsReview || reintroduced
              ? BOM_STATUS.PENDING
              : (existing?.status ?? BOM_STATUS.PENDING);
            const nextItem = {
              ...(existing ?? {}),
              id: existing?.id ?? createId("bom-item"),
              projectId,
              productId: product.id,
              phaseId,
              parentMaterialId: parentMaterial.id,
              importId,
              itemNo: trimOr(importedItem.itemNo),
              code: trimOr(importedItem.code),
              name: trimOr(importedItem.name, importedItem.code),
              internalCode: trimOr(importedItem.internalCode),
              comment: trimOr(importedItem.comment),
              spec: trimOr(importedItem.spec),
              type: trimOr(importedItem.type),
              pad: trimOr(importedItem.pad),
              description: trimOr(importedItem.description),
              unitQuantity: Number(importedItem.unitQuantity) || 0,
              designator: trimOr(importedItem.designator),
              vendors: Array.isArray(importedItem.vendors) ? importedItem.vendors : [],
              mpns: Array.isArray(importedItem.mpns) ? importedItem.mpns : [],
              status,
              owner: existing?.owner ?? "",
              ownerAccountId: existing?.ownerAccountId ?? "",
              issue: needsReview ? "BOM 信息已变更，请重新确认" : (existing?.issue ?? ""),
              eta: existing?.eta ?? "",
              confirmedBy: status === BOM_STATUS.READY ? (existing?.confirmedBy ?? "") : "",
              confirmedByAccountId: status === BOM_STATUS.READY
                ? (existing?.confirmedByAccountId ?? "")
                : "",
              confirmedAt: status === BOM_STATUS.READY ? (existing?.confirmedAt ?? "") : "",
              sourceRow: Number(importedItem.sourceRow) || 0,
              sourceSheet: trimOr(meta.sheetName),
              sourceVersion: trimOr(meta.version),
              updatedAt: now,
            };
            const index = existing
              ? nextBomItems.findIndex((item) => item.id === existing.id)
              : -1;
            if (index >= 0) nextBomItems[index] = nextItem;
            else nextBomItems.push(nextItem);

            if (!existing) createdCount += 1;
            else if (changed || reintroduced) updatedCount += 1;
            else unchangedCount += 1;
            if (needsReview) reviewCount += 1;
          }

          const removedCount = existingItems.filter((item) => (
            !importedCodes.has(item.code.toLocaleLowerCase())
            && item.status !== BOM_STATUS.REMOVED
          )).length;
          nextTasks = syncMaterialReadinessTask(nextTasks, nextBomItems, parentMaterial.id, now);
          const bomImport = {
            id: importId,
            projectId,
            productId: product.id,
            phaseId,
            parentMaterialId: parentMaterial.id,
            fileName: trimOr(meta.fileName, "BOM.xlsx"),
            sheetName: trimOr(meta.sheetName, "BOM"),
            productModel: trimOr(meta.productModel),
            assemblyCode: trimOr(meta.assemblyCode),
            assemblyName: trimOr(meta.assemblyName),
            version: trimOr(meta.version),
            itemCount: importedItems.length,
            importedAt: now,
          };
          result = {
            parentMaterialId: parentMaterial.id,
            parentCreated,
            createdCount,
            updatedCount,
            unchangedCount,
            reviewCount,
            removedCount,
          };
          return {
            materials: nextMaterials,
            tasks: nextTasks,
            bomItems: nextBomItems,
            bomImports: [...state.bomImports, bomImport],
            selectedProjectId: projectId,
            selectedProductId: product.id,
            selectedPhaseId: phaseId,
          };
        });
        return result;
      },

      assignBomItems: (itemIds = [], accountId = null) => {
        const ids = new Set(itemIds);
        if (!ids.size) return 0;
        const account = accountId
          ? get().accounts.find((item) => item.id === accountId && item.active)
          : null;
        if (accountId && !account) return 0;
        const count = get().bomItems.filter((item) => ids.has(item.id)).length;
        if (!count) return 0;
        const now = new Date().toISOString();
        set((state) => ({
          bomItems: state.bomItems.map((item) => ids.has(item.id)
            ? {
              ...item,
              ownerAccountId: account?.id ?? "",
              owner: account?.name ?? "",
              updatedAt: now,
            }
            : item),
        }));
        return count;
      },

      updateBomItem: (itemId, patch = {}) => {
        const current = get().bomItems.find((item) => item.id === itemId);
        if (!current) return false;
        const requestedStatus = isBomStatus(patch.status) ? patch.status : current.status;
        const currentAccount = get().accounts.find(({ id }) => id === get().currentAccountId) ?? null;
        const becomingReady = requestedStatus === BOM_STATUS.READY
          && current.status !== BOM_STATUS.READY;
        const now = new Date().toISOString();
        set((state) => {
          const nextBomItems = state.bomItems.map((item) => item.id === itemId
            ? {
              ...item,
              ...patch,
              id: item.id,
              status: requestedStatus,
              confirmedBy: requestedStatus === BOM_STATUS.READY
                ? (becomingReady ? (currentAccount?.name ?? "") : item.confirmedBy)
                : "",
              confirmedByAccountId: requestedStatus === BOM_STATUS.READY
                ? (becomingReady ? (currentAccount?.id ?? "") : item.confirmedByAccountId)
                : "",
              confirmedAt: requestedStatus === BOM_STATUS.READY
                ? (becomingReady ? now : item.confirmedAt)
                : "",
              updatedAt: now,
            }
            : item);
          return {
            bomItems: nextBomItems,
            tasks: syncMaterialReadinessTask(
              state.tasks,
              nextBomItems,
              current.parentMaterialId,
              now,
            ),
          };
        });
        return true;
      },

      resetData: () => {
        const accounts = createDefaultAccounts();
        const seed = createSeedData();
        const ensured = ensureWorkflowState(seed.projects, seed.workflowItems ?? [], seed.meetings ?? []);
        const referenced = addProductReferences({ ...seed, ...ensured, bomItems: [], bomImports: [] });
        set({
          ...seed,
          ...referenced,
          accounts,
          currentAccountId: accounts[0]?.id ?? null,
          bomItems: [],
          bomImports: [],
          quotations: [],
          selectedProjectId: initialProjectId,
          selectedProductId: initialProductId,
          selectedPhaseId: initialPhaseId,
          revision: 0,
          permissions: { canManage: true, canAssign: true, canImport: true },
          serverBacked: false,
        });
      },
    }),
);

export default useNpiStore;
