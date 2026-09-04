import { z } from "zod";
import { isBomStatus } from "../src/domain/bom.js";
import { isTaskStatus } from "../src/domain/statuses.js";

const idSchema = z.string().min(1).max(200);
const shortText = z.string().max(500);
const longText = z.string().max(10_000);
const dateText = z.string().max(64);

const phaseSchema = z.object({
  id: idSchema,
  type: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  planDate: dateText,
  quantity: z.number().finite(),
}).passthrough();

const projectSchema = z.object({
  id: idSchema,
  code: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  productLine: shortText,
  manager: shortText,
  managerAccountId: z.string().max(200).optional().default(""),
  type: shortText,
  phases: z.array(phaseSchema).min(1).max(100),
}).passthrough();

const materialSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  phaseId: idSchema,
  code: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  manufacturer: shortText.optional().default(""),
  quantity: z.number().finite(),
  dueDate: dateText,
}).passthrough();

const definitionSchema = z.object({
  key: idSchema,
  label: z.string().min(1).max(500),
  category: z.string().min(1).max(200),
  defaultRole: shortText,
}).passthrough();

const evidenceSchema = z.object({
  id: z.string().max(200).optional().default(""),
  name: z.string().min(1).max(500),
  type: z.string().max(200).optional().default(""),
  size: z.number().nonnegative().optional().default(0),
  addedAt: dateText.optional().default(""),
}).passthrough();

const taskSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  phaseId: idSchema,
  materialId: idSchema,
  definitionKey: idSchema,
  status: z.string().refine(isTaskStatus),
  owner: shortText,
  ownerAccountId: z.string().max(200).optional().default(""),
  ownerRole: shortText,
  baselineDate: dateText,
  forecastDate: dateText,
  actualDate: dateText.nullable(),
  blocker: longText,
  notes: longText,
  evidence: z.array(evidenceSchema).max(20),
  updatedAt: dateText,
}).passthrough();

const workflowItemSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  phaseId: idSchema,
  stageType: z.string().min(1).max(20),
  kind: z.enum(["checkpoint", "deliverable"]),
  key: idSchema,
  title: z.string().min(1).max(500),
  criterion: longText.optional().default(""),
  order: z.number().int().nonnegative().optional().default(0),
  status: z.string().refine(isTaskStatus),
  owner: shortText,
  ownerAccountId: z.string().max(200).optional().default(""),
  ownerRole: shortText,
  baselineDate: dateText,
  forecastDate: dateText,
  actualDate: dateText.nullable(),
  blocker: longText,
  notes: longText,
  evidence: z.array(evidenceSchema).max(20),
  updatedAt: dateText,
}).passthrough();

const bomItemSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  phaseId: idSchema,
  parentMaterialId: idSchema,
  importId: idSchema,
  itemNo: z.string().max(200).optional().default(""),
  code: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  internalCode: shortText.optional().default(""),
  comment: longText.optional().default(""),
  spec: shortText.optional().default(""),
  type: shortText.optional().default(""),
  pad: shortText.optional().default(""),
  description: longText.optional().default(""),
  unitQuantity: z.number().finite().optional().default(0),
  designator: shortText.optional().default(""),
  vendors: z.array(shortText).max(50).optional().default([]),
  mpns: z.array(shortText).max(50).optional().default([]),
  status: z.string().refine(isBomStatus),
  owner: shortText.optional().default(""),
  ownerAccountId: z.string().max(200).optional().default(""),
  issue: longText.optional().default(""),
  eta: dateText.optional().default(""),
  confirmedBy: shortText.optional().default(""),
  confirmedByAccountId: z.string().max(200).optional().default(""),
  confirmedAt: dateText.optional().default(""),
  sourceRow: z.number().int().nonnegative().optional().default(0),
  sourceSheet: shortText.optional().default(""),
  sourceVersion: shortText.optional().default(""),
  updatedAt: dateText,
}).passthrough();

const bomImportSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  phaseId: idSchema,
  parentMaterialId: idSchema,
  fileName: z.string().min(1).max(500),
  sheetName: z.string().min(1).max(500),
  productModel: shortText.optional().default(""),
  assemblyCode: shortText.optional().default(""),
  assemblyName: shortText.optional().default(""),
  version: shortText.optional().default(""),
  itemCount: z.number().int().nonnegative(),
  importedAt: dateText,
}).passthrough();

export const businessStateSchema = z.object({
  projects: z.array(projectSchema).max(2_000),
  materials: z.array(materialSchema).max(100_000),
  definitions: z.array(definitionSchema).max(1_000),
  tasks: z.array(taskSchema).max(250_000),
  workflowItems: z.array(workflowItemSchema).max(100_000).optional().default([]),
  bomItems: z.array(bomItemSchema).max(250_000).optional().default([]),
  bomImports: z.array(bomImportSchema).max(20_000).optional().default([]),
});

export function parseBusinessState(input) {
  const parsed = businessStateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join("；"),
    };
  }

  const state = parsed.data;
  const hasDuplicate = (values) => new Set(values).size !== values.length;
  const duplicateIds = hasDuplicate(state.projects.map(({ id }) => id))
    || state.projects.some((project) => hasDuplicate(project.phases.map(({ id }) => id)))
    || hasDuplicate(state.materials.map(({ id }) => id))
    || hasDuplicate(state.definitions.map(({ key }) => key))
    || hasDuplicate(state.tasks.map(({ id }) => id))
    || hasDuplicate(state.workflowItems.map(({ id }) => id))
    || hasDuplicate(state.bomItems.map(({ id }) => id))
    || hasDuplicate(state.bomImports.map(({ id }) => id));
  if (duplicateIds) {
    return { success: false, error: "业务数据包含重复的项目、阶段、物料、任务或 BOM 标识" };
  }

  const projectIds = new Set(state.projects.map(({ id }) => id));
  const phaseIdsByProject = new Map(state.projects.map((project) => [
    project.id,
    new Set(project.phases.map(({ id }) => id)),
  ]));
  const materialById = new Map(state.materials.map((material) => [material.id, material]));
  const definitionKeys = new Set(state.definitions.map(({ key }) => key));
  const invalidReference = state.materials.some((material) => (
    !projectIds.has(material.projectId)
    || !phaseIdsByProject.get(material.projectId)?.has(material.phaseId)
  )) || state.tasks.some((task) => (
    !projectIds.has(task.projectId)
    || !phaseIdsByProject.get(task.projectId)?.has(task.phaseId)
    || materialById.get(task.materialId)?.projectId !== task.projectId
    || materialById.get(task.materialId)?.phaseId !== task.phaseId
    || !definitionKeys.has(task.definitionKey)
  )) || state.workflowItems.some((item) => (
    !projectIds.has(item.projectId)
    || !phaseIdsByProject.get(item.projectId)?.has(item.phaseId)
  )) || state.bomItems.some((item) => (
    !projectIds.has(item.projectId)
    || !phaseIdsByProject.get(item.projectId)?.has(item.phaseId)
    || materialById.get(item.parentMaterialId)?.projectId !== item.projectId
    || materialById.get(item.parentMaterialId)?.phaseId !== item.phaseId
  )) || state.bomImports.some((item) => (
    !projectIds.has(item.projectId)
    || !phaseIdsByProject.get(item.projectId)?.has(item.phaseId)
    || materialById.get(item.parentMaterialId)?.projectId !== item.projectId
    || materialById.get(item.parentMaterialId)?.phaseId !== item.phaseId
  ));

  return invalidReference
    ? { success: false, error: "业务数据包含无效的项目、阶段、物料或任务引用" }
    : { success: true, data: state };
}
