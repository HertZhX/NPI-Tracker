import { PRODUCT_FILE_SCOPE } from "./productFiles.js";

function safeIdPart(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function legacyProductName(project) {
  const productLine = String(project?.productLine || "").trim();
  if (productLine && productLine !== "未分类产品线") return productLine;
  const projectName = String(project?.name || "").trim();
  const projectCode = String(project?.code || "").trim();
  const simplified = projectName
    .replace(projectCode, "")
    .replace(/新品导入/g, "")
    .trim();
  return simplified || "默认产品";
}

export const PROJECT_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
});

export function isProjectManuallyCompleted(project) {
  return project?.status === PROJECT_STATUS.COMPLETED;
}

export function ensureProjectProducts(projects = []) {
  return projects.map((project) => {
    const legacyManager = String(project?.manager || "").trim();
    const legacyManagerAccountId = String(project?.managerAccountId || "").trim();
    const sourceProducts = Array.isArray(project.products) && project.products.length
      ? project.products
      : [{
        id: `product-${safeIdPart(project.id || project.code)}-default`,
        name: legacyProductName(project),
        partNumber: String(project?.partNumber || "").trim(),
        version: String(project?.version || "").trim(),
        manager: legacyManager,
        managerAccountId: legacyManagerAccountId,
        phases: Array.isArray(project.phases) ? project.phases : [],
      }];
    const products = sourceProducts.map((product, index) => ({
      id: String(product.id || `product-${safeIdPart(project.id || project.code)}-${index + 1}`),
      name: String(product.name || `产品 ${index + 1}`).trim() || `产品 ${index + 1}`,
      partNumber: String(product.partNumber || "").trim(),
      version: String(product.version || "").trim(),
      manager: String(product.manager || legacyManager || "待分配").trim() || "待分配",
      managerAccountId: String(product.managerAccountId || legacyManagerAccountId || "").trim(),
      workflowStatus: ["active", "completed", "cancelled"].includes(product.workflowStatus)
        ? product.workflowStatus
        : "active",
      terminalStageType: String(product.terminalStageType || "").trim(),
      workflowCompletedAt: String(product.workflowCompletedAt || "").trim(),
      workflowCompletedBy: String(product.workflowCompletedBy || "").trim(),
      workflowCompletedByAccountId: String(product.workflowCompletedByAccountId || "").trim(),
      workflowCompletionNote: String(product.workflowCompletionNote || "").trim(),
      phases: Array.isArray(product.phases) ? product.phases : [],
    }));
    const firstProduct = products[0];
    return {
      ...project,
      name: String(project.name || project.code || "").trim(),
      status: project.status === PROJECT_STATUS.COMPLETED
        ? PROJECT_STATUS.COMPLETED
        : PROJECT_STATUS.ACTIVE,
      completedAt: String(project.completedAt || "").trim(),
      completedBy: String(project.completedBy || "").trim(),
      completedByAccountId: String(project.completedByAccountId || "").trim(),
      completionNote: String(project.completionNote || "").trim(),
      productLine: String(project.productLine || firstProduct.name).trim(),
      manager: "",
      managerAccountId: "",
      phases: firstProduct.phases,
      products,
    };
  });
}

export function findProductByPhase(project, phaseId) {
  return project?.products?.find((product) => (
    product.phases.some((phase) => phase.id === phaseId)
  )) ?? project?.products?.[0] ?? null;
}

export function addProductReferences(state) {
  const projects = ensureProjectProducts(state.projects);
  const productByPhase = new Map();
  const mpPhaseByProduct = new Map();
  projects.forEach((project) => {
    project.products.forEach((product) => {
      const mpPhase = product.phases.find(({ type }) => type === "MP");
      if (mpPhase) mpPhaseByProduct.set(`${project.id}:${product.id}`, mpPhase.id);
      product.phases.forEach((phase) => {
        productByPhase.set(`${project.id}:${phase.id}`, product.id);
      });
    });
  });
  const withProductId = (item) => ({
    ...item,
    productId: item.productId || productByPhase.get(`${item.projectId}:${item.phaseId}`) || "",
  });
  const withProductFileMpPhase = (item) => {
    const referenced = withProductId(item);
    const mpPhaseId = mpPhaseByProduct.get(`${referenced.projectId}:${referenced.productId}`);
    return referenced.trackingScope === PRODUCT_FILE_SCOPE && mpPhaseId
      ? { ...referenced, phaseId: mpPhaseId }
      : referenced;
  };
  return {
    ...state,
    projects,
    materials: (state.materials ?? []).map(withProductFileMpPhase),
    tasks: (state.tasks ?? []).map(withProductFileMpPhase),
    workflowItems: (state.workflowItems ?? []).map(withProductId),
    meetings: (state.meetings ?? []).map(withProductId),
    bomItems: (state.bomItems ?? []).map(withProductId),
    bomImports: (state.bomImports ?? []).map(withProductId),
  };
}
