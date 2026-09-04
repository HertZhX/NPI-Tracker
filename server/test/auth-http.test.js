import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNpiServer } from "../app.mjs";
import { NpiRepository } from "../repository.mjs";
import { hashPassword, validatePassword } from "../security.mjs";

const ORIGIN = "http://127.0.0.1:4173";
const ADMIN_USERNAME = "admin";
const ADMIN_INITIAL_PASSWORD = "AdminInit123!";
const ADMIN_PASSWORD = "Admin123";
const MEMBER_PASSWORD = "Member12";
const START_TIME = "2026-07-27T06:30:00.000Z";

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = "";
    this.csrfToken = "";
  }

  async request(path, {
    method = "GET",
    body,
    headers = {},
    security = method !== "GET",
  } = {}) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
    if (this.cookie) requestHeaders.Cookie = this.cookie;
    if (security) {
      requestHeaders.Origin = ORIGIN;
      requestHeaders["X-NPI-Request"] = "1";
      if (this.csrfToken) requestHeaders["X-CSRF-Token"] = this.csrfToken;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = response.headers.getSetCookie();
    const sessionCookie = setCookies.find((value) => value.startsWith("npi_session="));
    if (sessionCookie) {
      const pair = sessionCookie.split(";", 1)[0];
      this.cookie = pair === "npi_session=" ? "" : pair;
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (payload?.csrfToken) this.csrfToken = payload.csrfToken;
    return {
      status: response.status,
      body: payload,
      headers: response.headers,
      setCookies,
    };
  }

  copySessionFrom(other) {
    this.cookie = other.cookie;
    this.csrfToken = other.csrfToken;
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createFixture({ dbPath = ":memory:" } = {}) {
  let currentTime = new Date(START_TIME);
  const clock = () => new Date(currentTime);
  const repository = await NpiRepository.open({
    dbPath,
    bootstrapPassword: ADMIN_INITIAL_PASSWORD,
    clock,
  });
  const server = createNpiServer({
    repository,
    allowedOrigins: [ORIGIN],
    clock,
    secureCookies: true,
  });
  await listen(server);
  const address = server.address();
  return {
    repository,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    client() {
      return new ApiClient(this.baseUrl);
    },
    setTime(value) {
      currentTime = new Date(value);
    },
    async close() {
      await closeServer(server);
      repository.close();
    },
  };
}

async function login(client, username, password) {
  return client.request("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
}

async function activate(client, username, initialPassword, newPassword) {
  const loggedIn = await login(client, username, initialPassword);
  expect(loggedIn.status).toBe(200);
  expect(loggedIn.body.account.mustChangePassword).toBe(true);
  const changed = await client.request("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: initialPassword, newPassword },
  });
  expect(changed.status).toBe(200);
  expect(changed.body.account.mustChangePassword).toBe(false);
  return changed.body.account;
}

async function activateAdmin(fixture) {
  const client = fixture.client();
  const account = await activate(
    client,
    ADMIN_USERNAME,
    ADMIN_INITIAL_PASSWORD,
    ADMIN_PASSWORD,
  );
  expect(account.systemRole).toBe("admin");
  return client;
}

async function createMember(admin, suffix) {
  const response = await admin.request("/api/admin/accounts", {
    method: "POST",
    body: {
      username: `member-${suffix}`,
      name: `Member ${suffix}`,
      department: "Quality",
      jobRole: "QE",
      systemRole: "member",
    },
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function createAndActivateMember(fixture, admin, suffix) {
  const created = await createMember(admin, suffix);
  const client = fixture.client();
  const account = await activate(
    client,
    created.account.username,
    created.initialPassword,
    MEMBER_PASSWORD,
  );
  return { ...created, account, client };
}

function businessStateFrom(payload) {
  return {
    projects: payload.projects,
    materials: payload.materials,
    definitions: payload.definitions,
    tasks: payload.tasks,
    workflowItems: payload.workflowItems,
    bomItems: payload.bomItems,
    bomImports: payload.bomImports,
  };
}

async function getAdminState(admin) {
  const response = await admin.request("/api/state");
  expect(response.status).toBe(200);
  return response.body;
}

async function addBomItem(admin, overrides = {}) {
  const snapshot = await getAdminState(admin);
  const material = snapshot.materials[0];
  const item = {
    id: overrides.id ?? "bom-item-http-test",
    projectId: material.projectId,
    phaseId: material.phaseId,
    parentMaterialId: material.id,
    importId: "bom-import-http-test",
    itemNo: "1",
    code: "HTTP-001",
    name: "HTTP test component",
    internalCode: "INT-001",
    comment: "",
    spec: "10K",
    type: "resistor",
    pad: "0603",
    description: "",
    unitQuantity: 1,
    designator: "R1",
    vendors: ["Test Vendor"],
    mpns: ["TEST-10K"],
    status: "pending",
    owner: "",
    ownerAccountId: "",
    issue: "",
    eta: "",
    confirmedBy: "",
    confirmedByAccountId: "",
    confirmedAt: "",
    sourceRow: 5,
    sourceSheet: "BOM",
    sourceVersion: "V1",
    updatedAt: START_TIME,
    ...overrides,
  };
  const replaced = await admin.request("/api/admin/state", {
    method: "PUT",
    body: {
      state: {
        ...businessStateFrom(snapshot),
        bomItems: [...snapshot.bomItems, item],
      },
      expectedRevision: snapshot.revision,
    },
  });
  expect(replaced.status).toBe(200);
  return item;
}

describe("NPI server authentication and authorization", () => {
  let fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await fixture?.close();
  });

  it("logs in with an HttpOnly cookie, enforces first password change, and rotates the session", async () => {
    const client = fixture.client();
    const loggedIn = await login(client, ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD);

    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.account).toMatchObject({
      username: ADMIN_USERNAME,
      systemRole: "admin",
      mustChangePassword: true,
    });
    const setCookie = loggedIn.setCookies.join("; ");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Secure");
    expect(loggedIn.body).not.toHaveProperty("password");
    expect(loggedIn.body.account).not.toHaveProperty("passwordHash");

    const oldSession = fixture.client();
    oldSession.copySessionFrom(client);
    const blocked = await client.request("/api/state");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const tooShort = await client.request("/api/auth/change-password", {
      method: "POST",
      body: {
        currentPassword: ADMIN_INITIAL_PASSWORD,
        newPassword: "Abcd123",
      },
    });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error).toMatchObject({
      code: "WEAK_PASSWORD",
      message: "密码至少需要 8 位",
    });

    const changed = await client.request("/api/auth/change-password", {
      method: "POST",
      body: {
        currentPassword: ADMIN_INITIAL_PASSWORD,
        newPassword: ADMIN_PASSWORD,
      },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.account.mustChangePassword).toBe(false);
    expect(client.cookie).not.toBe(oldSession.cookie);
    expect((await oldSession.request("/api/auth/me")).status).toBe(401);
    expect((await client.request("/api/state")).status).toBe(200);
    expect((await login(fixture.client(), ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD)).status).toBe(401);
  });

  it("rejects missing request headers, invalid CSRF tokens, and untrusted origins", async () => {
    const admin = await activateAdmin(fixture);
    const payload = { currentPassword: ADMIN_PASSWORD, newPassword: "AnotherAdmin123!" };

    const noMarker = await admin.request("/api/auth/change-password", {
      method: "POST",
      body: payload,
      security: false,
      headers: { Origin: ORIGIN, "X-CSRF-Token": admin.csrfToken },
    });
    expect(noMarker.status).toBe(403);
    expect(noMarker.body.error.code).toBe("REQUEST_HEADER_REQUIRED");

    const badCsrf = await admin.request("/api/auth/change-password", {
      method: "POST",
      body: payload,
      security: false,
      headers: {
        Origin: ORIGIN,
        "X-NPI-Request": "1",
        "X-CSRF-Token": "not-the-session-token",
      },
    });
    expect(badCsrf.status).toBe(403);
    expect(badCsrf.body.error.code).toBe("CSRF_REJECTED");

    const badOrigin = await admin.request("/api/auth/change-password", {
      method: "POST",
      body: payload,
      security: false,
      headers: {
        Origin: "https://attacker.example",
        "X-NPI-Request": "1",
        "X-CSRF-Token": admin.csrfToken,
      },
    });
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body.error.code).toBe("ORIGIN_REJECTED");
    expect((await login(fixture.client(), ADMIN_USERNAME, ADMIN_PASSWORD)).status).toBe(200);
  });

  it("lets admins assign work while members can update only their own task", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "task-owner");
    const other = await createAndActivateMember(fixture, admin, "task-other");
    const snapshot = await getAdminState(admin);
    const task = snapshot.tasks.find(({ definitionKey }) => definitionKey !== "material-readiness");

    const assigned = await admin.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { ownerAccountId: owner.account.id },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.task).toMatchObject({
      ownerAccountId: owner.account.id,
      owner: owner.account.name,
    });

    const ownerUpdate = await owner.client.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { status: "in_progress", notes: "Owner submitted progress", fileVersion: "R02" },
    });
    expect(ownerUpdate.status).toBe(200);
    expect(ownerUpdate.body.task).toMatchObject({
      notes: "Owner submitted progress",
      fileVersion: "R02",
    });

    const otherUpdate = await other.client.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { notes: "Unauthorized overwrite" },
    });
    expect(otherUpdate.status).toBe(403);
    expect(otherUpdate.body.error.code).toBe("TASK_NOT_ASSIGNED");

    const memberAdminAttempt = await owner.client.request("/api/admin/accounts", {
      method: "POST",
      body: {
        username: "forbidden-account",
        name: "Forbidden",
        department: "Test",
        jobRole: "PE",
      },
    });
    expect(memberAdminAttempt.status).toBe(403);

    const forbiddenOwnerChange = await owner.client.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { ownerAccountId: other.account.id },
    });
    expect(forbiddenOwnerChange.status).toBe(400);
    expect(forbiddenOwnerChange.body.error.code).toBe("INVALID_FIELDS");

    const after = await getAdminState(admin);
    expect(after.tasks.find(({ id }) => id === task.id)).toMatchObject({
      ownerAccountId: owner.account.id,
      notes: "Owner submitted progress",
      fileVersion: "R02",
    });

    const ownerState = await owner.client.request("/api/state");
    const otherState = await other.client.request("/api/state");
    expect(ownerState.body.tasks.some(({ id }) => id === task.id)).toBe(true);
    expect(otherState.body.tasks.some(({ id }) => id === task.id)).toBe(false);

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.status).toBe(200);
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorAccountId: owner.account.id,
        action: "TASK_UPDATE",
        entityId: task.id,
        result: "SUCCESS",
      }),
      expect.objectContaining({
        actorAccountId: other.account.id,
        action: "AUTHORIZATION",
        result: "DENIED",
      }),
    ]));
    expect((await owner.client.request("/api/admin/audit")).status).toBe(403);
  });

  it("stores task attachments and protects preview, download, replacement, and deletion", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "attachment-owner");
    const other = await createAndActivateMember(fixture, admin, "attachment-other");
    const snapshot = await getAdminState(admin);
    const task = snapshot.tasks.find(({ definitionKey }) => definitionKey !== "material-readiness");
    await admin.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { ownerAccountId: owner.account.id },
    });

    const content = Buffer.from("料号,状态\nPN-001,完成\n", "utf8");
    const input = {
      files: [{
        fileName: "交付清单.csv",
        mimeType: "text/csv",
        size: content.length,
        contentBase64: content.toString("base64"),
      }],
      deleteIds: [],
      legacyEvidence: [{ name: "旧版记录.pdf", size: 2048 }],
    };

    const forbiddenUpload = await other.client.request(
      `/api/tasks/${encodeURIComponent(task.id)}/attachments`,
      { method: "POST", body: input },
    );
    expect(forbiddenUpload.status).toBe(403);
    expect(forbiddenUpload.body.error.code).toBe("ATTACHMENT_FORBIDDEN");

    const uploaded = await owner.client.request(
      `/api/tasks/${encodeURIComponent(task.id)}/attachments`,
      { method: "POST", body: input },
    );
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.attachments).toHaveLength(1);
    expect(uploaded.body.entity.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "", name: "旧版记录.pdf", size: 2048 }),
      expect.objectContaining({
        name: "交付清单.csv",
        type: "text/csv; charset=utf-8",
        size: content.length,
        addedByAccountId: owner.account.id,
      }),
    ]));
    const attachment = uploaded.body.attachments[0];
    expect(attachment).not.toHaveProperty("content");
    expect(attachment).not.toHaveProperty("contentBase64");

    const forbiddenPreview = await other.client.request(
      `/api/attachments/${encodeURIComponent(attachment.id)}/preview`,
    );
    expect(forbiddenPreview.status).toBe(403);
    expect(forbiddenPreview.body.error.code).toBe("ATTACHMENT_FORBIDDEN");

    const preview = await fetch(
      `${fixture.baseUrl}/api/attachments/${encodeURIComponent(attachment.id)}/preview`,
      { headers: { Cookie: owner.client.cookie } },
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(preview.headers.get("content-disposition")).toContain("inline;");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(content);

    const download = await fetch(
      `${fixture.baseUrl}/api/attachments/${encodeURIComponent(attachment.id)}/download`,
      { headers: { Cookie: owner.client.cookie } },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(content);

    const invalidFile = await owner.client.request(
      `/api/tasks/${encodeURIComponent(task.id)}/attachments`,
      {
        method: "POST",
        body: {
          files: [{
            fileName: "dangerous.html",
            mimeType: "text/html",
            size: 4,
            contentBase64: Buffer.from("test").toString("base64"),
          }],
          deleteIds: [],
          legacyEvidence: [],
        },
      },
    );
    expect(invalidFile.status).toBe(400);
    expect(invalidFile.body.error.code).toBe("INVALID_ATTACHMENT_FILE");

    const removed = await owner.client.request(
      `/api/tasks/${encodeURIComponent(task.id)}/attachments`,
      {
        method: "POST",
        body: {
          files: [],
          deleteIds: [attachment.id],
          legacyEvidence: [{ name: "旧版记录.pdf", size: 2048 }],
        },
      },
    );
    expect(removed.status).toBe(200);
    expect(removed.body.entity.evidence).toEqual([
      expect.objectContaining({ id: "", name: "旧版记录.pdf" }),
    ]);
    expect(fixture.repository.db.prepare("SELECT COUNT(*) AS count FROM attachments").get().count)
      .toBe(0);
    const missing = await owner.client.request(
      `/api/attachments/${encodeURIComponent(attachment.id)}/preview`,
    );
    expect(missing.status).toBe(404);

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "ATTACHMENT_SYNC",
        entityType: "task",
        entityId: task.id,
      }),
    ]));
  });

  it("persists stage-gate assignments and lets only the assigned member submit progress", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "workflow-owner");
    const other = await createAndActivateMember(fixture, admin, "workflow-other");
    const snapshot = await getAdminState(admin);
    const item = snapshot.workflowItems.find(({ stageType, kind }) => (
      stageType === "MP" && kind === "deliverable"
    ));

    const assigned = await admin.request(`/api/workflow-items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: { ownerAccountId: owner.account.id },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.item).toMatchObject({
      ownerAccountId: owner.account.id,
      owner: owner.account.name,
    });

    const submitted = await owner.client.request(`/api/workflow-items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: {
        status: "in_progress",
        notes: "阶段事项已开始",
        fileVersion: "V1.3",
        evidence: [{ name: "评审记录.pdf", size: 1280 }],
      },
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.item).toMatchObject({
      status: "in_progress",
      notes: "阶段事项已开始",
      fileVersion: "V1.3",
      evidence: [expect.objectContaining({ name: "评审记录.pdf" })],
    });

    const attachmentContent = Buffer.from("workflow evidence", "utf8");
    const attachmentUpload = await owner.client.request(
      `/api/workflow-items/${encodeURIComponent(item.id)}/attachments`,
      {
        method: "POST",
        body: {
          files: [{
            fileName: "阶段证据.txt",
            mimeType: "text/plain",
            size: attachmentContent.length,
            contentBase64: attachmentContent.toString("base64"),
          }],
          deleteIds: [],
          legacyEvidence: submitted.body.item.evidence,
        },
      },
    );
    expect(attachmentUpload.status).toBe(200);
    expect(attachmentUpload.body.entity.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "评审记录.pdf", id: "" }),
      expect.objectContaining({ name: "阶段证据.txt" }),
    ]));

    const denied = await other.client.request(`/api/workflow-items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: { notes: "越权修改" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("WORKFLOW_ITEM_NOT_ASSIGNED");

    const ownerState = await owner.client.request("/api/state");
    expect(ownerState.body.workflowItems.find(({ id }) => id === item.id)).toMatchObject({
      status: "in_progress",
      ownerAccountId: owner.account.id,
      fileVersion: "V1.3",
    });
  });

  it("lets only admins delete a project and atomically removes all related business data", async () => {
    const admin = await activateAdmin(fixture);
    const member = await createAndActivateMember(fixture, admin, "project-delete");
    let snapshot = await getAdminState(admin);
    const project = snapshot.projects[0];
    const material = snapshot.materials.find(({ projectId }) => projectId === project.id);
    const bomItem = await addBomItem(admin, {
      id: "bom-item-project-delete",
      projectId: project.id,
      phaseId: material.phaseId,
      parentMaterialId: material.id,
      importId: "bom-import-project-delete",
    });

    snapshot = await getAdminState(admin);
    const importRecord = {
      id: bomItem.importId,
      projectId: project.id,
      phaseId: material.phaseId,
      parentMaterialId: material.id,
      fileName: "project-delete.xlsx",
      sheetName: "BOM",
      productModel: project.code,
      assemblyCode: material.code,
      assemblyName: material.name,
      version: "V1",
      itemCount: 1,
      importedAt: START_TIME,
    };
    const imported = await admin.request("/api/admin/state", {
      method: "PUT",
      body: {
        state: {
          ...businessStateFrom(snapshot),
          bomImports: [...snapshot.bomImports, importRecord],
        },
        expectedRevision: snapshot.revision,
      },
    });
    expect(imported.status).toBe(200);

    const quoteContent = Buffer.from("project quotation evidence", "utf8");
    const quotationUpload = await admin.request("/api/quotations", {
      method: "POST",
      body: {
        bomItemId: bomItem.id,
        vendor: "Project delete vendor",
        fileName: "project-delete-quote.csv",
        mimeType: "text/csv",
        size: quoteContent.length,
        contentBase64: quoteContent.toString("base64"),
      },
    });
    expect(quotationUpload.status).toBe(201);

    const projectTask = snapshot.tasks.find(({ projectId }) => projectId === project.id);
    const attachmentContent = Buffer.from("project attachment evidence", "utf8");
    const attachmentUpload = await admin.request(
      `/api/tasks/${encodeURIComponent(projectTask.id)}/attachments`,
      {
        method: "POST",
        body: {
          files: [{
            fileName: "project-delete-evidence.txt",
            mimeType: "text/plain",
            size: attachmentContent.length,
            contentBase64: attachmentContent.toString("base64"),
          }],
          deleteIds: [],
          legacyEvidence: [],
        },
      },
    );
    expect(attachmentUpload.status).toBe(200);

    snapshot = await getAdminState(admin);
    const endpoint = `/api/admin/projects/${encodeURIComponent(project.id)}`;
    const expectedDeleted = {
      phases: project.phases.length,
      materials: snapshot.materials.filter(({ projectId }) => projectId === project.id).length,
      tasks: snapshot.tasks.filter(({ projectId }) => projectId === project.id).length,
      meetings: snapshot.meetings.filter(({ projectId }) => projectId === project.id).length,
      bomItems: snapshot.bomItems.filter(({ projectId }) => projectId === project.id).length,
      bomImports: snapshot.bomImports.filter(({ projectId }) => projectId === project.id).length,
      attachments: Number(fixture.repository.db.prepare(`
        SELECT COUNT(*) AS count FROM attachments WHERE project_id = ?
      `).get(project.id).count),
      quotations: snapshot.quotations.filter(({ projectId }) => projectId === project.id).length,
    };
    const definitionsBefore = snapshot.definitions.length;

    const unauthenticated = await fixture.client().request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision },
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("AUTH_REQUIRED");

    const forbidden = await member.client.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");

    const stale = await admin.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision - 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("REVISION_CONFLICT");

    const deleted = await admin.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision },
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({
      project: { id: project.id, code: project.code },
      deleted: expectedDeleted,
      revision: snapshot.revision + 1,
    });

    const after = await getAdminState(admin);
    expect(after.projects.some(({ id }) => id === project.id)).toBe(false);
    for (const collection of [after.materials, after.tasks, after.bomItems, after.bomImports]) {
      expect(collection.some(({ projectId }) => projectId === project.id)).toBe(false);
    }
    expect(after.definitions).toHaveLength(definitionsBefore);
    expect(after.revision).toBe(snapshot.revision + 1);

    const lastProject = after.projects[0];
    const lastDeleted = await admin.request(
      `/api/admin/projects/${encodeURIComponent(lastProject.id)}`,
      {
        method: "DELETE",
        body: { expectedRevision: after.revision },
      },
    );
    expect(lastDeleted.status).toBe(200);
    const emptyState = await getAdminState(admin);
    expect(emptyState.projects).toEqual([]);
    expect(emptyState.materials).toEqual([]);
    expect(emptyState.tasks).toEqual([]);
    expect(emptyState.bomItems).toEqual([]);
    expect(emptyState.bomImports).toEqual([]);
    expect(emptyState.quotations).toEqual([]);
    expect(emptyState.definitions).toHaveLength(definitionsBefore);
    expect(fixture.repository.db.prepare("SELECT COUNT(*) AS count FROM attachments").get().count)
      .toBe(0);

    const repeated = await admin.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: emptyState.revision },
    });
    expect(repeated.status).toBe(404);
    expect(repeated.body.error.code).toBe("PROJECT_NOT_FOUND");

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorAccountId: "account-zhangmin",
        action: "PROJECT_DELETE",
        entityType: "project",
        entityId: project.id,
        result: "SUCCESS",
        details: expect.objectContaining({ deleted: expectedDeleted }),
      }),
    ]));
  });

  it("deletes one product with its related records and protects the last product", async () => {
    const admin = await activateAdmin(fixture);
    let snapshot = await getAdminState(admin);
    const project = snapshot.projects[0];
    const removedProduct = project.products[0];
    const retainedProduct = {
      ...removedProduct,
      id: "product-retained-after-delete",
      name: "Retained product",
      partNumber: "KEEP-001",
      phases: removedProduct.phases.map((phase, index) => ({
        ...phase,
        id: `phase-retained-${index}`,
      })),
    };
    const prepared = await admin.request("/api/admin/state", {
      method: "PUT",
      body: {
        state: {
          ...businessStateFrom(snapshot),
          projects: snapshot.projects.map((entry) => entry.id === project.id
            ? { ...entry, products: [...entry.products, retainedProduct] }
            : entry),
        },
        expectedRevision: snapshot.revision,
      },
    });
    expect(prepared.status).toBe(200);

    snapshot = await getAdminState(admin);
    const endpoint = `/api/admin/projects/${encodeURIComponent(project.id)}/products/${encodeURIComponent(removedProduct.id)}`;
    const expectedDeleted = {
      phases: removedProduct.phases.length,
      materials: snapshot.materials.filter(({ productId }) => productId === removedProduct.id).length,
      tasks: snapshot.tasks.filter(({ productId }) => productId === removedProduct.id).length,
      workflowItems: snapshot.workflowItems.filter(({ productId }) => productId === removedProduct.id).length,
      bomItems: snapshot.bomItems.filter(({ productId }) => productId === removedProduct.id).length,
      bomImports: snapshot.bomImports.filter(({ productId }) => productId === removedProduct.id).length,
      attachments: Number(fixture.repository.db.prepare(`
        SELECT COUNT(*) AS count FROM attachments WHERE project_id = ? AND product_id = ?
      `).get(project.id, removedProduct.id).count),
      quotations: snapshot.quotations.filter(({ phaseId }) => removedProduct.phases.some(({ id }) => id === phaseId)).length,
    };
    const deleted = await admin.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision },
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({
      product: { id: removedProduct.id },
      deleted: expectedDeleted,
      revision: snapshot.revision + 1,
    });

    const after = await getAdminState(admin);
    const afterProject = after.projects.find(({ id }) => id === project.id);
    expect(afterProject.products.map(({ id }) => id)).toEqual([retainedProduct.id]);
    for (const collection of [after.materials, after.tasks, after.workflowItems, after.bomItems, after.bomImports]) {
      expect(collection.some(({ productId }) => productId === removedProduct.id)).toBe(false);
    }

    const lastProductDelete = await admin.request(
      `/api/admin/projects/${encodeURIComponent(project.id)}/products/${encodeURIComponent(retainedProduct.id)}`,
      { method: "DELETE", body: { expectedRevision: after.revision } },
    );
    expect(lastProductDelete.status).toBe(409);
    expect(lastProductDelete.body.error.code).toBe("LAST_PRODUCT");

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "PRODUCT_DELETE",
        entityType: "product",
        entityId: removedProduct.id,
      }),
    ]));
  });

  it("lets only admins delete a stage, cascades its records, and protects the last stage", async () => {
    const admin = await activateAdmin(fixture);
    const member = await createAndActivateMember(fixture, admin, "stage-delete");
    let snapshot = await getAdminState(admin);
    const project = snapshot.projects[0];
    const productInput = {
      id: "product-stage-delete-http",
      name: "Stage delete product",
      partNumber: "STAGE-DELETE-HTTP",
      version: "V1.0",
      manager: "张敏",
      managerAccountId: "account-zhangmin",
      phases: [
        { id: "phase-stage-delete-p", type: "P", label: "P 产品验证", planDate: "2026-08-01", quantity: 5 },
        { id: "phase-stage-delete-eb", type: "EB", label: "EB 工程验证", planDate: "2026-09-01", quantity: 30 },
      ],
    };
    const prepared = await admin.request("/api/admin/state", {
      method: "PUT",
      body: {
        state: {
          ...businessStateFrom(snapshot),
          projects: snapshot.projects.map((entry) => entry.id === project.id
            ? { ...entry, products: [...entry.products, productInput] }
            : entry),
        },
        expectedRevision: snapshot.revision,
      },
    });
    expect(prepared.status).toBe(200);
    snapshot = await getAdminState(admin);
    const product = snapshot.projects.find(({ id }) => id === project.id)
      .products.find(({ id }) => id === productInput.id);
    const phase = product.phases.find(({ type }) => type === "EB");
    const endpoint = `/api/admin/projects/${encodeURIComponent(project.id)}/products/${encodeURIComponent(product.id)}/phases/${encodeURIComponent(phase.id)}`;

    const forbidden = await member.client.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision },
    });
    expect(forbidden.status).toBe(403);

    const stale = await admin.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision - 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("REVISION_CONFLICT");

    const belongsToStage = (item) => item.projectId === project.id && item.phaseId === phase.id;
    const expectedDeleted = {
      materials: snapshot.materials.filter(belongsToStage).length,
      tasks: snapshot.tasks.filter(belongsToStage).length,
      workflowItems: snapshot.workflowItems.filter(belongsToStage).length,
      meetings: snapshot.meetings.filter(belongsToStage).length,
      bomItems: snapshot.bomItems.filter(belongsToStage).length,
      bomImports: snapshot.bomImports.filter(belongsToStage).length,
      attachments: Number(fixture.repository.db.prepare(`
        SELECT COUNT(*) AS count FROM attachments
        WHERE project_id = ? AND product_id = ? AND phase_id = ?
      `).get(project.id, product.id, phase.id).count),
      quotations: Number(fixture.repository.db.prepare(`
        SELECT COUNT(*) AS count FROM quotations WHERE project_id = ? AND phase_id = ?
      `).get(project.id, phase.id).count),
    };
    const deleted = await admin.request(endpoint, {
      method: "DELETE",
      body: { expectedRevision: snapshot.revision },
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({
      phase: { id: phase.id },
      deleted: expectedDeleted,
      revision: snapshot.revision + 1,
    });

    snapshot = await getAdminState(admin);
    const remainingProduct = snapshot.projects
      .find(({ id }) => id === project.id)
      .products.find(({ id }) => id === product.id);
    expect(remainingProduct.phases.some(({ id }) => id === phase.id)).toBe(false);
    for (const collection of [snapshot.materials, snapshot.tasks, snapshot.workflowItems, snapshot.bomItems, snapshot.bomImports]) {
      expect(collection.some(belongsToStage)).toBe(false);
    }

    const lastStage = remainingProduct.phases[0];
    const lastStageDelete = await admin.request(
      `/api/admin/projects/${encodeURIComponent(project.id)}/products/${encodeURIComponent(product.id)}/phases/${encodeURIComponent(lastStage.id)}`,
      { method: "DELETE", body: { expectedRevision: snapshot.revision } },
    );
    expect(lastStageDelete.status).toBe(409);
    expect(lastStageDelete.body.error.code).toBe("LAST_STAGE");

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "STAGE_DELETE",
        entityType: "stage",
        entityId: phase.id,
      }),
    ]));
  });

  it("lets admins complete a project early and reopen it without deleting business data", async () => {
    const admin = await activateAdmin(fixture);
    const member = await createAndActivateMember(fixture, admin, "project-status");
    let snapshot = await getAdminState(admin);
    const project = snapshot.projects[0];
    const endpoint = `/api/admin/projects/${encodeURIComponent(project.id)}/status`;
    const recordCounts = {
      products: project.products.length,
      workflowItems: snapshot.workflowItems.filter(({ projectId }) => projectId === project.id).length,
      materials: snapshot.materials.filter(({ projectId }) => projectId === project.id).length,
    };

    const forbidden = await member.client.request(endpoint, {
      method: "PATCH",
      body: { status: "completed", note: "客户取消", expectedRevision: snapshot.revision },
    });
    expect(forbidden.status).toBe(403);

    const stale = await admin.request(endpoint, {
      method: "PATCH",
      body: { status: "completed", note: "客户取消", expectedRevision: snapshot.revision - 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("REVISION_CONFLICT");

    const completed = await admin.request(endpoint, {
      method: "PATCH",
      body: { status: "completed", note: "客户取消，提前结束项目", expectedRevision: snapshot.revision },
    });
    expect(completed.status).toBe(200);
    expect(completed.body.project).toMatchObject({
      id: project.id,
      status: "completed",
      completedByAccountId: "account-zhangmin",
      completionNote: "客户取消，提前结束项目",
    });
    expect(completed.body.project.completedAt).toBeTruthy();

    snapshot = await getAdminState(admin);
    const persisted = snapshot.projects.find(({ id }) => id === project.id);
    expect(persisted).toMatchObject({ status: "completed", completionNote: "客户取消，提前结束项目" });
    expect(persisted.products).toHaveLength(recordCounts.products);
    expect(snapshot.workflowItems.filter(({ projectId }) => projectId === project.id)).toHaveLength(recordCounts.workflowItems);
    expect(snapshot.materials.filter(({ projectId }) => projectId === project.id)).toHaveLength(recordCounts.materials);

    const reopened = await admin.request(endpoint, {
      method: "PATCH",
      body: { status: "active", note: "客户确认重新启动", expectedRevision: snapshot.revision },
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.project).toMatchObject({
      id: project.id,
      status: "active",
      completedAt: "",
      completedBy: "",
      completedByAccountId: "",
      completionNote: "",
    });

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "PROJECT_COMPLETE", entityType: "project", entityId: project.id }),
      expect.objectContaining({ action: "PROJECT_REOPEN", entityType: "project", entityId: project.id }),
    ]));
  });

  it("lets admins add stage items and preserve manual edits to standard items", async () => {
    const admin = await activateAdmin(fixture);
    const member = await createAndActivateMember(fixture, admin, "workflow-create");
    let snapshot = await getAdminState(admin);
    const project = snapshot.projects[0];
    const product = project.products[0];
    const phase = product.phases[0];
    const input = {
      projectId: project.id,
      productId: product.id,
      phaseId: phase.id,
      kind: "checkpoint",
      title: "客户特殊关键任务",
      criterion: "完成客户要求并确认",
      ownerRole: "PE",
      baselineDate: phase.planDate,
      expectedRevision: snapshot.revision,
    };

    const forbidden = await member.client.request("/api/admin/workflow-items", {
      method: "POST",
      body: input,
    });
    expect(forbidden.status).toBe(403);

    const stale = await admin.request("/api/admin/workflow-items", {
      method: "POST",
      body: { ...input, expectedRevision: snapshot.revision - 1 },
    });
    expect(stale.status).toBe(409);

    const misplacedDeliverable = await admin.request("/api/admin/workflow-items", {
      method: "POST",
      body: { ...input, kind: "deliverable" },
    });
    expect(misplacedDeliverable.status).toBe(400);
    expect(misplacedDeliverable.body.error.code).toBe("DELIVERABLE_MP_ONLY");

    const created = await admin.request("/api/admin/workflow-items", {
      method: "POST",
      body: input,
    });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({
      projectId: project.id,
      productId: product.id,
      phaseId: phase.id,
      kind: "checkpoint",
      title: "客户特殊关键任务",
      criterion: "完成客户要求并确认",
      source: "manual",
      customized: true,
      status: "not_started",
    });

    snapshot = await getAdminState(admin);
    expect(snapshot.workflowItems.find(({ id }) => id === created.body.item.id)).toMatchObject({
      title: "客户特殊关键任务",
      source: "manual",
    });

    const standard = snapshot.workflowItems.find((item) => (
      item.phaseId === phase.id && item.source === "standard"
    ));
    const edited = await admin.request(`/api/workflow-items/${encodeURIComponent(standard.id)}`, {
      method: "PATCH",
      body: { title: "项目专用交付名称", criterion: "按项目要求验收" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.item).toMatchObject({
      title: "项目专用交付名称",
      criterion: "按项目要求验收",
      customized: true,
    });

    snapshot = await getAdminState(admin);
    expect(snapshot.workflowItems.find(({ id }) => id === standard.id)).toMatchObject({
      title: "项目专用交付名称",
      criterion: "按项目要求验收",
      customized: true,
    });

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "WORKFLOW_ITEM_CREATE", entityId: created.body.item.id }),
      expect.objectContaining({ action: "WORKFLOW_ITEM_UPDATE", entityId: standard.id }),
    ]));
  });

  it("supports editable names, stage meetings, soft item removal, and sequential stage transition", async () => {
    const admin = await activateAdmin(fixture);
    let snapshot = await getAdminState(admin);
    const project = snapshot.projects[0];
    const product = project.products[0];
    const phase = product.phases.find(({ type }) => type === "P");

    const renamedProject = await admin.request(
      `/api/admin/projects/${encodeURIComponent(project.id)}`,
      {
        method: "PATCH",
        body: { name: "可编辑项目名称", expectedRevision: snapshot.revision },
      },
    );
    expect(renamedProject.status).toBe(200);
    expect(renamedProject.body.project).toMatchObject({ code: project.code, name: "可编辑项目名称" });

    const renamedProduct = await admin.request(
      `/api/admin/projects/${encodeURIComponent(project.id)}/products/${encodeURIComponent(product.id)}`,
      {
        method: "PATCH",
        body: {
          name: "可编辑产品名称",
          partNumber: "EDITABLE-001",
          version: "V2.0",
          expectedRevision: renamedProject.body.revision,
        },
      },
    );
    expect(renamedProduct.status).toBe(200);
    expect(renamedProduct.body.product).toMatchObject({
      name: "可编辑产品名称",
      partNumber: "EDITABLE-001",
      version: "V2.0",
    });

    snapshot = await getAdminState(admin);
    const removable = snapshot.workflowItems.find((item) => (
      item.phaseId === phase.id && item.kind === "checkpoint"
    ));
    const archived = await admin.request(
      `/api/admin/workflow-items/${encodeURIComponent(removable.id)}/archive`,
      {
        method: "PATCH",
        body: { archived: true, reason: "本产品不适用", expectedRevision: snapshot.revision },
      },
    );
    expect(archived.status).toBe(200);
    expect(archived.body.item).toMatchObject({ archiveReason: "本产品不适用" });
    expect(archived.body.item.archivedAt).toBeTruthy();

    const restored = await admin.request(
      `/api/admin/workflow-items/${encodeURIComponent(removable.id)}/archive`,
      {
        method: "PATCH",
        body: { archived: false, reason: "", expectedRevision: archived.body.revision },
      },
    );
    expect(restored.status).toBe(200);
    expect(restored.body.item.archivedAt).toBe("");

    snapshot = await getAdminState(admin);
    const kickoff = snapshot.meetings.find((meeting) => (
      meeting.phaseId === phase.id && meeting.type === "kickoff"
    ));
    const kickoffCompleted = await admin.request(`/api/meetings/${encodeURIComponent(kickoff.id)}`, {
      method: "PATCH",
      body: {
        status: "completed",
        heldAt: "2026-08-01T09:00",
        attendees: ["张敏", "李晨"],
        conclusion: "阶段目标与分工已确认",
      },
    });
    expect(kickoffCompleted.status).toBe(200);
    expect(kickoffCompleted.body.meeting).toMatchObject({
      status: "completed",
      conclusion: "阶段目标与分工已确认",
      completedByAccountId: "account-zhangmin",
    });

    const meetingFile = Buffer.from("meeting minutes", "utf8");
    const attachment = await admin.request(
      `/api/meetings/${encodeURIComponent(kickoff.id)}/attachments`,
      {
        method: "POST",
        body: {
          files: [{
            fileName: "kickoff-minutes.txt",
            mimeType: "text/plain",
            size: meetingFile.length,
            contentBase64: meetingFile.toString("base64"),
          }],
          deleteIds: [],
          legacyEvidence: [],
        },
      },
    );
    expect(attachment.status).toBe(200);
    expect(attachment.body.entity.evidence).toEqual([
      expect.objectContaining({ name: "kickoff-minutes.txt", stored: true }),
    ]);

    snapshot = await getAdminState(admin);
    const checkpoints = snapshot.workflowItems.filter((item) => (
      item.phaseId === phase.id && item.kind === "checkpoint" && !item.archivedAt
    ));
    for (const checkpoint of checkpoints) {
      const completed = await admin.request(`/api/workflow-items/${encodeURIComponent(checkpoint.id)}`, {
        method: "PATCH",
        body: { status: "done" },
      });
      expect(completed.status).toBe(200);
    }

    snapshot = await getAdminState(admin);
    const review = snapshot.meetings.find((meeting) => (
      meeting.phaseId === phase.id && meeting.type === "gate_review"
    ));
    const reviewCompleted = await admin.request(`/api/meetings/${encodeURIComponent(review.id)}`, {
      method: "PATCH",
      body: { status: "completed", heldAt: "2026-08-02T14:00", conclusion: "同意进入 EB" },
    });
    expect(reviewCompleted.status).toBe(200);

    snapshot = await getAdminState(admin);
    const transitioned = await admin.request(
      `/api/admin/projects/${encodeURIComponent(project.id)}/products/${encodeURIComponent(product.id)}/phases/${encodeURIComponent(phase.id)}/transition`,
      {
        method: "POST",
        body: { action: "advance", note: "P 阶段评审通过", expectedRevision: snapshot.revision },
      },
    );
    expect(transitioned.status).toBe(200);
    expect(transitioned.body).toMatchObject({
      phase: { id: phase.id, lifecycle: "completed" },
      nextPhase: { type: "EB", lifecycle: "pending_kickoff" },
      product: { workflowStatus: "active" },
    });
  });

  it("marks all eligible BOM materials ready in one audited operation", async () => {
    const admin = await activateAdmin(fixture);
    await addBomItem(admin, { id: "bom-bulk-ready-a", status: "pending", code: "BULK-A" });
    await addBomItem(admin, { id: "bom-bulk-ready-b", code: "BULK-B" });
    const markedShortage = await admin.request("/api/bom-items/bom-bulk-ready-b", {
      method: "PATCH",
      body: { status: "shortage", issue: "供应商暂时缺料" },
    });
    expect(markedShortage.status).toBe(200);
    const snapshot = await getAdminState(admin);
    const items = snapshot.bomItems.filter(({ id }) => ["bom-bulk-ready-a", "bom-bulk-ready-b"].includes(id));
    expect(items).toHaveLength(2);
    const scope = items[0];

    const completed = await admin.request("/api/admin/bom-items/bulk-ready", {
      method: "POST",
      body: {
        projectId: scope.projectId,
        productId: scope.productId,
        phaseId: scope.phaseId,
        itemIds: items.map(({ id }) => id),
        expectedRevision: snapshot.revision,
      },
    });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ count: 2, shortageCount: 1 });

    const after = await getAdminState(admin);
    expect(after.bomItems.filter(({ id }) => items.some((item) => item.id === id))).toEqual([
      expect.objectContaining({ status: "ready", confirmedByAccountId: "account-zhangmin" }),
      expect.objectContaining({ status: "ready", confirmedByAccountId: "account-zhangmin" }),
    ]);
  });

  it("stores quotation files and scopes upload, listing, download, and deletion to the assigned BOM owner", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "quotation-owner");
    const other = await createAndActivateMember(fixture, admin, "quotation-other");
    const bomItem = await addBomItem(admin, { id: "bom-item-quotation-test" });

    const assigned = await admin.request("/api/admin/bom-items/bulk-assign", {
      method: "POST",
      body: { itemIds: [bomItem.id], accountId: owner.account.id },
    });
    expect(assigned.status).toBe(200);

    const content = Buffer.from("supplier,unit price\n华丝美供应商,12.34\n", "utf8");
    const input = {
      bomItemId: bomItem.id,
      vendor: "华丝美供应商",
      fileName: "供应商报价.csv",
      mimeType: "text/csv",
      size: content.length,
      contentBase64: content.toString("base64"),
    };

    const forbiddenUpload = await other.client.request("/api/quotations", {
      method: "POST",
      body: input,
    });
    expect(forbiddenUpload.status).toBe(403);
    expect(forbiddenUpload.body.error.code).toBe("BOM_NOT_ASSIGNED");

    const invalidName = await owner.client.request("/api/quotations", {
      method: "POST",
      body: { ...input, fileName: "报价\r\nX-Test.pdf" },
    });
    expect(invalidName.status).toBe(400);
    expect(invalidName.body.error.code).toBe("INVALID_QUOTATION_FILE");

    const uploaded = await owner.client.request("/api/quotations", {
      method: "POST",
      body: input,
    });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.quotation).toMatchObject({
      bomItemId: bomItem.id,
      vendor: input.vendor,
      fileName: input.fileName,
      size: content.length,
      uploadedByAccountId: owner.account.id,
    });
    expect(uploaded.body.quotation).not.toHaveProperty("content");
    expect(uploaded.body.quotation).not.toHaveProperty("contentBase64");

    const ownerState = await owner.client.request("/api/state");
    expect(ownerState.status).toBe(200);
    expect(ownerState.body.quotations).toEqual([
      expect.objectContaining({ id: uploaded.body.quotation.id, bomItemId: bomItem.id }),
    ]);
    const otherState = await other.client.request("/api/state");
    expect(otherState.status).toBe(200);
    expect(otherState.body.quotations).toEqual([]);

    const forbiddenDownload = await other.client.request(
      `/api/quotations/${uploaded.body.quotation.id}/download`,
    );
    expect(forbiddenDownload.status).toBe(403);
    expect(forbiddenDownload.body.error.code).toBe("QUOTATION_FORBIDDEN");

    const downloaded = await fetch(
      `${fixture.baseUrl}/api/quotations/${uploaded.body.quotation.id}/download`,
      { headers: { Cookie: owner.client.cookie } },
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(content);

    const forbiddenDelete = await other.client.request(
      `/api/quotations/${uploaded.body.quotation.id}`,
      { method: "DELETE", body: {} },
    );
    expect(forbiddenDelete.status).toBe(403);
    expect(forbiddenDelete.body.error.code).toBe("QUOTATION_DELETE_FORBIDDEN");

    const deleted = await owner.client.request(
      `/api/quotations/${uploaded.body.quotation.id}`,
      { method: "DELETE", body: {} },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.quotation.id).toBe(uploaded.body.quotation.id);
    expect((await owner.client.request("/api/state")).body.quotations).toEqual([]);
  });

  it("imports one quotation table once and links its price rows to BOM items by material code", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "quote-table-owner");
    const other = await createAndActivateMember(fixture, admin, "quote-table-other");
    const firstItem = await addBomItem(admin, {
      id: "bom-quote-table-1",
      code: "2307-0120000",
      internalCode: "INT-2307",
      name: "磁珠",
    });
    const secondItem = await addBomItem(admin, {
      id: "bom-quote-table-2",
      itemNo: "2",
      code: "C-002",
      internalCode: "1010107347",
      name: "电容",
    });
    await admin.request("/api/admin/bom-items/bulk-assign", {
      method: "POST",
      body: { itemIds: [firstItem.id], accountId: owner.account.id },
    });
    await admin.request("/api/admin/bom-items/bulk-assign", {
      method: "POST",
      body: { itemIds: [secondItem.id], accountId: other.account.id },
    });

    const content = Buffer.from("料号,单价\n2307-0120000,0.128\n1010107347,1.25\n", "utf8");
    const input = {
      vendor: "风华",
      fileName: "风华整表报价.csv",
      mimeType: "text/csv",
      size: content.length,
      contentBase64: content.toString("base64"),
      matches: [
        { bomItemId: firstItem.id, materialCode: "23070120000", sourceRow: 2, unitPrice: "0.128", currency: "CNY", vendor: "风华" },
        { bomItemId: secondItem.id, materialCode: "1010107347", sourceRow: 3, unitPrice: "1.25", currency: "CNY", vendor: "风华" },
      ],
    };

    const forbidden = await owner.client.request("/api/quotations/import", {
      method: "POST",
      body: input,
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("BOM_NOT_ASSIGNED");

    const uploaded = await admin.request("/api/quotations/import", {
      method: "POST",
      body: input,
    });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.quotation).toMatchObject({
      vendor: "风华",
      fileName: "风华整表报价.csv",
      matchedItemCount: 2,
    });
    expect(uploaded.body.quotation.matches).toHaveLength(2);
    expect(fixture.repository.db.prepare("SELECT COUNT(*) AS count FROM quotations").get().count).toBe(1);
    expect(fixture.repository.db.prepare("SELECT COUNT(*) AS count FROM quotation_matches").get().count).toBe(2);

    const ownerQuotation = (await owner.client.request("/api/state")).body.quotations[0];
    expect(ownerQuotation.id).toBe(uploaded.body.quotation.id);
    expect(ownerQuotation.matches).toEqual([
      expect.objectContaining({ bomItemId: firstItem.id, unitPrice: "0.128", currency: "CNY" }),
    ]);
    expect(ownerQuotation.matchedItemCount).toBe(1);

    const otherQuotation = (await other.client.request("/api/state")).body.quotations[0];
    expect(otherQuotation.matches).toEqual([
      expect.objectContaining({ bomItemId: secondItem.id, unitPrice: "1.25" }),
    ]);
    const downloaded = await fetch(
      `${fixture.baseUrl}/api/quotations/${uploaded.body.quotation.id}/download`,
      { headers: { Cookie: owner.client.cookie } },
    );
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(content);
  });

  it("records BOM confirmation from the session and preserves it during ordinary edits", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "bom-owner");
    const other = await createAndActivateMember(fixture, admin, "bom-other");
    const bomItem = await addBomItem(admin);

    const assigned = await admin.request("/api/admin/bom-items/bulk-assign", {
      method: "POST",
      body: { itemIds: [bomItem.id], accountId: owner.account.id },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.count).toBe(1);

    const confirmed = await owner.client.request(`/api/bom-items/${bomItem.id}`, {
      method: "PATCH",
      body: { status: "ready", issue: "" },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.item).toMatchObject({
      status: "ready",
      confirmedBy: owner.account.name,
      confirmedByAccountId: owner.account.id,
      confirmedAt: START_TIME,
    });
    const confirmedAt = confirmed.body.item.confirmedAt;

    fixture.setTime("2026-07-27T08:45:00.000Z");
    const ordinaryEdit = await owner.client.request(`/api/bom-items/${bomItem.id}`, {
      method: "PATCH",
      body: { issue: "Supplier evidence attached" },
    });
    expect(ordinaryEdit.status).toBe(200);
    expect(ordinaryEdit.body.item).toMatchObject({
      confirmedBy: owner.account.name,
      confirmedByAccountId: owner.account.id,
      confirmedAt,
      issue: "Supplier evidence attached",
    });

    const forbidden = await other.client.request(`/api/bom-items/${bomItem.id}`, {
      method: "PATCH",
      body: { status: "shortage", issue: "Unauthorized change" },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("BOM_NOT_ASSIGNED");

    const after = await getAdminState(admin);
    expect(after.bomItems.find(({ id }) => id === bomItem.id)).toMatchObject({
      status: "ready",
      confirmedByAccountId: owner.account.id,
      confirmedAt,
      issue: "Supplier evidence attached",
    });
  });

  it("revokes all member sessions when the account is disabled or its password is reset", async () => {
    const admin = await activateAdmin(fixture);
    const disabled = await createAndActivateMember(fixture, admin, "disabled");
    const reset = await createAndActivateMember(fixture, admin, "reset");

    const disableResponse = await admin.request(`/api/admin/accounts/${disabled.account.id}`, {
      method: "PATCH",
      body: { active: false },
    });
    expect(disableResponse.status).toBe(200);
    expect((await disabled.client.request("/api/auth/me")).status).toBe(401);

    const resetResponse = await admin.request(
      `/api/admin/accounts/${reset.account.id}/reset-password`,
      { method: "POST", body: {} },
    );
    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body.initialPassword).toBeTruthy();
    expect(resetResponse.body.account.mustChangePassword).toBe(true);
    expect((await reset.client.request("/api/auth/me")).status).toBe(401);
    expect((await login(fixture.client(), reset.account.username, MEMBER_PASSWORD)).status).toBe(401);

    const relogged = await login(
      fixture.client(),
      reset.account.username,
      resetResponse.body.initialPassword,
    );
    expect(relogged.status).toBe(200);
    expect(relogged.body.account.mustChangePassword).toBe(true);
  });

  it("prevents deleting an account assigned as a product manager", async () => {
    const admin = await activateAdmin(fixture);
    const responsible = await createAndActivateMember(fixture, admin, "product-manager");
    const snapshot = await getAdminState(admin);
    const managedProject = snapshot.projects[0];
    const managedProduct = managedProject.products[0];

    const assigned = await admin.request("/api/admin/state", {
      method: "PUT",
      body: {
        state: {
          ...businessStateFrom(snapshot),
          projects: snapshot.projects.map((project) => project.id === managedProject.id
            ? {
              ...project,
              products: project.products.map((product) => product.id === managedProduct.id
                ? {
                  ...product,
                  manager: responsible.account.name,
                  managerAccountId: responsible.account.id,
                }
                : product),
            }
            : project),
        },
        expectedRevision: snapshot.revision,
      },
    });
    expect(assigned.status).toBe(200);

    const response = await admin.request(`/api/admin/accounts/${responsible.account.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ACCOUNT_IN_USE");
    expect(fixture.repository.getAccount(responsible.account.id)).not.toBeNull();
  });

  it("shows an assigned product to its manager without granting unassigned update access", async () => {
    const admin = await activateAdmin(fixture);
    const responsible = await createAndActivateMember(fixture, admin, "product-manager-scope");
    const snapshot = await getAdminState(admin);
    const managedProject = snapshot.projects[0];
    const managedProduct = managedProject.products[0];

    const assigned = await admin.request("/api/admin/state", {
      method: "PUT",
      body: {
        state: {
          ...businessStateFrom(snapshot),
          projects: snapshot.projects.map((project) => project.id === managedProject.id
            ? {
              ...project,
              products: project.products.map((product) => product.id === managedProduct.id
                ? {
                  ...product,
                  manager: responsible.account.name,
                  managerAccountId: responsible.account.id,
                }
                : product),
            }
            : project),
        },
        expectedRevision: snapshot.revision,
      },
    });
    expect(assigned.status).toBe(200);

    const scoped = await responsible.client.request("/api/state");
    expect(scoped.status).toBe(200);
    expect(scoped.body.projects).toHaveLength(1);
    expect(scoped.body.projects[0].id).toBe(managedProject.id);
    expect(scoped.body.projects[0].products.map(({ id }) => id)).toEqual([managedProduct.id]);
    expect(scoped.body.projects[0].products[0].phases.map(({ id }) => id)).toEqual(
      managedProduct.phases.map(({ id }) => id),
    );
    const expectedWorkflowItems = snapshot.workflowItems.filter(
      ({ productId }) => productId === managedProduct.id,
    );
    expect(scoped.body.workflowItems.map(({ id }) => id)).toEqual(
      expectedWorkflowItems.map(({ id }) => id),
    );
    expect(scoped.body.workflowItems.every(({ projectId, productId }) => (
      projectId === managedProject.id && productId === managedProduct.id
    ))).toBe(true);
    expect(scoped.body.tasks).toEqual([]);
    expect(scoped.body.bomItems).toEqual([]);

    const unassignedItem = scoped.body.workflowItems.find(
      ({ ownerAccountId }) => ownerAccountId !== responsible.account.id,
    );
    expect(unassignedItem).toBeTruthy();
    const forbidden = await responsible.client.request(
      `/api/workflow-items/${encodeURIComponent(unassignedItem.id)}`,
      { method: "PATCH", body: { status: "in_progress" } },
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("WORKFLOW_ITEM_NOT_ASSIGNED");
  });

  it("deletes only unused accounts and preserves responsibility history", async () => {
    const admin = await activateAdmin(fixture);
    const unused = await createAndActivateMember(fixture, admin, "unused-delete");
    const responsible = await createAndActivateMember(fixture, admin, "responsible-delete");

    const memberAttempt = await responsible.client.request(
      `/api/admin/accounts/${unused.account.id}`,
      { method: "DELETE" },
    );
    expect(memberAttempt.status).toBe(403);

    const selfAttempt = await admin.request("/api/admin/accounts/account-zhangmin", {
      method: "DELETE",
    });
    expect(selfAttempt.status).toBe(409);
    expect(selfAttempt.body.error.code).toBe("CANNOT_DELETE_SELF");

    const deleted = await admin.request(`/api/admin/accounts/${unused.account.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body.account).toMatchObject({
      id: unused.account.id,
      username: unused.account.username,
    });
    expect((await unused.client.request("/api/auth/me")).status).toBe(401);
    expect((await getAdminState(admin)).accounts.some(({ id }) => id === unused.account.id)).toBe(false);

    const snapshot = await getAdminState(admin);
    const task = snapshot.tasks.find(({ definitionKey }) => definitionKey !== "material-readiness");
    expect((await admin.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { ownerAccountId: responsible.account.id },
    })).status).toBe(200);
    expect((await responsible.client.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { status: "in_progress", notes: "Responsibility must remain attributable" },
    })).status).toBe(200);
    expect((await admin.request(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { ownerAccountId: "" },
    })).status).toBe(200);

    const historyDelete = await admin.request(`/api/admin/accounts/${responsible.account.id}`, {
      method: "DELETE",
    });
    expect(historyDelete.status).toBe(409);
    expect(historyDelete.body.error.code).toBe("ACCOUNT_IN_USE");
    expect(fixture.repository.getAccount(responsible.account.id)).not.toBeNull();

    const audit = await admin.request("/api/admin/audit?limit=500");
    expect(audit.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "ACCOUNT_DELETE",
        entityId: unused.account.id,
      }),
    ]));
  });

  it("normalizes usernames before rate limiting so whitespace variants cannot bypass it", async () => {
    const variants = ["admin", " admin", "admin ", "  admin  ", "ADMIN"];
    for (const username of variants) {
      const denied = await login(fixture.client(), username, "WrongPassword123!");
      expect(denied.status).toBe(401);
    }

    const limited = await login(fixture.client(), "\tadmin\t", "WrongPassword123!");
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("LOGIN_RATE_LIMIT");
  });

  it("preserves server-owned BOM identity and assignment fields during full-state imports", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "protected-owner");
    const other = await createAndActivateMember(fixture, admin, "protected-other");
    const bomItem = await addBomItem(admin);
    expect((await admin.request("/api/admin/bom-items/bulk-assign", {
      method: "POST",
      body: { itemIds: [bomItem.id], accountId: owner.account.id },
    })).status).toBe(200);
    expect((await owner.client.request(`/api/bom-items/${bomItem.id}`, {
      method: "PATCH",
      body: { status: "ready" },
    })).status).toBe(200);

    const snapshot = await getAdminState(admin);
    const existing = snapshot.bomItems.find(({ id }) => id === bomItem.id);
    const spoofedExisting = {
      ...existing,
      owner: other.account.name,
      ownerAccountId: other.account.id,
      confirmedBy: other.account.name,
      confirmedByAccountId: other.account.id,
      confirmedAt: "2099-01-01T00:00:00.000Z",
    };
    const spoofedNew = {
      ...existing,
      id: "new-ready-spoof",
      code: "NEW-SPOOF-001",
      owner: other.account.name,
      ownerAccountId: other.account.id,
      confirmedBy: other.account.name,
      confirmedByAccountId: other.account.id,
      confirmedAt: "2099-01-01T00:00:00.000Z",
    };
    const replaced = await admin.request("/api/admin/state", {
      method: "PUT",
      body: {
        state: {
          ...businessStateFrom(snapshot),
          bomItems: snapshot.bomItems
            .filter(({ id }) => id !== bomItem.id)
            .concat(spoofedExisting, spoofedNew),
        },
        expectedRevision: snapshot.revision,
      },
    });
    expect(replaced.status).toBe(200);

    const after = await getAdminState(admin);
    expect(after.bomItems.find(({ id }) => id === bomItem.id)).toMatchObject({
      ownerAccountId: owner.account.id,
      confirmedByAccountId: owner.account.id,
      confirmedAt: existing.confirmedAt,
      status: "ready",
    });
    expect(after.bomItems.find(({ id }) => id === spoofedNew.id)).toMatchObject({
      ownerAccountId: "",
      confirmedByAccountId: "",
      confirmedAt: "",
      status: "pending",
    });
  });

  it("repairs stale BOM owner and confirmation references during a full-state import", async () => {
    const admin = await activateAdmin(fixture);
    const owner = await createAndActivateMember(fixture, admin, "removed-bom-owner");
    const bomItem = await addBomItem(admin, { id: "bom-item-stale-account" });
    expect((await admin.request("/api/admin/bom-items/bulk-assign", {
      method: "POST",
      body: { itemIds: [bomItem.id], accountId: owner.account.id },
    })).status).toBe(200);
    expect((await owner.client.request(`/api/bom-items/${bomItem.id}`, {
      method: "PATCH",
      body: { status: "ready" },
    })).status).toBe(200);

    fixture.repository.db.prepare("DELETE FROM accounts WHERE id = ?").run(owner.account.id);
    const snapshot = await getAdminState(admin);
    const staleItem = snapshot.bomItems.find(({ id }) => id === bomItem.id);
    expect(staleItem).toMatchObject({
      status: "ready",
      ownerAccountId: owner.account.id,
      confirmedByAccountId: owner.account.id,
    });

    const replaced = await admin.request("/api/admin/state", {
      method: "PUT",
      body: {
        state: businessStateFrom(snapshot),
        expectedRevision: snapshot.revision,
      },
    });
    expect(replaced.status).toBe(200);

    const after = await getAdminState(admin);
    expect(after.bomItems.find(({ id }) => id === bomItem.id)).toMatchObject({
      status: "pending",
      ownerAccountId: "",
      confirmedBy: "",
      confirmedByAccountId: "",
      confirmedAt: "",
      issue: expect.stringContaining("原确认账号已失效，请重新确认"),
    });
  });

  it("does not let an in-flight password change overwrite a newer reset", async () => {
    const admin = await activateAdmin(fixture);
    const resetPassword = "ResetWinner123!";
    const resetHash = await hashPassword(resetPassword);
    const changing = fixture.repository.changePassword(
      "account-zhangmin",
      ADMIN_PASSWORD,
      "ConcurrentChange123!",
      { actorAccountId: admin.body?.account?.id ?? "account-zhangmin" },
    );
    fixture.repository.db.prepare(`
      UPDATE accounts SET password_hash = ?, must_change_password = 1
      WHERE id = ?
    `).run(resetHash, "account-zhangmin");

    await expect(changing).rejects.toMatchObject({ code: "CREDENTIAL_CHANGED" });
    await expect(fixture.repository.verifyCredentials("admin", resetPassword))
      .resolves.toMatchObject({ id: "account-zhangmin" });
    await expect(fixture.repository.verifyCredentials("admin", "ConcurrentChange123!"))
      .resolves.toBeNull();
  });
});

describe("NPI password policy", () => {
  it("accepts any password from 8 through 128 characters", () => {
    expect(validatePassword("1234567")).toBe("密码至少需要 8 位");
    expect(validatePassword("12345678")).toBe("");
    expect(validatePassword("abcdefgh")).toBe("");
    expect(validatePassword("a".repeat(128))).toBe("");
    expect(validatePassword("a".repeat(129))).toBe("密码不能超过 128 位");
  });
});

describe("NPI default administrator bootstrap", () => {
  it("uses admin/admin123 as the forced-change initial credential and accepts an eight-character replacement", async () => {
    const repository = await NpiRepository.open({ clock: () => new Date(START_TIME) });
    try {
      expect(repository.bootstrapCredentials).toEqual({
        username: "admin",
        password: "admin123",
      });
      await expect(repository.verifyCredentials("admin", "admin123")).resolves.toMatchObject({
        id: "account-zhangmin",
        mustChangePassword: true,
      });
      await expect(repository.verifyCredentials("zhangmin", "admin123")).resolves.toBeNull();
      await expect(repository.changePassword(
        "account-zhangmin",
        "admin123",
        "Admin234",
        { actorAccountId: "account-zhangmin" },
      )).resolves.toMatchObject({ mustChangePassword: false });
    } finally {
      repository.close();
    }
  });

  it("migrates only an untouched legacy default administrator", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "npi-admin-migration-test-"));
    const dbPath = join(tempDirectory, "npi-test.sqlite");
    const legacyPassword = "LegacyAdmin123!";
    let repository;
    try {
      repository = await NpiRepository.open({
        dbPath,
        bootstrapPassword: legacyPassword,
        clock: () => new Date(START_TIME),
      });
      repository.db.prepare(`
        UPDATE accounts
        SET username = 'zhangmin', must_change_password = 1, last_login_at = NULL
        WHERE id = 'account-zhangmin'
      `).run();
      repository.close();
      repository = null;

      repository = await NpiRepository.open({
        dbPath,
        bootstrapPassword: "IgnoredForExistingDb123!",
        clock: () => new Date(START_TIME),
      });
      expect(repository.bootstrapCredentials).toEqual({
        username: "admin",
        password: "admin123",
      });
      await expect(repository.verifyCredentials("admin", "admin123"))
        .resolves.toMatchObject({ id: "account-zhangmin", mustChangePassword: true });
      await expect(repository.verifyCredentials("zhangmin", legacyPassword)).resolves.toBeNull();
      expect(repository.getAuditLog(20)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "DEFAULT_ADMIN_MIGRATE" }),
      ]));
    } finally {
      repository?.close();
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("does not reset a legacy administrator that has already changed its password", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "npi-admin-used-test-"));
    const dbPath = join(tempDirectory, "npi-test.sqlite");
    let repository;
    try {
      repository = await NpiRepository.open({
        dbPath,
        bootstrapPassword: ADMIN_INITIAL_PASSWORD,
        clock: () => new Date(START_TIME),
      });
      await repository.changePassword(
        "account-zhangmin",
        ADMIN_INITIAL_PASSWORD,
        ADMIN_PASSWORD,
        { actorAccountId: "account-zhangmin" },
      );
      repository.db.prepare(`
        UPDATE accounts SET username = 'zhangmin' WHERE id = 'account-zhangmin'
      `).run();
      repository.close();
      repository = null;

      repository = await NpiRepository.open({ dbPath, clock: () => new Date(START_TIME) });
      expect(repository.bootstrapCredentials).toBeNull();
      await expect(repository.verifyCredentials("zhangmin", ADMIN_PASSWORD))
        .resolves.toMatchObject({ id: "account-zhangmin", mustChangePassword: false });
      await expect(repository.verifyCredentials("admin", "admin123")).resolves.toBeNull();
    } finally {
      repository?.close();
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

describe("NPI repository restart persistence", () => {
  it("persists accounts, sessions, business updates, and audit entries at the same dbPath", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "npi-server-test-"));
    const dbPath = join(tempDirectory, "npi-test.sqlite");
    const clock = () => new Date(START_TIME);
    let repository;
    try {
      repository = await NpiRepository.open({
        dbPath,
        bootstrapPassword: ADMIN_INITIAL_PASSWORD,
        clock,
      });
      const admin = repository.getAccount("account-zhangmin");
      await repository.changePassword(
        admin.id,
        ADMIN_INITIAL_PASSWORD,
        ADMIN_PASSWORD,
        { actorAccountId: admin.id, requestId: "persist-password-change" },
      );
      const created = await repository.createAccount({
        username: "persisted-member",
        name: "Persisted Member",
        department: "Engineering",
        jobRole: "PE",
        systemRole: "member",
      }, { actorAccountId: admin.id, requestId: "persist-account-create" });
      const session = repository.createSession(created.account.id, {
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      });
      const initialState = repository.readBusinessState();
      const task = initialState.state.tasks.find(({ definitionKey }) => (
        definitionKey !== "material-readiness"
      ));
      repository.patchTask(
        task.id,
        { notes: "Persisted across restart" },
        repository.getAccount(admin.id),
        { actorAccountId: admin.id, requestId: "persist-task-update" },
      );
      const attachmentContent = Buffer.from("Persisted attachment bytes", "utf8");
      const attachmentResult = repository.syncAttachments("task", task.id, {
        files: [{
          fileName: "persisted-attachment.txt",
          mimeType: "text/plain",
          size: attachmentContent.length,
          contentBase64: attachmentContent.toString("base64"),
        }],
        deleteIds: [],
        legacyEvidence: [],
      }, repository.getAccount(admin.id), {
        actorAccountId: admin.id,
        requestId: "persist-attachment-upload",
      });
      const persistedAttachment = attachmentResult.attachments[0];
      const stateWithTaskUpdate = repository.readBusinessState();
      const material = stateWithTaskUpdate.state.materials[0];
      const persistedBomItem = {
        id: "bom-item-persisted-quotation",
        projectId: material.projectId,
        phaseId: material.phaseId,
        parentMaterialId: material.id,
        importId: "bom-import-persisted-quotation",
        itemNo: "1",
        code: "PERSIST-QUOTE-001",
        name: "Persisted quotation material",
        internalCode: "INT-PERSIST-001",
        comment: "",
        spec: "QA",
        type: "test",
        pad: "",
        description: "",
        unitQuantity: 1,
        designator: "U1",
        vendors: ["Persisted Vendor"],
        mpns: ["PERSIST-MPN-001"],
        status: "pending",
        owner: "",
        ownerAccountId: "",
        issue: "",
        eta: "",
        confirmedBy: "",
        confirmedByAccountId: "",
        confirmedAt: "",
        sourceRow: 1,
        sourceSheet: "BOM",
        sourceVersion: "V1",
        updatedAt: START_TIME,
      };
      repository.replaceBusinessState({
        ...stateWithTaskUpdate.state,
        bomItems: [...stateWithTaskUpdate.state.bomItems, persistedBomItem],
      }, stateWithTaskUpdate.revision, repository.getAccount(admin.id), {
        actorAccountId: admin.id,
        requestId: "persist-bom-item",
      });
      const quotationContent = Buffer.from("Persisted quotation bytes", "utf8");
      const quotation = repository.createQuotation({
        bomItemId: persistedBomItem.id,
        vendor: "Persisted Vendor",
        fileName: "persisted-quotation.csv",
        mimeType: "text/csv",
        size: quotationContent.length,
        contentBase64: quotationContent.toString("base64"),
      }, repository.getAccount(admin.id), {
        actorAccountId: admin.id,
        requestId: "persist-quotation-upload",
      });
      repository.close();
      repository = null;

      repository = await NpiRepository.open({ dbPath, clock });
      expect(repository.bootstrapCredentials).toBeNull();
      expect(await repository.verifyCredentials(created.account.username, created.initialPassword))
        .toMatchObject({ id: created.account.id });
      expect(repository.authenticate(session.token)?.account).toMatchObject({
        id: created.account.id,
      });
      expect(repository.readBusinessState().state.tasks.find(({ id }) => id === task.id).notes)
        .toBe("Persisted across restart");
      expect(repository.getQuotationMetadata(repository.getAccount(admin.id))).toEqual([
        expect.objectContaining({ id: quotation.id, bomItemId: persistedBomItem.id }),
      ]);
      expect(Buffer.from(
        repository.getQuotationFile(quotation.id, repository.getAccount(admin.id)).content,
      )).toEqual(quotationContent);
      expect(Buffer.from(
        repository.getAttachmentFile(persistedAttachment.id, repository.getAccount(admin.id)).content,
      )).toEqual(attachmentContent);
      expect(repository.getAuditLog(100)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "ACCOUNT_CREATE",
          entityId: created.account.id,
          requestId: "persist-account-create",
        }),
        expect.objectContaining({
          action: "TASK_UPDATE",
          entityId: task.id,
          requestId: "persist-task-update",
        }),
        expect.objectContaining({
          action: "QUOTATION_UPLOAD",
          entityId: quotation.id,
          requestId: "persist-quotation-upload",
        }),
        expect.objectContaining({
          action: "ATTACHMENT_SYNC",
          entityId: task.id,
          requestId: "persist-attachment-upload",
        }),
      ]));
    } finally {
      repository?.close();
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
