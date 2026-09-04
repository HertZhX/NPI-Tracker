import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createDefaultAccounts, normalizeUsername } from "../src/domain/accounts.js";
import {
  BOM_STATUS,
  bomItemFingerprint,
  bomSummaryToTaskStatus,
  isBomStatus,
} from "../src/domain/bom.js";
import { TASK_STATUS, isTaskStatus } from "../src/domain/statuses.js";
import { ensureWorkflowState } from "../src/domain/workflow.js";
import { createSeedData } from "../src/data/seed.js";
import { parseBusinessState } from "./state-schema.mjs";
import {
  createCsrfToken,
  createSessionToken,
  generateTemporaryPassword,
  hashPassword,
  hashToken,
  validatePassword,
  verifyPassword,
} from "./security.mjs";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_ADMIN_ID = "account-zhangmin";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_INITIAL_PASSWORD = "admin123";
const LEGACY_DEFAULT_ADMIN_USERNAME = "zhangmin";
const MEMBER_TASK_FIELDS = new Set(["status", "forecastDate", "blocker", "notes", "evidence"]);
const ADMIN_TASK_FIELDS = new Set([
  ...MEMBER_TASK_FIELDS,
  "ownerAccountId",
  "ownerRole",
  "baselineDate",
]);
const MEMBER_WORKFLOW_FIELDS = new Set(["status", "forecastDate", "blocker", "notes", "evidence"]);
const ADMIN_WORKFLOW_FIELDS = new Set([
  ...MEMBER_WORKFLOW_FIELDS,
  "ownerAccountId",
  "ownerRole",
  "baselineDate",
]);
const MEMBER_BOM_FIELDS = new Set(["status", "issue", "eta"]);
const ADMIN_BOM_FIELDS = new Set([...MEMBER_BOM_FIELDS, "ownerAccountId"]);
const TASK_SERVER_FIELDS = [
  "status",
  "owner",
  "ownerAccountId",
  "ownerRole",
  "baselineDate",
  "forecastDate",
  "actualDate",
  "blocker",
  "notes",
  "evidence",
  "updatedAt",
];
const WORKFLOW_SERVER_FIELDS = [...TASK_SERVER_FIELDS];
const BOM_SERVER_FIELDS = [
  "status",
  "owner",
  "ownerAccountId",
  "issue",
  "eta",
  "confirmedBy",
  "confirmedByAccountId",
  "confirmedAt",
  "updatedAt",
];
const MAX_AUDIT_DETAILS_LENGTH = 64 * 1024;
const MAX_QUOTATION_FILE_BYTES = 10 * 1024 * 1024;
const QUOTATION_EXTENSIONS = new Set([
  "pdf", "xlsx", "xls", "csv", "doc", "docx", "png", "jpg", "jpeg",
]);

function isoNow(clock) {
  const value = clock();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function safeJson(value) {
  const serialized = JSON.stringify(value, (key, item) => (
    /password|token|cookie|secret/i.test(key) ? "[REDACTED]" : item
  ));
  if (serialized.length <= MAX_AUDIT_DETAILS_LENGTH) return serialized;
  return JSON.stringify({
    truncated: true,
    preview: serialized.slice(0, MAX_AUDIT_DETAILS_LENGTH - 100),
  });
}

function preserveFields(incoming, existing, fields) {
  return fields.reduce((result, field) => {
    result[field] = existing[field];
    return result;
  }, { ...incoming });
}

function createInitialBusinessState() {
  return {
    ...createSeedData(),
    bomItems: [],
    bomImports: [],
  };
}

function rowToAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    department: row.department,
    jobRole: row.job_role,
    systemRole: row.system_role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at || "",
  };
}

function rowToQuotation(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    phaseId: row.phase_id,
    bomItemId: row.bom_item_id,
    vendor: row.vendor,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    uploadedByAccountId: row.uploaded_by_account_id,
    uploadedBy: row.uploaded_by_name,
    uploadedAt: row.uploaded_at,
  };
}

function assertAllowedFields(patch, allowed) {
  const rejected = Object.keys(patch).filter((field) => !allowed.has(field));
  if (rejected.length) {
    throw new RepositoryError(400, "INVALID_FIELDS", `不允许修改字段：${rejected.join("、")}`);
  }
}

function syncMaterialReadinessTask(state, parentMaterialId, now) {
  const index = state.tasks.findIndex((task) => (
    task.materialId === parentMaterialId && task.definitionKey === "material-readiness"
  ));
  if (index < 0) return;
  const status = bomSummaryToTaskStatus(
    state.bomItems.filter((item) => item.parentMaterialId === parentMaterialId),
  );
  const task = state.tasks[index];
  state.tasks[index] = {
    ...task,
    status,
    actualDate: status === TASK_STATUS.DONE ? (task.actualDate || dateOnly(now)) : "",
    updatedAt: now,
  };
}

export class RepositoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RepositoryError";
    this.status = status;
    this.code = code;
  }
}

export class NpiRepository {
  constructor(database, { clock = () => new Date(), secureCookies = false } = {}) {
    this.db = database;
    this.clock = clock;
    this.secureCookies = secureCookies;
    this.bootstrapCredentials = null;
  }

  static async open({
    dbPath = ":memory:",
    clock,
    secureCookies = false,
    bootstrapPassword = "",
  } = {}) {
    const database = new DatabaseSync(dbPath);
    const repository = new NpiRepository(database, { clock, secureCookies });
    repository.#createSchema();
    await repository.#bootstrap(bootstrapPassword);
    return repository;
  }

  #createSchema() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        department TEXT NOT NULL,
        job_role TEXT NOT NULL,
        system_role TEXT NOT NULL CHECK (system_role IN ('admin', 'member')),
        active INTEGER NOT NULL DEFAULT 1,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS business_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_account_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        result TEXT NOT NULL,
        details_json TEXT NOT NULL,
        request_id TEXT NOT NULL,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        phase_id TEXT NOT NULL,
        bom_item_id TEXT NOT NULL,
        vendor TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size > 0),
        content BLOB NOT NULL,
        uploaded_by_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        uploaded_by_name TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quotations_project ON quotations(project_id, phase_id);
      CREATE INDEX IF NOT EXISTS idx_quotations_bom_item ON quotations(bom_item_id, uploaded_at DESC);
    `);
  }

  async #bootstrap(bootstrapPassword) {
    const now = isoNow(this.clock);
    let csrfSecret = this.db.prepare("SELECT value FROM meta WHERE key = ?").get("csrf_secret")?.value;
    if (!csrfSecret) {
      csrfSecret = randomBytes(32).toString("base64url");
      this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("csrf_secret", csrfSecret);
    }

    const accountCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count);
    if (accountCount === 0) {
      if (bootstrapPassword) {
        const passwordError = validatePassword(bootstrapPassword);
        if (passwordError) throw new Error(`NPI_BOOTSTRAP_PASSWORD 不符合要求：${passwordError}`);
      }
      const accounts = createDefaultAccounts();
      const credentials = [];
      for (const account of accounts) {
        const isAdmin = account.id === DEFAULT_ADMIN_ID;
        const temporaryPassword = isAdmin
          ? (bootstrapPassword || DEFAULT_ADMIN_INITIAL_PASSWORD)
          : generateTemporaryPassword();
        const passwordHash = await hashPassword(temporaryPassword);
        this.db.prepare(`
          INSERT INTO accounts (
            id, username, name, department, job_role, system_role, active,
            password_hash, must_change_password, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
        `).run(
          account.id,
          normalizeUsername(account.username),
          account.name,
          account.department,
          account.jobRole,
          isAdmin ? "admin" : "member",
          passwordHash,
          now,
          now,
        );
        if (isAdmin) credentials.push({ username: account.username, password: temporaryPassword });
      }
      this.bootstrapCredentials = credentials[0] ?? null;
    } else {
      await this.#migrateLegacyDefaultAdmin(now);
    }

    const businessRow = this.db.prepare("SELECT id, state_json FROM business_state WHERE id = 1").get();
    if (!businessRow) {
      this.db.prepare(`
        INSERT INTO business_state (id, revision, state_json, updated_at)
        VALUES (1, 0, ?, ?)
      `).run(JSON.stringify(createInitialBusinessState()), now);
    } else {
      const parsed = parseBusinessState(JSON.parse(businessRow.state_json));
      if (!parsed.success) throw new Error(`数据库业务数据损坏：${parsed.error}`);
    }
  }

  async #migrateLegacyDefaultAdmin(now) {
    const legacyAdmin = this.db.prepare(`
      SELECT id FROM accounts
      WHERE id = ?
        AND username = ? COLLATE NOCASE
        AND system_role = 'admin'
        AND must_change_password = 1
        AND last_login_at IS NULL
    `).get(DEFAULT_ADMIN_ID, LEGACY_DEFAULT_ADMIN_USERNAME);
    if (!legacyAdmin) return;
    const usernameTaken = this.db.prepare(`
      SELECT 1 FROM accounts WHERE username = ? COLLATE NOCASE AND id <> ?
    `).get(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_ID);
    if (usernameTaken) return;

    const passwordHash = await hashPassword(DEFAULT_ADMIN_INITIAL_PASSWORD);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.db.prepare(`
        UPDATE accounts
        SET username = ?, password_hash = ?, must_change_password = 1, updated_at = ?
        WHERE id = ?
          AND username = ? COLLATE NOCASE
          AND system_role = 'admin'
          AND must_change_password = 1
          AND last_login_at IS NULL
      `).run(
        DEFAULT_ADMIN_USERNAME,
        passwordHash,
        now,
        DEFAULT_ADMIN_ID,
        LEGACY_DEFAULT_ADMIN_USERNAME,
      );
      if (Number(updated.changes) === 1) {
        this.revokeAccountSessions(DEFAULT_ADMIN_ID);
        this.recordAudit({
          action: "DEFAULT_ADMIN_MIGRATE",
          entityType: "account",
          entityId: DEFAULT_ADMIN_ID,
          details: {
            fromUsername: LEGACY_DEFAULT_ADMIN_USERNAME,
            toUsername: DEFAULT_ADMIN_USERNAME,
          },
        });
        this.bootstrapCredentials = {
          username: DEFAULT_ADMIN_USERNAME,
          password: DEFAULT_ADMIN_INITIAL_PASSWORD,
        };
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getCsrfSecret() {
    return this.db.prepare("SELECT value FROM meta WHERE key = ?").get("csrf_secret").value;
  }

  getAccount(accountId) {
    return rowToAccount(this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId));
  }

  getAccounts() {
    return this.db.prepare("SELECT * FROM accounts ORDER BY active DESC, name, username")
      .all()
      .map(rowToAccount);
  }

  getQuotationMetadata(actor, state = null) {
    actor = this.#freshActor(actor);
    const businessState = state ?? this.readBusinessState().state;
    const knownProjectIds = new Set(businessState.projects.map(({ id }) => id));
    const allowedBomItemIds = actor.systemRole === "admin"
      ? new Set(businessState.bomItems.map(({ id }) => id))
      : new Set(businessState.bomItems
        .filter(({ ownerAccountId }) => ownerAccountId === actor.id)
        .map(({ id }) => id));
    return this.db.prepare(`
      SELECT id, project_id, phase_id, bom_item_id, vendor, file_name, mime_type,
             size, uploaded_by_account_id, uploaded_by_name, uploaded_at
      FROM quotations
      ORDER BY uploaded_at DESC, id DESC
    `).all()
      .map(rowToQuotation)
      .filter((quotation) => (
        knownProjectIds.has(quotation.projectId)
        && allowedBomItemIds.has(quotation.bomItemId)
      ));
  }

  createQuotation(input, actor, audit = {}) {
    actor = this.#freshActor(actor);
    const { state } = this.readBusinessState();
    const bomItem = state.bomItems.find(({ id }) => id === String(input.bomItemId || ""));
    if (!bomItem) throw new RepositoryError(404, "BOM_ITEM_NOT_FOUND", "BOM 材料不存在");
    if (actor.systemRole !== "admin" && bomItem.ownerAccountId !== actor.id) {
      throw new RepositoryError(403, "BOM_NOT_ASSIGNED", "只能给分配给自己的材料上传报价单");
    }
    if (bomItem.status === BOM_STATUS.REMOVED) {
      throw new RepositoryError(409, "BOM_ITEM_REMOVED", "已移出 BOM 的材料不能上传报价单");
    }

    const rawFileName = String(input.fileName || "").trim();
    const fileName = rawFileName.replaceAll("\\", "/").split("/").pop() || "";
    const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
    const vendor = String(input.vendor || bomItem.vendors?.[0] || "未指定供应商").trim();
    const mimeType = String(input.mimeType || "application/octet-stream").trim().slice(0, 200);
    const contentBase64 = String(input.contentBase64 || "").trim();
    if (
      !fileName
      || fileName.length > 500
      || /[\u0000-\u001F\u007F]/.test(fileName)
      || !QUOTATION_EXTENSIONS.has(extension)
    ) {
      throw new RepositoryError(400, "INVALID_QUOTATION_FILE", "报价单仅支持 PDF、Excel、Word、CSV 或图片文件");
    }
    if (!vendor || vendor.length > 500) {
      throw new RepositoryError(400, "INVALID_VENDOR", "请填写有效的报价供应商");
    }
    if (
      !contentBase64
      || contentBase64.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64)
    ) {
      throw new RepositoryError(400, "INVALID_QUOTATION_CONTENT", "报价单文件内容无效");
    }
    const content = Buffer.from(contentBase64, "base64");
    const reportedSize = Number(input.size);
    if (!content.length || content.length > MAX_QUOTATION_FILE_BYTES) {
      throw new RepositoryError(413, "QUOTATION_TOO_LARGE", "单份报价单不能超过 10 MB");
    }
    if (!Number.isSafeInteger(reportedSize) || reportedSize !== content.length) {
      throw new RepositoryError(400, "QUOTATION_SIZE_MISMATCH", "报价单文件大小校验失败");
    }

    const quotation = {
      id: `quotation-${randomBytes(12).toString("hex")}`,
      projectId: bomItem.projectId,
      phaseId: bomItem.phaseId,
      bomItemId: bomItem.id,
      vendor,
      fileName,
      mimeType,
      size: content.length,
      uploadedByAccountId: actor.id,
      uploadedBy: actor.name,
      uploadedAt: isoNow(this.clock),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO quotations (
          id, project_id, phase_id, bom_item_id, vendor, file_name, mime_type,
          size, content, uploaded_by_account_id, uploaded_by_name, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        quotation.id,
        quotation.projectId,
        quotation.phaseId,
        quotation.bomItemId,
        quotation.vendor,
        quotation.fileName,
        quotation.mimeType,
        quotation.size,
        content,
        quotation.uploadedByAccountId,
        quotation.uploadedBy,
        quotation.uploadedAt,
      );
      this.recordAudit({
        ...audit,
        action: "QUOTATION_UPLOAD",
        entityType: "quotation",
        entityId: quotation.id,
        details: { ...quotation, content: undefined },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return quotation;
  }

  getQuotationFile(quotationId, actor) {
    actor = this.#freshActor(actor);
    const row = this.db.prepare("SELECT * FROM quotations WHERE id = ?").get(quotationId);
    if (!row) throw new RepositoryError(404, "QUOTATION_NOT_FOUND", "报价单不存在");
    const { state } = this.readBusinessState();
    const bomItem = state.bomItems.find(({ id }) => id === row.bom_item_id);
    if (!bomItem) throw new RepositoryError(404, "BOM_ITEM_NOT_FOUND", "报价单关联的 BOM 材料不存在");
    if (actor.systemRole !== "admin" && bomItem.ownerAccountId !== actor.id) {
      throw new RepositoryError(403, "QUOTATION_FORBIDDEN", "无权下载该报价单");
    }
    return { quotation: rowToQuotation(row), content: row.content };
  }

  deleteQuotation(quotationId, actor, audit = {}) {
    actor = this.#freshActor(actor);
    const row = this.db.prepare("SELECT * FROM quotations WHERE id = ?").get(quotationId);
    if (!row) throw new RepositoryError(404, "QUOTATION_NOT_FOUND", "报价单不存在");
    const quotation = rowToQuotation(row);
    if (actor.systemRole !== "admin" && quotation.uploadedByAccountId !== actor.id) {
      throw new RepositoryError(403, "QUOTATION_DELETE_FORBIDDEN", "只能删除自己上传的报价单");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM quotations WHERE id = ?").run(quotationId);
      this.recordAudit({
        ...audit,
        action: "QUOTATION_DELETE",
        entityType: "quotation",
        entityId: quotationId,
        details: quotation,
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return quotation;
  }

  #freshActor(actor, { admin = false } = {}) {
    const fresh = actor?.id ? this.getAccount(actor.id) : null;
    if (!fresh?.active) {
      throw new RepositoryError(401, "SESSION_REVOKED", "登录会话已失效，请重新登录");
    }
    if (admin && fresh.systemRole !== "admin") {
      throw new RepositoryError(403, "FORBIDDEN", "只有管理员可以执行此操作");
    }
    return fresh;
  }

  async verifyCredentials(username, password) {
    const row = this.db.prepare("SELECT * FROM accounts WHERE username = ? COLLATE NOCASE")
      .get(normalizeUsername(username));
    if (!row || !row.active || !(await verifyPassword(String(password || ""), row.password_hash))) {
      return null;
    }
    const fresh = this.db.prepare(`
      SELECT * FROM accounts
      WHERE id = ? AND active = 1 AND password_hash = ?
    `).get(row.id, row.password_hash);
    if (!fresh) return null;
    const now = isoNow(this.clock);
    const updated = this.db.prepare(`
      UPDATE accounts SET last_login_at = ?, updated_at = ?
      WHERE id = ? AND active = 1 AND password_hash = ?
    `).run(now, now, fresh.id, fresh.password_hash);
    return Number(updated.changes) === 1 ? this.getAccount(fresh.id) : null;
  }

  createSession(accountId, { ipAddress = "", userAgent = "" } = {}) {
    const token = createSessionToken();
    const now = new Date(this.clock());
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    this.db.prepare(`
      INSERT INTO sessions (token_hash, account_id, created_at, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      hashToken(token),
      accountId,
      now.toISOString(),
      expiresAt.toISOString(),
      ipAddress,
      String(userAgent).slice(0, 400),
    );
    return {
      token,
      csrfToken: createCsrfToken(this.getCsrfSecret(), token),
      expiresAt: expiresAt.toISOString(),
    };
  }

  authenticate(token) {
    if (!token) return null;
    const now = isoNow(this.clock);
    const row = this.db.prepare(`
      SELECT accounts.*, sessions.expires_at
      FROM sessions
      JOIN accounts ON accounts.id = sessions.account_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND accounts.active = 1
    `).get(hashToken(token), now);
    if (!row) return null;
    return {
      account: rowToAccount(row),
      csrfToken: createCsrfToken(this.getCsrfSecret(), token),
      expiresAt: row.expires_at,
    };
  }

  revokeSession(token) {
    if (!token) return;
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }

  revokeAccountSessions(accountId) {
    this.db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
  }

  cleanupExpiredSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(isoNow(this.clock));
  }

  recordAudit({
    actorAccountId = null,
    action,
    entityType,
    entityId = "",
    result = "SUCCESS",
    details = {},
    requestId = randomBytes(10).toString("hex"),
    ipAddress = "",
  }) {
    this.db.prepare(`
      INSERT INTO audit_log (
        actor_account_id, action, entity_type, entity_id, result,
        details_json, request_id, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actorAccountId,
      action,
      entityType,
      entityId,
      result,
      safeJson(details),
      requestId,
      ipAddress,
      isoNow(this.clock),
    );
  }

  getAuditLog(limit = 100) {
    return this.db.prepare(`
      SELECT audit_log.*, accounts.name AS actor_name
      FROM audit_log
      LEFT JOIN accounts ON accounts.id = audit_log.actor_account_id
      ORDER BY audit_log.id DESC
      LIMIT ?
    `).all(Math.min(500, Math.max(1, Number(limit) || 100))).map((row) => ({
      id: row.id,
      actorAccountId: row.actor_account_id || "",
      actorName: row.actor_name || "系统/未知",
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id || "",
      result: row.result,
      details: JSON.parse(row.details_json),
      requestId: row.request_id,
      ipAddress: row.ip_address || "",
      createdAt: row.created_at,
    }));
  }

  async createAccount(input, audit = {}) {
    const username = normalizeUsername(input.username);
    const name = String(input.name || "").trim();
    const department = String(input.department || "").trim();
    const jobRole = String(input.jobRole || "").trim();
    const systemRole = input.systemRole === "admin" ? "admin" : "member";
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || !name || !department || !jobRole) {
      throw new RepositoryError(400, "INVALID_ACCOUNT", "请完整填写有效账号、姓名、部门和岗位");
    }
    if (this.db.prepare("SELECT 1 FROM accounts WHERE username = ? COLLATE NOCASE").get(username)) {
      throw new RepositoryError(409, "USERNAME_EXISTS", "登录账号已存在");
    }
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    this.#freshActor({ id: audit.actorAccountId }, { admin: true });
    const now = isoNow(this.clock);
    const id = `account-${randomBytes(12).toString("hex")}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO accounts (
          id, username, name, department, job_role, system_role, active,
          password_hash, must_change_password, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
      `).run(id, username, name, department, jobRole, systemRole, passwordHash, now, now);
      this.recordAudit({
        ...audit,
        action: "ACCOUNT_CREATE",
        entityType: "account",
        entityId: id,
        details: { username, name, department, jobRole, systemRole },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { account: this.getAccount(id), initialPassword: password };
  }

  updateAccount(accountId, patch, audit = {}) {
    this.#freshActor({ id: audit.actorAccountId }, { admin: true });
    const current = this.getAccount(accountId);
    if (!current) throw new RepositoryError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
    const next = {
      ...current,
      name: patch.name == null ? current.name : String(patch.name).trim(),
      department: patch.department == null ? current.department : String(patch.department).trim(),
      jobRole: patch.jobRole == null ? current.jobRole : String(patch.jobRole).trim(),
      systemRole: patch.systemRole == null
        ? current.systemRole
        : (patch.systemRole === "admin" ? "admin" : "member"),
      active: patch.active == null ? current.active : Boolean(patch.active),
    };
    if (!next.name || !next.department || !next.jobRole) {
      throw new RepositoryError(400, "INVALID_ACCOUNT", "姓名、部门和岗位不能为空");
    }
    if (current.systemRole === "admin" && current.active && (
      next.systemRole !== "admin" || !next.active
    )) {
      const activeAdmins = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM accounts WHERE system_role = 'admin' AND active = 1
      `).get().count);
      if (activeAdmins <= 1) {
        throw new RepositoryError(409, "LAST_ADMIN", "不能停用或降级最后一个管理员");
      }
    }
    const now = isoNow(this.clock);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE accounts
        SET name = ?, department = ?, job_role = ?, system_role = ?, active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.name,
        next.department,
        next.jobRole,
        next.systemRole,
        next.active ? 1 : 0,
        now,
        accountId,
      );
      if (!next.active || next.systemRole !== current.systemRole) this.revokeAccountSessions(accountId);
      this.recordAudit({
        ...audit,
        action: "ACCOUNT_UPDATE",
        entityType: "account",
        entityId: accountId,
        details: { before: current, after: this.getAccount(accountId) },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getAccount(accountId);
  }

  deleteAccount(accountId, audit = {}) {
    const actor = this.#freshActor({ id: audit.actorAccountId }, { admin: true });
    const account = this.getAccount(accountId);
    if (!account) throw new RepositoryError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
    if (account.id === actor.id) {
      throw new RepositoryError(409, "CANNOT_DELETE_SELF", "不能删除当前登录账号");
    }

    if (account.systemRole === "admin" && account.active) {
      const activeAdmins = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM accounts WHERE system_role = 'admin' AND active = 1
      `).get().count);
      if (activeAdmins <= 1) {
        throw new RepositoryError(409, "LAST_ADMIN", "不能删除最后一个启用的管理员");
      }
    }

    const { state } = this.readBusinessState();
    const references = {
      projects: state.projects.filter(({ managerAccountId, manager }) => (
        managerAccountId === accountId || (!managerAccountId && manager === account.name)
      )).length,
      tasks: state.tasks.filter(({ ownerAccountId, owner }) => (
        ownerAccountId === accountId || (!ownerAccountId && owner === account.name)
      )).length,
      workflowItems: state.workflowItems.filter(({ ownerAccountId, owner }) => (
        ownerAccountId === accountId || (!ownerAccountId && owner === account.name)
      )).length,
      bomItems: state.bomItems.filter(({ ownerAccountId, owner }) => (
        ownerAccountId === accountId || (!ownerAccountId && owner === account.name)
      )).length,
      confirmations: state.bomItems.filter(({ confirmedByAccountId, confirmedBy }) => (
        confirmedByAccountId === accountId
        || (!confirmedByAccountId && confirmedBy === account.name)
      )).length,
      quotations: Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM quotations WHERE uploaded_by_account_id = ?
      `).get(accountId).count),
      submissions: Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM audit_log
        WHERE actor_account_id = ?
          AND action IN ('TASK_UPDATE', 'WORKFLOW_ITEM_UPDATE', 'BOM_ITEM_UPDATE', 'QUOTATION_UPLOAD')
      `).get(accountId).count),
    };
    const referenceCount = Object.values(references).reduce((total, count) => total + count, 0);
    if (referenceCount > 0) {
      throw new RepositoryError(
        409,
        "ACCOUNT_IN_USE",
        "账号已有项目、任务、BOM、报价单、材料确认或责任提交记录，不能删除；如不再使用，请停用账号",
      );
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.revokeAccountSessions(accountId);
      const deleted = this.db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
      if (Number(deleted.changes) !== 1) {
        throw new RepositoryError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      }
      this.recordAudit({
        ...audit,
        action: "ACCOUNT_DELETE",
        entityType: "account",
        entityId: accountId,
        details: { account, references },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return account;
  }

  async resetPassword(accountId, audit = {}) {
    const account = this.getAccount(accountId);
    if (!account) throw new RepositoryError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    this.#freshActor({ id: audit.actorAccountId }, { admin: true });
    const now = isoNow(this.clock);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE accounts SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?
      `).run(passwordHash, now, accountId);
      this.revokeAccountSessions(accountId);
      this.recordAudit({
        ...audit,
        action: "ACCOUNT_PASSWORD_RESET",
        entityType: "account",
        entityId: accountId,
        details: { username: account.username },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { account: this.getAccount(accountId), initialPassword: password };
  }

  async changePassword(accountId, currentPassword, newPassword, audit = {}) {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id = ? AND active = 1").get(accountId);
    if (!row || !(await verifyPassword(String(currentPassword || ""), row.password_hash))) {
      throw new RepositoryError(400, "CURRENT_PASSWORD_INVALID", "当前密码不正确");
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) throw new RepositoryError(400, "WEAK_PASSWORD", passwordError);
    if (await verifyPassword(newPassword, row.password_hash)) {
      throw new RepositoryError(400, "PASSWORD_REUSED", "新密码不能与当前密码相同");
    }
    const passwordHash = await hashPassword(newPassword);
    const now = isoNow(this.clock);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.db.prepare(`
        UPDATE accounts
        SET password_hash = ?, must_change_password = 0, updated_at = ?
        WHERE id = ? AND active = 1 AND password_hash = ?
      `).run(passwordHash, now, accountId, row.password_hash);
      if (Number(changed.changes) !== 1) {
        throw new RepositoryError(
          409,
          "CREDENTIAL_CHANGED",
          "账号凭据已被重置或停用，请重新登录",
        );
      }
      this.revokeAccountSessions(accountId);
      this.recordAudit({
        ...audit,
        action: "PASSWORD_CHANGE",
        entityType: "account",
        entityId: accountId,
        details: {},
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getAccount(accountId);
  }

  readBusinessState() {
    const row = this.db.prepare("SELECT revision, state_json FROM business_state WHERE id = 1").get();
    const parsed = parseBusinessState(JSON.parse(row.state_json));
    if (!parsed.success) throw new Error(`数据库业务数据损坏：${parsed.error}`);
    const ensured = ensureWorkflowState(parsed.data.projects, parsed.data.workflowItems);
    const state = { ...parsed.data, ...ensured };
    const validated = parseBusinessState(state);
    if (!validated.success) throw new Error(`数据库业务数据迁移失败：${validated.error}`);
    return { revision: row.revision, state: validated.data };
  }

  getScopedState(account) {
    const { revision, state } = this.readBusinessState();
    const accounts = this.getAccounts();
    if (account.systemRole === "admin") {
      const selectedProject = state.projects[0] ?? null;
      const selectedPhase = selectedProject?.phases.find(({ type }) => type === "MP")
        ?? selectedProject?.phases[0]
        ?? null;
      return {
        ...state,
        quotations: this.getQuotationMetadata(account, state),
        accounts,
        currentAccountId: account.id,
        selectedProjectId: selectedProject?.id ?? null,
        selectedPhaseId: selectedPhase?.id ?? null,
        revision,
        permissions: { canManage: true, canAssign: true, canImport: true },
      };
    }

    const tasks = state.tasks.filter(({ ownerAccountId }) => ownerAccountId === account.id);
    const assignedWorkflowItems = state.workflowItems.filter(({ ownerAccountId }) => ownerAccountId === account.id);
    const bomItems = state.bomItems.filter(({ ownerAccountId }) => ownerAccountId === account.id);
    const projectIds = new Set([
      ...tasks.map(({ projectId }) => projectId),
      ...assignedWorkflowItems.map(({ projectId }) => projectId),
      ...bomItems.map(({ projectId }) => projectId),
    ]);
    const workflowItems = state.workflowItems.filter(({ projectId }) => projectIds.has(projectId));
    const phaseIds = new Set([
      ...tasks.map(({ phaseId }) => phaseId),
      ...workflowItems.map(({ phaseId }) => phaseId),
      ...bomItems.map(({ phaseId }) => phaseId),
    ]);
    const materialIds = new Set([
      ...tasks.map(({ materialId }) => materialId),
      ...bomItems.map(({ parentMaterialId }) => parentMaterialId),
    ]);
    const projects = state.projects
      .filter(({ id }) => projectIds.has(id))
      .map((project) => ({
        ...project,
        phases: project.phases.filter(({ id }) => phaseIds.has(id)),
      }))
      .filter(({ phases }) => phases.length > 0);
    const materials = state.materials.filter(({ id }) => materialIds.has(id));
    const bomImports = state.bomImports.filter(({ parentMaterialId }) => materialIds.has(parentMaterialId));
    const definitionKeys = new Set(tasks.map(({ definitionKey }) => definitionKey));
    const definitions = state.definitions.filter(({ key }) => definitionKeys.has(key));
    const selectedProject = projects[0] ?? null;
    const selectedPhase = selectedProject?.phases[0] ?? null;
    return {
      projects,
      materials,
      definitions,
      tasks,
      workflowItems,
      bomItems,
      bomImports,
      quotations: this.getQuotationMetadata(account, state),
      accounts: accounts.filter(({ id }) => id === account.id).map((entry) => ({
        id: entry.id,
        username: entry.username,
        name: entry.name,
        department: entry.department,
        jobRole: entry.jobRole,
        systemRole: entry.systemRole,
        active: entry.active,
        mustChangePassword: entry.mustChangePassword,
      })),
      currentAccountId: account.id,
      selectedProjectId: selectedProject?.id ?? null,
      selectedPhaseId: selectedPhase?.id ?? null,
      revision,
      permissions: { canManage: false, canAssign: false, canImport: false },
    };
  }

  replaceBusinessState(input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const parsed = parseBusinessState(input);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_STATE", parsed.error);
    const current = this.readBusinessState();
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const now = isoNow(this.clock);
    const currentTasks = new Map(current.state.tasks.map((task) => [task.id, task]));
    const currentWorkflowItems = new Map(current.state.workflowItems.map((item) => [item.id, item]));
    const currentBomItems = new Map(current.state.bomItems.map((item) => [item.id, item]));
    const incomingWorkflowItems = Array.isArray(input.workflowItems)
      ? parsed.data.workflowItems
      : current.state.workflowItems;
    const mergedState = {
      ...parsed.data,
      tasks: parsed.data.tasks.map((task) => {
        const existing = currentTasks.get(task.id);
        return existing ? preserveFields(task, existing, TASK_SERVER_FIELDS) : task;
      }),
      workflowItems: incomingWorkflowItems.map((item) => {
        const existing = currentWorkflowItems.get(item.id);
        return existing ? preserveFields(item, existing, WORKFLOW_SERVER_FIELDS) : item;
      }),
      bomItems: parsed.data.bomItems.map((item) => {
        const existing = currentBomItems.get(item.id);
        if (!existing) {
          return {
            ...item,
            status: BOM_STATUS.PENDING,
            owner: "",
            ownerAccountId: "",
            issue: "",
            eta: "",
            confirmedBy: "",
            confirmedByAccountId: "",
            confirmedAt: "",
            updatedAt: now,
          };
        }

        const removed = item.status === BOM_STATUS.REMOVED;
        const changed = bomItemFingerprint(item) !== bomItemFingerprint(existing)
          || (existing.status === BOM_STATUS.REMOVED && !removed);
        if (removed || changed) {
          return {
            ...item,
            status: removed ? BOM_STATUS.REMOVED : BOM_STATUS.PENDING,
            owner: existing.owner,
            ownerAccountId: existing.ownerAccountId,
            issue: changed ? "BOM 信息已变更，请重新确认" : existing.issue,
            eta: existing.eta,
            confirmedBy: "",
            confirmedByAccountId: "",
            confirmedAt: "",
            updatedAt: now,
          };
        }
        return preserveFields(item, existing, BOM_SERVER_FIELDS);
      }),
    };

    const knownAccountIds = new Set(this.getAccounts().map(({ id }) => id));
    const invalidAccountReference = mergedState.projects.some(({ managerAccountId }) => (
      managerAccountId && !knownAccountIds.has(managerAccountId)
    )) || mergedState.tasks.some(({ ownerAccountId }) => (
      ownerAccountId && !knownAccountIds.has(ownerAccountId)
    )) || mergedState.workflowItems.some(({ ownerAccountId }) => (
      ownerAccountId && !knownAccountIds.has(ownerAccountId)
    )) || mergedState.bomItems.some((item) => (
      (item.ownerAccountId && !knownAccountIds.has(item.ownerAccountId))
      || (item.confirmedByAccountId && !knownAccountIds.has(item.confirmedByAccountId))
      || (item.status === BOM_STATUS.READY && (
        !item.confirmedByAccountId || !item.confirmedBy || !item.confirmedAt
      ))
      || (item.status !== BOM_STATUS.READY && (
        item.confirmedByAccountId || item.confirmedBy || item.confirmedAt
      ))
    ));
    if (invalidAccountReference) {
      throw new RepositoryError(400, "INVALID_ACCOUNT_REFERENCE", "业务数据包含无效的账号或确认人引用");
    }
    const finalState = parseBusinessState(mergedState);
    if (!finalState.success) throw new RepositoryError(400, "INVALID_STATE", finalState.error);
    const nextRevision = current.revision + 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        UPDATE business_state SET revision = ?, state_json = ?, updated_at = ?
        WHERE id = 1 AND revision = ?
      `).run(nextRevision, JSON.stringify(finalState.data), now, current.revision);
      if (Number(result.changes) !== 1) {
        throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
      }
      this.recordAudit({
        ...audit,
        action: "BUSINESS_STATE_UPDATE",
        entityType: "workspace",
        entityId: "npi",
        details: { fromRevision: current.revision, toRevision: nextRevision },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { revision: nextRevision };
  }

  deleteProject(projectId, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }

    const deleted = {
      phases: project.phases.length,
      materials: current.state.materials.filter((item) => item.projectId === projectId).length,
      tasks: current.state.tasks.filter((item) => item.projectId === projectId).length,
      bomItems: current.state.bomItems.filter((item) => item.projectId === projectId).length,
      bomImports: current.state.bomImports.filter((item) => item.projectId === projectId).length,
      quotations: Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM quotations WHERE project_id = ?
      `).get(projectId).count),
    };
    const nextState = {
      ...current.state,
      projects: current.state.projects.filter(({ id }) => id !== projectId),
      materials: current.state.materials.filter((item) => item.projectId !== projectId),
      tasks: current.state.tasks.filter((item) => item.projectId !== projectId),
      workflowItems: current.state.workflowItems.filter((item) => item.projectId !== projectId),
      bomItems: current.state.bomItems.filter((item) => item.projectId !== projectId),
      bomImports: current.state.bomImports.filter((item) => item.projectId !== projectId),
    };
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_STATE", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "PROJECT_DELETE",
      entityType: "project",
      entityId: projectId,
      details: { project, deleted, actorAccountId: actor.id },
    }, () => {
      this.db.prepare("DELETE FROM quotations WHERE project_id = ?").run(projectId);
    });
    return { project, deleted, revision };
  }

  patchTask(taskId, patch, actor, audit = {}) {
    actor = this.#freshActor(actor);
    assertAllowedFields(patch, actor.systemRole === "admin" ? ADMIN_TASK_FIELDS : MEMBER_TASK_FIELDS);
    const current = this.readBusinessState();
    const index = current.state.tasks.findIndex(({ id }) => id === taskId);
    if (index < 0) throw new RepositoryError(404, "TASK_NOT_FOUND", "任务不存在");
    const task = current.state.tasks[index];
    if (actor.systemRole !== "admin" && task.ownerAccountId !== actor.id) {
      throw new RepositoryError(403, "TASK_NOT_ASSIGNED", "只能提交分配给自己的任务");
    }
    if (actor.systemRole !== "admin" && task.definitionKey === "material-readiness") {
      throw new RepositoryError(403, "DERIVED_TASK", "材料进度请在 BOM 材料页面逐项提交");
    }
    const now = isoNow(this.clock);
    const next = { ...task, ...patch, id: task.id, updatedAt: now };
    if (patch.status != null) {
      if (!isTaskStatus(patch.status)) throw new RepositoryError(400, "INVALID_STATUS", "任务状态无效");
      next.status = patch.status;
      next.actualDate = patch.status === TASK_STATUS.DONE
        ? (task.actualDate || dateOnly(now))
        : "";
    }
    if (Object.hasOwn(patch, "ownerAccountId")) {
      const owner = patch.ownerAccountId ? this.getAccount(patch.ownerAccountId) : null;
      if (patch.ownerAccountId && (!owner || !owner.active)) {
        throw new RepositoryError(409, "INVALID_OWNER", "责任人账号不存在或已停用");
      }
      next.ownerAccountId = owner?.id ?? "";
      next.owner = owner?.name ?? "待分配";
      if (owner && !Object.hasOwn(patch, "ownerRole")) next.ownerRole = owner.jobRole;
    }
    const parsed = parseBusinessState({ ...current.state, tasks: current.state.tasks.map((item, taskIndex) => (
      taskIndex === index ? next : item
    )) });
    if (!parsed.success) throw new RepositoryError(400, "INVALID_TASK", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "TASK_UPDATE",
      entityType: "task",
      entityId: taskId,
      details: { before: task, after: next, ownerAccountId: task.ownerAccountId },
    });
    return { task: next, revision };
  }

  patchWorkflowItem(itemId, patch, actor, audit = {}) {
    actor = this.#freshActor(actor);
    assertAllowedFields(
      patch,
      actor.systemRole === "admin" ? ADMIN_WORKFLOW_FIELDS : MEMBER_WORKFLOW_FIELDS,
    );
    const current = this.readBusinessState();
    const index = current.state.workflowItems.findIndex(({ id }) => id === itemId);
    if (index < 0) throw new RepositoryError(404, "WORKFLOW_ITEM_NOT_FOUND", "阶段事项不存在");
    const item = current.state.workflowItems[index];
    if (actor.systemRole !== "admin" && item.ownerAccountId !== actor.id) {
      throw new RepositoryError(403, "WORKFLOW_ITEM_NOT_ASSIGNED", "只能提交分配给自己的阶段事项");
    }
    const now = isoNow(this.clock);
    const next = { ...item, ...patch, id: item.id, updatedAt: now };
    if (patch.status != null) {
      if (!isTaskStatus(patch.status)) throw new RepositoryError(400, "INVALID_STATUS", "阶段事项状态无效");
      next.status = patch.status;
      next.actualDate = patch.status === TASK_STATUS.DONE
        ? (item.actualDate || dateOnly(now))
        : "";
    }
    if (Object.hasOwn(patch, "ownerAccountId")) {
      const owner = patch.ownerAccountId ? this.getAccount(patch.ownerAccountId) : null;
      if (patch.ownerAccountId && (!owner || !owner.active)) {
        throw new RepositoryError(409, "INVALID_OWNER", "责任人账号不存在或已停用");
      }
      next.ownerAccountId = owner?.id ?? "";
      next.owner = owner?.name ?? "待分配";
      if (owner && !Object.hasOwn(patch, "ownerRole")) next.ownerRole = owner.jobRole;
    }
    const parsed = parseBusinessState({
      ...current.state,
      workflowItems: current.state.workflowItems.map((entry, itemIndex) => (
        itemIndex === index ? next : entry
      )),
    });
    if (!parsed.success) throw new RepositoryError(400, "INVALID_WORKFLOW_ITEM", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "WORKFLOW_ITEM_UPDATE",
      entityType: "workflow_item",
      entityId: itemId,
      details: { before: item, after: next, ownerAccountId: item.ownerAccountId },
    });
    return { item: next, revision };
  }

  patchBomItem(itemId, patch, actor, audit = {}) {
    actor = this.#freshActor(actor);
    assertAllowedFields(patch, actor.systemRole === "admin" ? ADMIN_BOM_FIELDS : MEMBER_BOM_FIELDS);
    const current = this.readBusinessState();
    const index = current.state.bomItems.findIndex(({ id }) => id === itemId);
    if (index < 0) throw new RepositoryError(404, "BOM_ITEM_NOT_FOUND", "BOM 材料不存在");
    const item = current.state.bomItems[index];
    if (actor.systemRole !== "admin" && item.ownerAccountId !== actor.id) {
      throw new RepositoryError(403, "BOM_NOT_ASSIGNED", "只能提交分配给自己的材料");
    }
    if (patch.status != null && !isBomStatus(patch.status)) {
      throw new RepositoryError(400, "INVALID_STATUS", "材料准备状态无效");
    }
    if (actor.systemRole !== "admin" && [BOM_STATUS.NA, BOM_STATUS.REMOVED].includes(patch.status)) {
      throw new RepositoryError(403, "STATUS_RESTRICTED", "不适用和移出 BOM 状态只能由管理员设置");
    }
    const now = isoNow(this.clock);
    const nextStatus = patch.status ?? item.status;
    const becomingReady = nextStatus === BOM_STATUS.READY && item.status !== BOM_STATUS.READY;
    const next = { ...item, ...patch, id: item.id, status: nextStatus, updatedAt: now };
    if (Object.hasOwn(patch, "ownerAccountId")) {
      const owner = patch.ownerAccountId ? this.getAccount(patch.ownerAccountId) : null;
      if (patch.ownerAccountId && (!owner || !owner.active)) {
        throw new RepositoryError(409, "INVALID_OWNER", "责任人账号不存在或已停用");
      }
      next.ownerAccountId = owner?.id ?? "";
      next.owner = owner?.name ?? "";
    }
    if (nextStatus === BOM_STATUS.READY) {
      next.confirmedBy = becomingReady ? actor.name : item.confirmedBy;
      next.confirmedByAccountId = becomingReady ? actor.id : item.confirmedByAccountId;
      next.confirmedAt = becomingReady ? now : item.confirmedAt;
    } else {
      next.confirmedBy = "";
      next.confirmedByAccountId = "";
      next.confirmedAt = "";
    }
    const nextState = {
      ...current.state,
      tasks: [...current.state.tasks],
      bomItems: current.state.bomItems.map((entry, itemIndex) => itemIndex === index ? next : entry),
    };
    syncMaterialReadinessTask(nextState, item.parentMaterialId, now);
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_BOM_ITEM", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "BOM_ITEM_UPDATE",
      entityType: "bom_item",
      entityId: itemId,
      details: { before: item, after: next, ownerAccountId: item.ownerAccountId },
    });
    return { item: next, revision };
  }

  bulkAssignBom(itemIds, accountId, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const ids = [...new Set(Array.isArray(itemIds) ? itemIds : [])];
    if (!ids.length) throw new RepositoryError(400, "EMPTY_SELECTION", "请选择需要分配的材料");
    const owner = accountId ? this.getAccount(accountId) : null;
    if (accountId && (!owner || !owner.active)) {
      throw new RepositoryError(409, "INVALID_OWNER", "责任人账号不存在或已停用");
    }
    const current = this.readBusinessState();
    const knownIds = new Set(current.state.bomItems.map(({ id }) => id));
    if (ids.some((id) => !knownIds.has(id))) {
      throw new RepositoryError(404, "BOM_ITEM_NOT_FOUND", "选择中包含不存在的 BOM 材料");
    }
    const now = isoNow(this.clock);
    const nextState = {
      ...current.state,
      bomItems: current.state.bomItems.map((item) => ids.includes(item.id)
        ? {
          ...item,
          ownerAccountId: owner?.id ?? "",
          owner: owner?.name ?? "",
          updatedAt: now,
        }
        : item),
    };
    const revision = this.#writeEntityState(nextState, current.revision, {
      ...audit,
      action: "BOM_BULK_ASSIGN",
      entityType: "bom_item",
      entityId: ids.join(","),
      details: { itemIds: ids, ownerAccountId: owner?.id ?? "" },
    });
    return { count: ids.length, revision };
  }

  #writeEntityState(state, expectedRevision, audit, mutate = null) {
    const nextRevision = expectedRevision + 1;
    const now = isoNow(this.clock);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        UPDATE business_state SET revision = ?, state_json = ?, updated_at = ?
        WHERE id = 1 AND revision = ?
      `).run(nextRevision, JSON.stringify(state), now, expectedRevision);
      if (Number(result.changes) !== 1) {
        throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
      }
      mutate?.();
      this.recordAudit(audit);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return nextRevision;
  }

  close() {
    this.db.close();
  }
}
