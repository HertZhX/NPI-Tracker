let csrfToken = "";

export class ApiError extends Error {
  constructor(status, code, message, requestId = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function request(path, { method = "GET", body, allowAnonymous = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    headers["X-NPI-Request"] = "1";
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "无法连接 NPI 服务，请确认服务端已启动");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error ?? {};
    if (response.status === 401 && !allowAnonymous) csrfToken = "";
    throw new ApiError(
      response.status,
      error.code || "REQUEST_FAILED",
      error.message || "请求失败",
      error.requestId || response.headers.get("X-Request-Id") || "",
    );
  }
  if (payload.csrfToken) csrfToken = payload.csrfToken;
  return payload;
}

async function requestFile(path) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "*/*" },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "无法连接 NPI 服务，请确认服务端已启动");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = payload.error ?? {};
    if (response.status === 401) csrfToken = "";
    throw new ApiError(
      response.status,
      error.code || "REQUEST_FAILED",
      error.message || "附件读取失败",
      error.requestId || response.headers.get("X-Request-Id") || "",
    );
  }
  return response.blob();
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export const npiApi = Object.freeze({
  login: (credentials) => request("/api/auth/login", {
    method: "POST",
    body: credentials,
    allowAnonymous: true,
  }),
  me: () => request("/api/auth/me", { allowAnonymous: true }),
  logout: () => request("/api/auth/logout", { method: "POST", body: {} }),
  changePassword: (input) => request("/api/auth/change-password", {
    method: "POST",
    body: input,
  }),
  getState: () => request("/api/state"),
  replaceBusinessState: (state, expectedRevision) => request("/api/admin/state", {
    method: "PUT",
    body: { state, expectedRevision },
  }),
  createAccount: (input) => request("/api/admin/accounts", { method: "POST", body: input }),
  updateAccount: (accountId, patch) => request(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    body: patch,
  }),
  deleteAccount: (accountId) => request(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  }),
  deleteProject: (projectId, expectedRevision) => request(`/api/admin/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    body: { expectedRevision },
  }),
  updateProjectStatus: (projectId, status, note, expectedRevision) => request(
    `/api/admin/projects/${encodeURIComponent(projectId)}/status`,
    {
      method: "PATCH",
      body: { status, note, expectedRevision },
    },
  ),
  updateProjectDetails: (projectId, input, expectedRevision) => request(
    `/api/admin/projects/${encodeURIComponent(projectId)}`,
    { method: "PATCH", body: { ...input, expectedRevision } },
  ),
  updateProductDetails: (projectId, productId, input, expectedRevision) => request(
    `/api/admin/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(productId)}`,
    { method: "PATCH", body: { ...input, expectedRevision } },
  ),
  deleteProduct: (projectId, productId, expectedRevision) => request(
    `/api/admin/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(productId)}`,
    {
      method: "DELETE",
      body: { expectedRevision },
    },
  ),
  deleteStage: (projectId, productId, phaseId, expectedRevision) => request(
    `/api/admin/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(productId)}/phases/${encodeURIComponent(phaseId)}`,
    {
      method: "DELETE",
      body: { expectedRevision },
    },
  ),
  resetPassword: (accountId) => request(`/api/admin/accounts/${encodeURIComponent(accountId)}/reset-password`, {
    method: "POST",
    body: {},
  }),
  updateTask: (taskId, patch) => request(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: patch,
  }),
  updateWorkflowItem: (itemId, patch) => request(`/api/workflow-items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: patch,
  }),
  createWorkflowItem: (input, expectedRevision) => request("/api/admin/workflow-items", {
    method: "POST",
    body: { ...input, expectedRevision },
  }),
  setWorkflowItemArchived: (itemId, archived, reason, expectedRevision) => request(
    `/api/admin/workflow-items/${encodeURIComponent(itemId)}/archive`,
    { method: "PATCH", body: { archived, reason, expectedRevision } },
  ),
  updateMeeting: (meetingId, patch) => request(`/api/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    body: patch,
  }),
  transitionStage: (projectId, productId, phaseId, input, expectedRevision) => request(
    `/api/admin/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(productId)}/phases/${encodeURIComponent(phaseId)}/transition`,
    { method: "POST", body: { ...input, expectedRevision } },
  ),
  syncAttachments: async (entityType, entityId, {
    files = [],
    deleteIds = [],
    legacyEvidence = [],
  } = {}) => {
    const route = entityType === "task"
      ? "tasks"
      : entityType === "meeting"
        ? "meetings"
        : "workflow-items";
    const encodedFiles = await Promise.all(files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      contentBase64: await fileToBase64(file),
    })));
    return request(`/api/${route}/${encodeURIComponent(entityId)}/attachments`, {
      method: "POST",
      body: { files: encodedFiles, deleteIds, legacyEvidence },
    });
  },
  attachmentPreviewUrl: (attachmentId) => (
    `/api/attachments/${encodeURIComponent(attachmentId)}/preview`
  ),
  attachmentDownloadUrl: (attachmentId) => (
    `/api/attachments/${encodeURIComponent(attachmentId)}/download`
  ),
  getAttachmentPreview: (attachmentId) => requestFile(
    `/api/attachments/${encodeURIComponent(attachmentId)}/preview`,
  ),
  updateBomItem: (itemId, patch) => request(`/api/bom-items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: patch,
  }),
  uploadQuotation: async (bomItemId, { vendor, file }) => request("/api/quotations", {
    method: "POST",
    body: {
      bomItemId,
      vendor,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      contentBase64: await fileToBase64(file),
    },
  }),
  importQuotationTable: async ({ vendor, file, matches }) => request("/api/quotations/import", {
    method: "POST",
    body: {
      vendor,
      matches,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      contentBase64: await fileToBase64(file),
    },
  }),
  deleteQuotation: (quotationId) => request(`/api/quotations/${encodeURIComponent(quotationId)}`, {
    method: "DELETE",
    body: {},
  }),
  quotationDownloadUrl: (quotationId) => `/api/quotations/${encodeURIComponent(quotationId)}/download`,
  bulkAssignBom: (itemIds, accountId) => request("/api/admin/bom-items/bulk-assign", {
    method: "POST",
    body: { itemIds, accountId },
  }),
  bulkReadyBom: (input, expectedRevision) => request("/api/admin/bom-items/bulk-ready", {
    method: "POST",
    body: { ...input, expectedRevision },
  }),
  getAuditLog: (limit = 100) => request(`/api/admin/audit?limit=${encodeURIComponent(limit)}`),
  clearSession: () => {
    csrfToken = "";
  },
});

export default npiApi;
