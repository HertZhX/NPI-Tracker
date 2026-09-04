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
import { PROJECT_STATUS } from "../src/domain/projects.js";
import {
  ensureWorkflowState,
  getCurrentStandardPhase,
  getNextStandardStageType,
  getStageGateResult,
  MEETING_STATUS,
  MEETING_TYPE,
  PHASE_LIFECYCLE,
  PRODUCT_WORKFLOW_STATUS,
  STANDARD_STAGE_TYPES,
  STAGE_TEMPLATES,
} from "../src/domain/workflow.js";
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
const MEMBER_TASK_FIELDS = new Set(["status", "forecastDate", "blocker", "notes", "fileVersion", "evidence"]);
const ADMIN_TASK_FIELDS = new Set([
  ...MEMBER_TASK_FIELDS,
  "ownerAccountId",
  "ownerRole",
  "baselineDate",
]);
const MEMBER_WORKFLOW_FIELDS = new Set(["status", "forecastDate", "blocker", "notes", "fileVersion", "evidence"]);
const ADMIN_WORKFLOW_FIELDS = new Set([
  ...MEMBER_WORKFLOW_FIELDS,
  "ownerAccountId",
  "ownerRole",
  "baselineDate",
  "title",
  "criterion",
  "required",
]);
const MEMBER_MEETING_FIELDS = new Set([
  "status",
  "scheduledAt",
  "heldAt",
  "attendees",
  "conclusion",
]);
const ADMIN_MEETING_FIELDS = new Set([
  ...MEMBER_MEETING_FIELDS,
  "subject",
  "ownerAccountId",
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
  "fileVersion",
  "evidence",
  "updatedAt",
];
const WORKFLOW_SERVER_FIELDS = [...TASK_SERVER_FIELDS];
const MEETING_SERVER_FIELDS = [
  "status",
  "scheduledAt",
  "heldAt",
  "attendees",
  "conclusion",
  "decision",
  "ownerAccountId",
  "completedBy",
  "completedByAccountId",
  "completedAt",
  "evidence",
  "updatedAt",
];
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
const MAX_ATTACHMENT_BATCH_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_ENTITY = 20;
const QUOTATION_EXTENSIONS = new Set([
  "pdf", "xlsx", "xls", "csv", "doc", "docx", "png", "jpg", "jpeg",
]);
const QUOTATION_TABLE_EXTENSIONS = new Set(["xlsx", "csv"]);
const MAX_QUOTATION_MATCHES = 10_000;
const ATTACHMENT_MIME_TYPES = Object.freeze({
  bmp: "image/bmp",
  csv: "text/csv; charset=utf-8",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
const ATTACHMENT_EXTENSIONS = new Set(Object.keys(ATTACHMENT_MIME_TYPES));

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

function normalizeQuotationCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[‐‑‒–—﹘﹣－]/g, "-")
    .replace(/\.0+$/, "")
    .trim()
    .toLocaleUpperCase();
}

function preserveFields(incoming, existing, fields) {
  return fields.reduce((result, field) => {
    result[field] = existing[field];
    return result;
  }, { ...incoming });
}

function repairAccountReferences(state, accounts) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const knownAccountIds = new Set(accounts.map(({ id }) => id));
  const hasAccount = (accountId) => !accountId || knownAccountIds.has(accountId);
  const uniqueAccountByName = new Map();
  accounts.forEach((account) => {
    if (uniqueAccountByName.has(account.name)) uniqueAccountByName.set(account.name, null);
    else uniqueAccountByName.set(account.name, account);
  });
  const repairProductManager = (product) => {
    const manager = accountById.get(product.managerAccountId)
      ?? uniqueAccountByName.get(String(product.manager || "").trim())
      ?? null;
    return {
      ...product,
      manager: manager?.name ?? product.manager ?? "待分配",
      managerAccountId: manager?.id ?? "",
    };
  };
  const clearOwnerReference = (item) => hasAccount(item.ownerAccountId)
    ? item
    : { ...item, ownerAccountId: "" };
  const confirmationWarning = "原确认账号已失效，请重新确认";

  return {
    ...state,
    projects: state.projects.map((project) => ({
      ...project,
      manager: "",
      managerAccountId: "",
      products: project.products.map(repairProductManager),
    })),
    tasks: state.tasks.map(clearOwnerReference),
    workflowItems: state.workflowItems.map(clearOwnerReference),
    meetings: state.meetings.map((meeting) => ({
      ...meeting,
      ownerAccountId: hasAccount(meeting.ownerAccountId) ? meeting.ownerAccountId : "",
      completedByAccountId: hasAccount(meeting.completedByAccountId)
        ? meeting.completedByAccountId
        : "",
    })),
    bomItems: state.bomItems.map((item) => {
      let next = clearOwnerReference(item);
      const completeConfirmation = Boolean(
        next.confirmedByAccountId
        && knownAccountIds.has(next.confirmedByAccountId)
        && next.confirmedBy
        && next.confirmedAt,
      );

      if (next.status === BOM_STATUS.READY && !completeConfirmation) {
        const issue = next.issue?.includes(confirmationWarning)
          ? next.issue
          : `${next.issue ? `${next.issue}；` : ""}${confirmationWarning}`.slice(0, 5000);
        next = {
          ...next,
          status: BOM_STATUS.PENDING,
          issue,
          confirmedBy: "",
          confirmedByAccountId: "",
          confirmedAt: "",
        };
      } else if (next.status !== BOM_STATUS.READY && (
        next.confirmedByAccountId || next.confirmedBy || next.confirmedAt
      )) {
        next = {
          ...next,
          confirmedBy: "",
          confirmedByAccountId: "",
          confirmedAt: "",
        };
      }

      return next;
    }),
  };
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

function rowToAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    stored: true,
    name: row.file_name,
    type: row.mime_type,
    size: row.size,
    addedAt: row.uploaded_at,
    addedByAccountId: row.uploaded_by_account_id,
    addedBy: row.uploaded_by_name,
  };
}

function rowToQuotationMatch(row) {
  return {
    bomItemId: row.bom_item_id,
    materialCode: row.material_code,
    sourceRow: row.source_row,
    unitPrice: row.unit_price,
    currency: row.currency,
    vendor: row.vendor,
  };
}

function quotationFileFromInput(input, { tableOnly = false } = {}) {
  const rawFileName = String(input.fileName || "").trim();
  const fileName = rawFileName.replaceAll("\\", "/").split("/").pop() || "";
  const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
  const allowedExtensions = tableOnly ? QUOTATION_TABLE_EXTENSIONS : QUOTATION_EXTENSIONS;
  if (
    !fileName
    || fileName.length > 500
    || /[\u0000-\u001F\u007F]/.test(fileName)
    || !allowedExtensions.has(extension)
  ) {
    throw new RepositoryError(
      400,
      "INVALID_QUOTATION_FILE",
      tableOnly ? "整表匹配仅支持 .xlsx 或 .csv 报价单" : "报价单仅支持 PDF、Excel、Word、CSV 或图片文件",
    );
  }
  const mimeType = String(input.mimeType || "application/octet-stream").trim().slice(0, 200);
  const contentBase64 = String(input.contentBase64 || "").trim();
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
  return { fileName, mimeType, content };
}

function attachmentFileFromInput(input) {
  const rawFileName = String(input?.fileName || "").trim();
  const fileName = rawFileName.replaceAll("\\", "/").split("/").pop() || "";
  const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
  if (
    !fileName
    || fileName.length > 500
    || /[\u0000-\u001F\u007F]/.test(fileName)
    || !ATTACHMENT_EXTENSIONS.has(extension)
  ) {
    throw new RepositoryError(
      400,
      "INVALID_ATTACHMENT_FILE",
      "附件仅支持 PDF、图片、文本、CSV、Excel、Word 或 PowerPoint 文件",
    );
  }
  const contentBase64 = String(input?.contentBase64 || "").trim();
  if (
    !contentBase64
    || contentBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64)
  ) {
    throw new RepositoryError(400, "INVALID_ATTACHMENT_CONTENT", "附件文件内容无效");
  }
  const content = Buffer.from(contentBase64, "base64");
  const reportedSize = Number(input?.size);
  if (!content.length || content.length > MAX_ATTACHMENT_BATCH_BYTES) {
    throw new RepositoryError(413, "ATTACHMENT_TOO_LARGE", "附件不能超过 10 MB");
  }
  if (!Number.isSafeInteger(reportedSize) || reportedSize !== content.length) {
    throw new RepositoryError(400, "ATTACHMENT_SIZE_MISMATCH", "附件大小校验失败");
  }
  return {
    fileName,
    mimeType: ATTACHMENT_MIME_TYPES[extension],
    content,
  };
}

function normalizeLegacyEvidence(input) {
  if (!Array.isArray(input)) {
    throw new RepositoryError(400, "INVALID_ATTACHMENT_LIST", "附件列表无效");
  }
  return input.map((item) => {
    const name = String(item?.name || "").trim();
    const size = Number(item?.size || 0);
    if (
      !name
      || name.length > 500
      || /[\u0000-\u001F\u007F]/.test(name)
      || !Number.isFinite(size)
      || size < 0
    ) {
      throw new RepositoryError(400, "INVALID_ATTACHMENT_LIST", "历史附件信息无效");
    }
    return {
      id: "",
      name,
      type: String(item?.type || "").slice(0, 200),
      size,
      addedAt: String(item?.addedAt || "").slice(0, 64),
    };
  });
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
      CREATE TABLE IF NOT EXISTS quotation_matches (
        quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        bom_item_id TEXT NOT NULL,
        source_row INTEGER NOT NULL CHECK (source_row > 0),
        material_code TEXT NOT NULL,
        unit_price TEXT NOT NULL,
        currency TEXT NOT NULL,
        vendor TEXT NOT NULL,
        PRIMARY KEY (quotation_id, bom_item_id, source_row)
      );
      CREATE INDEX IF NOT EXISTS idx_quotation_matches_bom_item
        ON quotation_matches(bom_item_id, quotation_id);
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'workflow_item', 'meeting')),
        entity_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        phase_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size > 0),
        content BLOB NOT NULL,
        uploaded_by_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        uploaded_by_name TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_entity
        ON attachments(entity_type, entity_id, uploaded_at);
      CREATE INDEX IF NOT EXISTS idx_attachments_project
        ON attachments(project_id, product_id, phase_id);
    `);
    this.#migrateAttachmentSchema();
  }

  #migrateAttachmentSchema() {
    const tableSql = String(this.db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attachments'
    `).get()?.sql || "");
    if (tableSql.includes("'meeting'")) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE attachments_next (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'workflow_item', 'meeting')),
          entity_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          phase_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL CHECK (size > 0),
          content BLOB NOT NULL,
          uploaded_by_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
          uploaded_by_name TEXT NOT NULL,
          uploaded_at TEXT NOT NULL
        );
        INSERT INTO attachments_next SELECT * FROM attachments;
        DROP TABLE attachments;
        ALTER TABLE attachments_next RENAME TO attachments;
        CREATE INDEX idx_attachments_entity
          ON attachments(entity_type, entity_id, uploaded_at);
        CREATE INDEX idx_attachments_project
          ON attachments(project_id, product_id, phase_id);
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
    const matchesByQuotationId = new Map();
    this.db.prepare(`
      SELECT quotation_id, bom_item_id, source_row, material_code, unit_price, currency, vendor
      FROM quotation_matches
      ORDER BY quotation_id, source_row, bom_item_id
    `).all().forEach((row) => {
      const matches = matchesByQuotationId.get(row.quotation_id) ?? [];
      matches.push(rowToQuotationMatch(row));
      matchesByQuotationId.set(row.quotation_id, matches);
    });
    return this.db.prepare(`
      SELECT id, project_id, phase_id, bom_item_id, vendor, file_name, mime_type,
             size, uploaded_by_account_id, uploaded_by_name, uploaded_at
      FROM quotations
      ORDER BY uploaded_at DESC, id DESC
    `).all()
      .flatMap((row) => {
        const quotation = rowToQuotation(row);
        if (!knownProjectIds.has(quotation.projectId)) return [];
        const allMatches = matchesByQuotationId.get(quotation.id) ?? [];
        if (!allMatches.length) {
          return allowedBomItemIds.has(quotation.bomItemId) ? [{ ...quotation, matches: [] }] : [];
        }
        const matches = allMatches.filter(({ bomItemId }) => allowedBomItemIds.has(bomItemId));
        if (!matches.length) return [];
        return [{
          ...quotation,
          bomItemId: matches[0].bomItemId,
          matches,
          matchedItemCount: new Set(matches.map(({ bomItemId }) => bomItemId)).size,
        }];
      });
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

    const { fileName, mimeType, content } = quotationFileFromInput(input);
    const vendor = String(input.vendor || bomItem.vendors?.[0] || "未指定供应商").trim();
    if (!vendor || vendor.length > 500) {
      throw new RepositoryError(400, "INVALID_VENDOR", "请填写有效的报价供应商");
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

  createQuotationImport(input, actor, audit = {}) {
    actor = this.#freshActor(actor);
    const { state } = this.readBusinessState();
    const rawMatches = Array.isArray(input.matches) ? input.matches : [];
    if (!rawMatches.length || rawMatches.length > MAX_QUOTATION_MATCHES) {
      throw new RepositoryError(400, "INVALID_QUOTATION_MATCHES", "报价单必须匹配 1 至 10000 条 BOM 明细");
    }

    const bomItemById = new Map(state.bomItems.map((item) => [item.id, item]));
    const matchKeys = new Set();
    let scope = null;
    const matches = rawMatches.map((inputMatch) => {
      const bomItem = bomItemById.get(String(inputMatch?.bomItemId || ""));
      if (!bomItem) throw new RepositoryError(404, "BOM_ITEM_NOT_FOUND", "报价单包含不存在的 BOM 材料");
      if (actor.systemRole !== "admin" && bomItem.ownerAccountId !== actor.id) {
        throw new RepositoryError(403, "BOM_NOT_ASSIGNED", "报价单只能匹配分配给自己的材料");
      }
      if (bomItem.status === BOM_STATUS.REMOVED) {
        throw new RepositoryError(409, "BOM_ITEM_REMOVED", "报价单不能匹配已移出 BOM 的材料");
      }
      const itemScope = `${bomItem.projectId}\u0000${bomItem.productId}\u0000${bomItem.phaseId}`;
      if (scope && itemScope !== scope) {
        throw new RepositoryError(400, "QUOTATION_SCOPE_MISMATCH", "一张报价单只能导入当前产品当前阶段的 BOM");
      }
      scope = itemScope;

      const materialCode = normalizeQuotationCode(inputMatch?.materialCode);
      const normalizedCandidates = [bomItem.code, bomItem.internalCode]
        .map(normalizeQuotationCode)
        .filter(Boolean);
      const compactMaterialCode = materialCode.replace(/[^0-9A-Z\u4E00-\u9FFF]/g, "");
      const codeMatches = normalizedCandidates.some((candidate) => (
        candidate === materialCode
        || candidate.replace(/[^0-9A-Z\u4E00-\u9FFF]/g, "") === compactMaterialCode
      ));
      if (!materialCode || !codeMatches) {
        throw new RepositoryError(400, "QUOTATION_CODE_MISMATCH", `报价料号 ${materialCode || "（空）"} 与 BOM 不一致`);
      }

      const sourceRow = Number(inputMatch?.sourceRow);
      const unitPrice = String(inputMatch?.unitPrice || "").trim();
      const currency = String(inputMatch?.currency || "").trim().toLocaleUpperCase().slice(0, 20);
      const vendor = String(
        inputMatch?.vendor || input.vendor || bomItem.vendors?.[0] || "未指定供应商",
      ).trim();
      if (!Number.isSafeInteger(sourceRow) || sourceRow <= 0) {
        throw new RepositoryError(400, "INVALID_QUOTATION_ROW", "报价单来源行号无效");
      }
      if (!/^\d+(?:\.\d+)?$/.test(unitPrice) || unitPrice.length > 100) {
        throw new RepositoryError(400, "INVALID_UNIT_PRICE", `报价料号 ${materialCode} 的单价无效`);
      }
      if (!vendor || vendor.length > 500) {
        throw new RepositoryError(400, "INVALID_VENDOR", `报价料号 ${materialCode} 的供应商无效`);
      }
      const matchKey = `${bomItem.id}\u0000${sourceRow}`;
      if (matchKeys.has(matchKey)) {
        throw new RepositoryError(400, "DUPLICATE_QUOTATION_MATCH", `报价料号 ${materialCode} 的来源行重复`);
      }
      matchKeys.add(matchKey);
      return {
        bomItemId: bomItem.id,
        materialCode,
        sourceRow,
        unitPrice,
        currency,
        vendor,
      };
    });

    const { fileName, mimeType, content } = quotationFileFromInput(input, { tableOnly: true });
    const firstBomItem = bomItemById.get(matches[0].bomItemId);
    const vendors = [...new Set(matches.map(({ vendor }) => vendor).filter(Boolean))];
    const summaryVendor = String(input.vendor || "").trim()
      || (vendors.length === 1 ? vendors[0] : `多供应商（${vendors.length}）`);
    const quotation = {
      id: `quotation-${randomBytes(12).toString("hex")}`,
      projectId: firstBomItem.projectId,
      phaseId: firstBomItem.phaseId,
      bomItemId: firstBomItem.id,
      vendor: summaryVendor,
      fileName,
      mimeType,
      size: content.length,
      uploadedByAccountId: actor.id,
      uploadedBy: actor.name,
      uploadedAt: isoNow(this.clock),
      matches,
      matchedItemCount: new Set(matches.map(({ bomItemId }) => bomItemId)).size,
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
      const insertMatch = this.db.prepare(`
        INSERT INTO quotation_matches (
          quotation_id, bom_item_id, source_row, material_code, unit_price, currency, vendor
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      matches.forEach((match) => insertMatch.run(
        quotation.id,
        match.bomItemId,
        match.sourceRow,
        match.materialCode,
        match.unitPrice,
        match.currency,
        match.vendor,
      ));
      this.recordAudit({
        ...audit,
        action: "QUOTATION_TABLE_IMPORT",
        entityType: "quotation",
        entityId: quotation.id,
        details: { ...quotation, matches: matches.slice(0, 100) },
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
    const matchedIds = this.db.prepare(`
      SELECT bom_item_id FROM quotation_matches WHERE quotation_id = ?
    `).all(quotationId).map(({ bom_item_id: bomItemId }) => bomItemId);
    if (!matchedIds.length) matchedIds.push(row.bom_item_id);
    const matchedItems = state.bomItems.filter(({ id }) => matchedIds.includes(id));
    if (!matchedItems.length) throw new RepositoryError(404, "BOM_ITEM_NOT_FOUND", "报价单关联的 BOM 材料不存在");
    if (actor.systemRole !== "admin" && !matchedItems.some(({ ownerAccountId }) => ownerAccountId === actor.id)) {
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
      products: state.projects.reduce((count, project) => count + project.products.filter((product) => (
        product.managerAccountId === accountId
        || (!product.managerAccountId && product.manager === account.name)
      )).length, 0),
      tasks: state.tasks.filter(({ ownerAccountId, owner }) => (
        ownerAccountId === accountId || (!ownerAccountId && owner === account.name)
      )).length,
      workflowItems: state.workflowItems.filter(({ ownerAccountId, owner }) => (
        ownerAccountId === accountId || (!ownerAccountId && owner === account.name)
      )).length,
      meetings: state.meetings.filter(({ ownerAccountId, completedByAccountId }) => (
        ownerAccountId === accountId || completedByAccountId === accountId
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
    const ensured = ensureWorkflowState(
      parsed.data.projects,
      parsed.data.workflowItems,
      parsed.data.meetings,
    );
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
      const selectedProduct = selectedProject?.products[0] ?? null;
      const selectedPhase = selectedProduct?.phases.find(({ type }) => type === "MP")
        ?? selectedProduct?.phases[0]
        ?? null;
      return {
        ...state,
        quotations: this.getQuotationMetadata(account, state),
        accounts,
        currentAccountId: account.id,
        selectedProjectId: selectedProject?.id ?? null,
        selectedProductId: selectedProduct?.id ?? null,
        selectedPhaseId: selectedPhase?.id ?? null,
        revision,
        permissions: { canManage: true, canAssign: true, canImport: true },
      };
    }

    const managedProducts = state.projects.flatMap((project) => (
      project.products
        .filter(({ managerAccountId }) => managerAccountId === account.id)
        .map((product) => ({ projectId: project.id, product }))
    ));
    const managedProjectIds = new Set(managedProducts.map(({ projectId }) => projectId));
    const managedProductIds = new Set(managedProducts.map(({ product }) => product.id));
    const managedPhaseIds = new Set(managedProducts.flatMap(({ product }) => (
      product.phases.map(({ id }) => id)
    )));
    const tasks = state.tasks.filter(({ ownerAccountId }) => ownerAccountId === account.id);
    const assignedWorkflowItems = state.workflowItems.filter(({ ownerAccountId }) => ownerAccountId === account.id);
    const assignedMeetings = state.meetings.filter(({ ownerAccountId }) => ownerAccountId === account.id);
    const bomItems = state.bomItems.filter(({ ownerAccountId }) => ownerAccountId === account.id);
    const projectIds = new Set([
      ...managedProjectIds,
      ...tasks.map(({ projectId }) => projectId),
      ...assignedWorkflowItems.map(({ projectId }) => projectId),
      ...assignedMeetings.map(({ projectId }) => projectId),
      ...bomItems.map(({ projectId }) => projectId),
    ]);
    const productIds = new Set([
      ...managedProductIds,
      ...tasks.map(({ productId }) => productId),
      ...assignedWorkflowItems.map(({ productId }) => productId),
      ...assignedMeetings.map(({ productId }) => productId),
      ...bomItems.map(({ productId }) => productId),
    ]);
    const workflowItems = state.workflowItems.filter(({ productId }) => productIds.has(productId));
    const meetings = state.meetings.filter(({ productId }) => productIds.has(productId));
    const phaseIds = new Set([
      ...managedPhaseIds,
      ...tasks.map(({ phaseId }) => phaseId),
      ...workflowItems.map(({ phaseId }) => phaseId),
      ...assignedMeetings.map(({ phaseId }) => phaseId),
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
        products: project.products
          .filter(({ id }) => productIds.has(id))
          .map((product) => ({
            ...product,
            phases: product.phases.filter(({ id }) => phaseIds.has(id)),
          }))
          .filter(({ phases }) => phases.length > 0),
      }))
      .filter(({ products }) => products.length > 0)
      .map((project) => ({
        ...project,
        phases: project.products[0].phases,
        productLine: project.products[0].name,
      }));
    const materials = state.materials.filter(({ id }) => materialIds.has(id));
    const bomImports = state.bomImports.filter(({ parentMaterialId }) => materialIds.has(parentMaterialId));
    const definitionKeys = new Set(tasks.map(({ definitionKey }) => definitionKey));
    const definitions = state.definitions.filter(({ key }) => definitionKeys.has(key));
    const selectedProject = projects[0] ?? null;
    const selectedProduct = selectedProject?.products[0] ?? null;
    const selectedPhase = selectedProduct?.phases[0] ?? null;
    return {
      projects,
      materials,
      definitions,
      tasks,
      workflowItems,
      meetings,
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
      selectedProductId: selectedProduct?.id ?? null,
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
    const currentMeetings = new Map(current.state.meetings.map((meeting) => [meeting.id, meeting]));
    const currentBomItems = new Map(current.state.bomItems.map((item) => [item.id, item]));
    const incomingWorkflowItems = Array.isArray(input.workflowItems)
      ? parsed.data.workflowItems
      : current.state.workflowItems;
    const incomingMeetings = Array.isArray(input.meetings)
      ? parsed.data.meetings
      : current.state.meetings;
    const mergedState = repairAccountReferences({
      ...parsed.data,
      tasks: parsed.data.tasks.map((task) => {
        const existing = currentTasks.get(task.id);
        return existing ? preserveFields(task, existing, TASK_SERVER_FIELDS) : task;
      }),
      workflowItems: incomingWorkflowItems.map((item) => {
        const existing = currentWorkflowItems.get(item.id);
        return existing ? preserveFields(item, existing, WORKFLOW_SERVER_FIELDS) : item;
      }),
      meetings: incomingMeetings.map((meeting) => {
        const existing = currentMeetings.get(meeting.id);
        return existing ? preserveFields(meeting, existing, MEETING_SERVER_FIELDS) : meeting;
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
    }, this.getAccounts());

    const knownAccountIds = new Set(this.getAccounts().map(({ id }) => id));
    const invalidAccountReference = mergedState.projects.some((project) => (
      project.products.some(({ managerAccountId }) => (
        managerAccountId && !knownAccountIds.has(managerAccountId)
      ))
    )) || mergedState.tasks.some(({ ownerAccountId }) => (
      ownerAccountId && !knownAccountIds.has(ownerAccountId)
    )) || mergedState.workflowItems.some(({ ownerAccountId }) => (
      ownerAccountId && !knownAccountIds.has(ownerAccountId)
    )) || mergedState.meetings.some(({ ownerAccountId, completedByAccountId }) => (
      (ownerAccountId && !knownAccountIds.has(ownerAccountId))
      || (completedByAccountId && !knownAccountIds.has(completedByAccountId))
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
      const liveAttachmentIds = new Set([
        ...finalState.data.tasks,
        ...finalState.data.workflowItems,
        ...finalState.data.meetings,
      ].flatMap(({ evidence }) => evidence.map(({ id }) => id).filter(Boolean)));
      const removeAttachment = this.db.prepare("DELETE FROM attachments WHERE id = ?");
      for (const { id } of this.db.prepare("SELECT id FROM attachments").all()) {
        if (!liveAttachmentIds.has(id)) removeAttachment.run(id);
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

  updateProjectDetails(projectId, input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    const name = String(input?.name || "").trim();
    if (!name) throw new RepositoryError(400, "PROJECT_NAME_REQUIRED", "请输入项目名称");
    if (name.length > 500) throw new RepositoryError(400, "PROJECT_NAME_TOO_LONG", "项目名称过长");
    const nextProject = { ...project, name };
    const nextState = {
      ...current.state,
      projects: current.state.projects.map((entry) => entry.id === projectId ? nextProject : entry),
    };
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_PROJECT", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "PROJECT_UPDATE",
      entityType: "project",
      entityId: projectId,
      details: { before: { name: project.name }, after: { name }, actorAccountId: actor.id },
    });
    return { project: nextProject, revision };
  }

  updateProductDetails(projectId, productId, input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    const product = project.products.find(({ id }) => id === productId);
    if (!product) throw new RepositoryError(404, "PRODUCT_NOT_FOUND", "产品不存在");
    const name = String(input?.name || "").trim();
    const partNumber = String(input?.partNumber || "").trim();
    const version = String(input?.version || "").trim();
    if (!name) throw new RepositoryError(400, "PRODUCT_NAME_REQUIRED", "请输入产品名称");
    if (!partNumber) throw new RepositoryError(400, "PART_NUMBER_REQUIRED", "请输入产品料号");
    if (!version) throw new RepositoryError(400, "PRODUCT_VERSION_REQUIRED", "请输入产品版本");
    if ([name, partNumber, version].some((value) => value.length > 500)) {
      throw new RepositoryError(400, "PRODUCT_DETAILS_TOO_LONG", "产品信息过长");
    }
    const duplicate = project.products.some((entry) => (
      entry.id !== productId
      && (entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        || entry.partNumber.toLocaleLowerCase() === partNumber.toLocaleLowerCase())
    ));
    if (duplicate) throw new RepositoryError(409, "PRODUCT_DUPLICATE", "产品名称或料号已存在");
    const nextProduct = { ...product, name, partNumber, version };
    const nextProject = {
      ...project,
      products: project.products.map((entry) => entry.id === productId ? nextProduct : entry),
      productLine: project.products[0]?.id === productId ? name : project.productLine,
    };
    nextProject.phases = nextProject.products[0]?.phases ?? [];
    const nextState = {
      ...current.state,
      projects: current.state.projects.map((entry) => entry.id === projectId ? nextProject : entry),
    };
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_PRODUCT", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "PRODUCT_UPDATE",
      entityType: "product",
      entityId: productId,
      details: {
        projectId,
        before: { name: product.name, partNumber: product.partNumber, version: product.version },
        after: { name, partNumber, version },
        actorAccountId: actor.id,
      },
    });
    return { project: nextProject, product: nextProduct, revision };
  }

  setProjectStatus(projectId, input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const status = String(input?.status || "").trim();
    const note = String(input?.note || "").trim();
    if (![PROJECT_STATUS.ACTIVE, PROJECT_STATUS.COMPLETED].includes(status)) {
      throw new RepositoryError(400, "INVALID_PROJECT_STATUS", "项目状态无效");
    }
    if (!note) throw new RepositoryError(400, "COMPLETION_NOTE_REQUIRED", "请填写状态变更说明");
    if (note.length > 10_000) throw new RepositoryError(400, "COMPLETION_NOTE_TOO_LONG", "状态变更说明过长");

    const current = this.readBusinessState();
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }

    const now = isoNow(this.clock);
    const nextProject = status === PROJECT_STATUS.COMPLETED
      ? {
        ...project,
        status,
        completedAt: now,
        completedBy: actor.name,
        completedByAccountId: actor.id,
        completionNote: note,
      }
      : {
        ...project,
        status,
        completedAt: "",
        completedBy: "",
        completedByAccountId: "",
        completionNote: "",
      };
    const nextState = {
      ...current.state,
      projects: current.state.projects.map((entry) => entry.id === projectId ? nextProject : entry),
    };
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_STATE", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: status === PROJECT_STATUS.COMPLETED ? "PROJECT_COMPLETE" : "PROJECT_REOPEN",
      entityType: "project",
      entityId: projectId,
      details: {
        beforeStatus: project.status,
        afterStatus: status,
        note,
        actorAccountId: actor.id,
      },
    });
    return { project: nextProject, revision };
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
      phases: project.products.reduce((total, product) => total + product.phases.length, 0),
      materials: current.state.materials.filter((item) => item.projectId === projectId).length,
      tasks: current.state.tasks.filter((item) => item.projectId === projectId).length,
      meetings: current.state.meetings.filter((item) => item.projectId === projectId).length,
      bomItems: current.state.bomItems.filter((item) => item.projectId === projectId).length,
      bomImports: current.state.bomImports.filter((item) => item.projectId === projectId).length,
      attachments: Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM attachments WHERE project_id = ?
      `).get(projectId).count),
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
      meetings: current.state.meetings.filter((item) => item.projectId !== projectId),
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
      this.db.prepare("DELETE FROM attachments WHERE project_id = ?").run(projectId);
    });
    return { project, deleted, revision };
  }

  deleteProduct(projectId, productId, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    const product = project.products.find(({ id }) => id === productId);
    if (!product) throw new RepositoryError(404, "PRODUCT_NOT_FOUND", "产品不存在");
    if (project.products.length <= 1) {
      throw new RepositoryError(409, "LAST_PRODUCT", "项目至少需要保留一个产品");
    }
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }

    const phaseIds = new Set(product.phases.map(({ id }) => id));
    const belongsToProduct = (item) => (
      item.projectId === projectId
      && (item.productId === productId || phaseIds.has(item.phaseId))
    );
    const quotationCount = phaseIds.size
      ? Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM quotations
        WHERE project_id = ? AND phase_id IN (${[...phaseIds].map(() => "?").join(", ")})
      `).get(projectId, ...phaseIds).count)
      : 0;
    const deleted = {
      phases: product.phases.length,
      materials: current.state.materials.filter(belongsToProduct).length,
      tasks: current.state.tasks.filter(belongsToProduct).length,
      workflowItems: current.state.workflowItems.filter(belongsToProduct).length,
      meetings: current.state.meetings.filter(belongsToProduct).length,
      bomItems: current.state.bomItems.filter(belongsToProduct).length,
      bomImports: current.state.bomImports.filter(belongsToProduct).length,
      attachments: Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM attachments WHERE project_id = ? AND product_id = ?
      `).get(projectId, productId).count),
      quotations: quotationCount,
    };
    const projects = current.state.projects.map((entry) => {
      if (entry.id !== projectId) return entry;
      const products = entry.products.filter(({ id }) => id !== productId);
      return {
        ...entry,
        products,
        phases: products[0]?.phases ?? [],
        productLine: products[0]?.name ?? "",
      };
    });
    const nextState = {
      ...current.state,
      projects,
      materials: current.state.materials.filter((item) => !belongsToProduct(item)),
      tasks: current.state.tasks.filter((item) => !belongsToProduct(item)),
      workflowItems: current.state.workflowItems.filter((item) => !belongsToProduct(item)),
      meetings: current.state.meetings.filter((item) => !belongsToProduct(item)),
      bomItems: current.state.bomItems.filter((item) => !belongsToProduct(item)),
      bomImports: current.state.bomImports.filter((item) => !belongsToProduct(item)),
    };
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_STATE", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "PRODUCT_DELETE",
      entityType: "product",
      entityId: productId,
      details: { projectId, product, deleted, actorAccountId: actor.id },
    }, () => {
      this.db.prepare(`
        DELETE FROM attachments WHERE project_id = ? AND product_id = ?
      `).run(projectId, productId);
      if (phaseIds.size) {
        this.db.prepare(`
          DELETE FROM quotations
          WHERE project_id = ? AND phase_id IN (${[...phaseIds].map(() => "?").join(", ")})
        `).run(projectId, ...phaseIds);
      }
    });
    return { project: { id: project.id, code: project.code }, product, deleted, revision };
  }

  deleteStage(projectId, productId, phaseId, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    const product = project.products.find(({ id }) => id === productId);
    if (!product) throw new RepositoryError(404, "PRODUCT_NOT_FOUND", "产品不存在");
    const phase = product.phases.find(({ id }) => id === phaseId);
    if (!phase) throw new RepositoryError(404, "STAGE_NOT_FOUND", "阶段不存在");
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const standardPhases = product.phases
      .filter(({ type }) => STANDARD_STAGE_TYPES.includes(type))
      .toSorted((left, right) => STANDARD_STAGE_TYPES.indexOf(left.type) - STANDARD_STAGE_TYPES.indexOf(right.type));
    if (standardPhases.length <= 1) {
      throw new RepositoryError(409, "LAST_STAGE", "产品至少需要保留一个标准阶段");
    }
    if (standardPhases.at(-1)?.id !== phaseId) {
      throw new RepositoryError(409, "NON_TAIL_STAGE", "只能撤销产品最后一个阶段");
    }
    const belongsToStage = (item) => item.projectId === projectId && item.phaseId === phaseId;
    const stageItems = current.state.workflowItems.filter(belongsToStage);
    const stageMeetings = current.state.meetings.filter(belongsToStage);
    const stageHasProgress = current.state.materials.some(belongsToStage)
      || current.state.bomItems.some(belongsToStage)
      || stageItems.some((item) => (
        item.status !== TASK_STATUS.NOT_STARTED
        || item.evidence.length > 0
        || item.notes
        || item.blocker
      ))
      || stageMeetings.some((meeting) => (
        meeting.status !== MEETING_STATUS.PENDING
        || meeting.evidence.length > 0
        || meeting.conclusion
      ));
    if (stageHasProgress) {
      throw new RepositoryError(409, "STAGE_IN_USE", "阶段已经开始或包含业务记录，不能直接撤销");
    }
    const deleted = {
      materials: current.state.materials.filter(belongsToStage).length,
      tasks: current.state.tasks.filter(belongsToStage).length,
      workflowItems: current.state.workflowItems.filter(belongsToStage).length,
      meetings: stageMeetings.length,
      bomItems: current.state.bomItems.filter(belongsToStage).length,
      bomImports: current.state.bomImports.filter(belongsToStage).length,
      attachments: Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM attachments
        WHERE project_id = ? AND product_id = ? AND phase_id = ?
      `).get(projectId, productId, phaseId).count),
      quotations: Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM quotations WHERE project_id = ? AND phase_id = ?
      `).get(projectId, phaseId).count),
    };
    const projects = current.state.projects.map((entry) => {
      if (entry.id !== projectId) return entry;
      const products = entry.products.map((item) => item.id === productId
        ? { ...item, phases: item.phases.filter(({ id }) => id !== phaseId) }
        : item);
      return { ...entry, products, phases: products[0]?.phases ?? [] };
    });
    const nextState = {
      ...current.state,
      projects,
      materials: current.state.materials.filter((item) => !belongsToStage(item)),
      tasks: current.state.tasks.filter((item) => !belongsToStage(item)),
      workflowItems: current.state.workflowItems.filter((item) => !belongsToStage(item)),
      meetings: current.state.meetings.filter((item) => !belongsToStage(item)),
      bomItems: current.state.bomItems.filter((item) => !belongsToStage(item)),
      bomImports: current.state.bomImports.filter((item) => !belongsToStage(item)),
    };
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_STATE", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "STAGE_DELETE",
      entityType: "stage",
      entityId: phaseId,
      details: { projectId, productId, phase, deleted, actorAccountId: actor.id },
    }, () => {
      this.db.prepare(`
        DELETE FROM attachments
        WHERE project_id = ? AND product_id = ? AND phase_id = ?
      `).run(projectId, productId, phaseId);
      this.db.prepare(`
        DELETE FROM quotations WHERE project_id = ? AND phase_id = ?
      `).run(projectId, phaseId);
    });
    return {
      project: { id: project.id, code: project.code },
      product: { id: product.id, name: product.name },
      phase,
      deleted,
      revision,
    };
  }

  #findAttachmentEntity(state, entityType, entityId) {
    const collection = entityType === "task"
      ? state.tasks
      : entityType === "workflow_item"
        ? state.workflowItems
        : entityType === "meeting"
          ? state.meetings
          : null;
    if (!collection) {
      throw new RepositoryError(400, "INVALID_ATTACHMENT_ENTITY", "附件关联类型无效");
    }
    const entity = collection.find(({ id }) => id === entityId);
    if (!entity) {
      const errorMeta = entityType === "task"
        ? ["TASK_NOT_FOUND", "任务不存在"]
        : entityType === "workflow_item"
          ? ["WORKFLOW_ITEM_NOT_FOUND", "阶段事项不存在"]
          : ["MEETING_NOT_FOUND", "会议不存在"];
      throw new RepositoryError(404, errorMeta[0], errorMeta[1]);
    }
    return { collection, entity };
  }

  #assertAttachmentAccess(entityType, entity, actor, { write = false } = {}) {
    if (actor.systemRole === "admin") return;
    if (entity.ownerAccountId !== actor.id) {
      throw new RepositoryError(
        403,
        "ATTACHMENT_FORBIDDEN",
        write ? "只能修改分配给自己的事项附件" : "无权查看该附件",
      );
    }
    if (write && entityType === "task" && entity.definitionKey === "material-readiness") {
      throw new RepositoryError(403, "DERIVED_TASK", "材料进度请在 BOM 材料页面逐项提交");
    }
  }

  syncAttachments(entityType, entityId, input, actor, audit = {}) {
    actor = this.#freshActor(actor);
    const current = this.readBusinessState();
    const { entity } = this.#findAttachmentEntity(current.state, entityType, entityId);
    this.#assertAttachmentAccess(entityType, entity, actor, { write: true });

    const deleteIds = [...new Set(Array.isArray(input?.deleteIds) ? input.deleteIds : [])];
    if (deleteIds.some((id) => typeof id !== "string" || !id || id.length > 200)) {
      throw new RepositoryError(400, "INVALID_ATTACHMENT_LIST", "待删除附件列表无效");
    }
    const legacyEvidence = normalizeLegacyEvidence(input?.legacyEvidence ?? []);
    const rawFiles = Array.isArray(input?.files) ? input.files : [];
    const files = rawFiles.map(attachmentFileFromInput);
    const totalBytes = files.reduce((total, file) => total + file.content.length, 0);
    if (totalBytes > MAX_ATTACHMENT_BATCH_BYTES) {
      throw new RepositoryError(413, "ATTACHMENT_BATCH_TOO_LARGE", "单次新增附件总量不能超过 10 MB");
    }

    const rows = this.db.prepare(`
      SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ?
    `).all(entityType, entityId);
    const rowById = new Map(rows.map((row) => [row.id, row]));
    if (deleteIds.some((id) => !rowById.has(id))) {
      throw new RepositoryError(404, "ATTACHMENT_NOT_FOUND", "待删除附件不存在");
    }

    const deleteIdSet = new Set(deleteIds);
    const keptAttachments = rows
      .filter((row) => !deleteIdSet.has(row.id))
      .map(rowToAttachment);
    const finalCount = keptAttachments.length + legacyEvidence.length + files.length;
    if (finalCount > MAX_ATTACHMENTS_PER_ENTITY) {
      throw new RepositoryError(400, "TOO_MANY_ATTACHMENTS", "每个事项最多保留 20 个附件");
    }

    const knownFiles = new Set([
      ...keptAttachments,
      ...legacyEvidence,
    ].map((item) => `${item.name.toLocaleLowerCase()}:${item.size}`));
    for (const file of files) {
      const key = `${file.fileName.toLocaleLowerCase()}:${file.content.length}`;
      if (knownFiles.has(key)) {
        throw new RepositoryError(409, "DUPLICATE_ATTACHMENT", `附件 ${file.fileName} 已存在`);
      }
      knownFiles.add(key);
    }

    const now = isoNow(this.clock);
    const uploaded = files.map((file) => ({
      id: `attachment-${randomBytes(16).toString("hex")}`,
      entityType,
      entityId,
      projectId: entity.projectId,
      productId: entity.productId || "",
      phaseId: entity.phaseId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.content.length,
      content: file.content,
      uploadedByAccountId: actor.id,
      uploadedBy: actor.name,
      uploadedAt: now,
    }));
    const uploadedEvidence = uploaded.map((item) => ({
      id: item.id,
      stored: true,
      name: item.fileName,
      type: item.mimeType,
      size: item.size,
      addedAt: item.uploadedAt,
      addedByAccountId: item.uploadedByAccountId,
      addedBy: item.uploadedBy,
    }));
    const next = {
      ...entity,
      evidence: [...keptAttachments, ...legacyEvidence, ...uploadedEvidence],
      updatedAt: now,
    };
    const collectionKey = entityType === "task"
      ? "tasks"
      : entityType === "workflow_item"
        ? "workflowItems"
        : "meetings";
    const nextState = {
      ...current.state,
      [collectionKey]: current.state[collectionKey].map((item) => item.id === entityId ? next : item),
    };
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_ATTACHMENT_LIST", parsed.error);

    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "ATTACHMENT_SYNC",
      entityType,
      entityId,
      details: {
        uploaded: uploadedEvidence,
        deletedIds: deleteIds,
        ownerAccountId: entity.ownerAccountId,
      },
    }, () => {
      if (deleteIds.length) {
        this.db.prepare(`
          DELETE FROM attachments
          WHERE entity_type = ? AND entity_id = ? AND id IN (${deleteIds.map(() => "?").join(", ")})
        `).run(entityType, entityId, ...deleteIds);
      }
      const insert = this.db.prepare(`
        INSERT INTO attachments (
          id, entity_type, entity_id, project_id, product_id, phase_id,
          file_name, mime_type, size, content,
          uploaded_by_account_id, uploaded_by_name, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of uploaded) {
        insert.run(
          item.id,
          item.entityType,
          item.entityId,
          item.projectId,
          item.productId,
          item.phaseId,
          item.fileName,
          item.mimeType,
          item.size,
          item.content,
          item.uploadedByAccountId,
          item.uploadedBy,
          item.uploadedAt,
        );
      }
    });
    return { entity: next, attachments: uploadedEvidence, revision };
  }

  getAttachmentFile(attachmentId, actor) {
    actor = this.#freshActor(actor);
    const row = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(attachmentId);
    if (!row) throw new RepositoryError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    const { state } = this.readBusinessState();
    const { entity } = this.#findAttachmentEntity(state, row.entity_type, row.entity_id);
    this.#assertAttachmentAccess(row.entity_type, entity, actor);
    if (!entity.evidence.some(({ id }) => id === row.id)) {
      throw new RepositoryError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    }
    return { attachment: rowToAttachment(row), content: row.content };
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
    if (item.archivedAt) throw new RepositoryError(409, "WORKFLOW_ITEM_ARCHIVED", "阶段事项已停用，请先恢复后再修改");
    if (actor.systemRole !== "admin" && item.ownerAccountId !== actor.id) {
      throw new RepositoryError(403, "WORKFLOW_ITEM_NOT_ASSIGNED", "只能提交分配给自己的阶段事项");
    }
    const now = isoNow(this.clock);
    const next = { ...item, ...patch, id: item.id, updatedAt: now };
    if (Object.hasOwn(patch, "title")) {
      next.title = String(patch.title || "").trim();
      if (!next.title) throw new RepositoryError(400, "WORKFLOW_TITLE_REQUIRED", "请输入事项名称");
      next.customized = true;
    }
    if (Object.hasOwn(patch, "criterion")) {
      next.criterion = String(patch.criterion || "").trim();
      next.customized = true;
    }
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

  createWorkflowItem(input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const projectId = String(input?.projectId || "");
    const productId = String(input?.productId || "");
    const phaseId = String(input?.phaseId || "");
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    const product = project.products.find(({ id }) => id === productId);
    if (!product) throw new RepositoryError(404, "PRODUCT_NOT_FOUND", "产品不存在");
    const phase = product.phases.find(({ id }) => id === phaseId);
    if (!phase) throw new RepositoryError(404, "STAGE_NOT_FOUND", "阶段不存在");
    if (project.status === PROJECT_STATUS.COMPLETED) {
      throw new RepositoryError(409, "PROJECT_COMPLETED", "项目已完结，请先恢复项目再新增事项");
    }
    const currentPhase = getCurrentStandardPhase(product);
    if (currentPhase?.id !== phaseId || product.workflowStatus !== PRODUCT_WORKFLOW_STATUS.ACTIVE) {
      throw new RepositoryError(409, "STAGE_NOT_CURRENT", "只能配置当前进行中的产品阶段");
    }

    const kind = String(input?.kind || "checkpoint");
    const title = String(input?.title || "").trim();
    const criterion = String(input?.criterion || "").trim();
    const ownerRole = String(input?.ownerRole || "").trim();
    const baselineDate = String(input?.baselineDate || phase.planDate || dateOnly(isoNow(this.clock))).slice(0, 64);
    if (!["checkpoint", "deliverable"].includes(kind)) {
      throw new RepositoryError(400, "INVALID_WORKFLOW_KIND", "事项类型无效");
    }
    if (kind === "deliverable" && phase.type !== "MP") {
      throw new RepositoryError(400, "DELIVERABLE_MP_ONLY", "交付文件统一在 MP 阶段维护");
    }
    if (!title) throw new RepositoryError(400, "WORKFLOW_TITLE_REQUIRED", "请输入事项名称");
    if (title.length > 500 || criterion.length > 10_000 || ownerRole.length > 500) {
      throw new RepositoryError(400, "INVALID_WORKFLOW_ITEM", "阶段事项内容过长");
    }

    const now = isoNow(this.clock);
    const order = current.state.workflowItems.reduce((maximum, item) => (
      item.phaseId === phaseId && item.kind === kind ? Math.max(maximum, item.order ?? 0) : maximum
    ), -1) + 1;
    const token = randomBytes(12).toString("hex");
    const item = {
      id: `workflow-${token}`,
      projectId,
      productId,
      phaseId,
      stageType: phase.type,
      kind,
      key: `manual-${token}`,
      title,
      criterion: criterion || "完成交付、评审与受控归档",
      source: "manual",
      customized: true,
      required: input?.required !== false,
      archivedAt: "",
      archivedBy: "",
      archivedByAccountId: "",
      archiveReason: "",
      order,
      status: TASK_STATUS.NOT_STARTED,
      owner: "待分配",
      ownerAccountId: "",
      ownerRole,
      baselineDate,
      forecastDate: baselineDate,
      actualDate: null,
      blocker: "",
      notes: "",
      fileVersion: "",
      evidence: [],
      updatedAt: now,
    };
    const parsed = parseBusinessState({
      ...current.state,
      workflowItems: [...current.state.workflowItems, item],
    });
    if (!parsed.success) throw new RepositoryError(400, "INVALID_WORKFLOW_ITEM", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "WORKFLOW_ITEM_CREATE",
      entityType: "workflow_item",
      entityId: item.id,
      details: { projectId, productId, phaseId, kind, title, actorAccountId: actor.id },
    });
    return { item, revision };
  }

  setWorkflowItemArchived(itemId, input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const index = current.state.workflowItems.findIndex(({ id }) => id === itemId);
    if (index < 0) throw new RepositoryError(404, "WORKFLOW_ITEM_NOT_FOUND", "阶段事项不存在");
    const item = current.state.workflowItems[index];
    const project = current.state.projects.find(({ id }) => id === item.projectId);
    const product = project?.products.find(({ id }) => id === item.productId);
    const currentPhase = getCurrentStandardPhase(product);
    if (!project || !product || currentPhase?.id !== item.phaseId
      || product.workflowStatus !== PRODUCT_WORKFLOW_STATUS.ACTIVE) {
      throw new RepositoryError(409, "STAGE_NOT_CURRENT", "只能配置当前进行中的产品阶段");
    }
    const archived = Boolean(input?.archived);
    const reason = String(input?.reason || "").trim();
    if (archived && !reason) {
      throw new RepositoryError(400, "ARCHIVE_REASON_REQUIRED", "请填写停用原因");
    }
    const now = isoNow(this.clock);
    const next = archived
      ? {
        ...item,
        archivedAt: now,
        archivedBy: actor.name,
        archivedByAccountId: actor.id,
        archiveReason: reason,
        updatedAt: now,
      }
      : {
        ...item,
        archivedAt: "",
        archivedBy: "",
        archivedByAccountId: "",
        archiveReason: "",
        updatedAt: now,
      };
    const parsed = parseBusinessState({
      ...current.state,
      workflowItems: current.state.workflowItems.map((entry, itemIndex) => (
        itemIndex === index ? next : entry
      )),
    });
    if (!parsed.success) throw new RepositoryError(400, "INVALID_WORKFLOW_ITEM", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: archived ? "WORKFLOW_ITEM_ARCHIVE" : "WORKFLOW_ITEM_RESTORE",
      entityType: "workflow_item",
      entityId: itemId,
      details: { before: item, after: next, reason, actorAccountId: actor.id },
    });
    return { item: next, revision };
  }

  patchMeeting(meetingId, patch, actor, audit = {}) {
    actor = this.#freshActor(actor);
    assertAllowedFields(
      patch,
      actor.systemRole === "admin" ? ADMIN_MEETING_FIELDS : MEMBER_MEETING_FIELDS,
    );
    const current = this.readBusinessState();
    const index = current.state.meetings.findIndex(({ id }) => id === meetingId);
    if (index < 0) throw new RepositoryError(404, "MEETING_NOT_FOUND", "会议不存在");
    const meeting = current.state.meetings[index];
    if (actor.systemRole !== "admin" && meeting.ownerAccountId !== actor.id) {
      throw new RepositoryError(403, "MEETING_NOT_ASSIGNED", "只能维护分配给自己的阶段会议");
    }
    const project = current.state.projects.find(({ id }) => id === meeting.projectId);
    const product = project?.products.find(({ id }) => id === meeting.productId);
    const phase = product?.phases.find(({ id }) => id === meeting.phaseId);
    if (!project || !product || !phase) throw new RepositoryError(404, "MEETING_SCOPE_NOT_FOUND", "会议所属阶段不存在");
    if (project.status === PROJECT_STATUS.COMPLETED || product.workflowStatus !== PRODUCT_WORKFLOW_STATUS.ACTIVE) {
      throw new RepositoryError(409, "WORKFLOW_CLOSED", "产品流程已结束，不能修改会议");
    }
    const now = isoNow(this.clock);
    const nextStatus = String(patch?.status ?? meeting.status);
    if (!Object.values(MEETING_STATUS).includes(nextStatus)) {
      throw new RepositoryError(400, "INVALID_MEETING_STATUS", "会议状态无效");
    }
    if (meeting.type === MEETING_TYPE.GATE_REVIEW && nextStatus === MEETING_STATUS.COMPLETED) {
      const gate = getStageGateResult(product, phase, current.state.workflowItems, current.state.meetings);
      if (!gate.kickoffComplete) throw new RepositoryError(409, "KICKOFF_REQUIRED", "请先完成阶段前启动会");
      if (!gate.contentReady) {
        throw new RepositoryError(
          409,
          "STAGE_CONTENT_INCOMPLETE",
          phase.type === "MP" ? "MP关键任务或产品交付文件尚未全部完成" : "阶段关键任务尚未全部完成",
        );
      }
    }
    const next = {
      ...meeting,
      ...patch,
      id: meeting.id,
      status: nextStatus,
      subject: String(patch?.subject ?? meeting.subject).trim(),
      scheduledAt: String(patch?.scheduledAt ?? meeting.scheduledAt),
      heldAt: String(patch?.heldAt ?? meeting.heldAt),
      attendees: Array.isArray(patch?.attendees)
        ? [...new Set(patch.attendees.map((value) => String(value).trim()).filter(Boolean))]
        : meeting.attendees,
      conclusion: String(patch?.conclusion ?? meeting.conclusion).trim(),
      completedBy: nextStatus === MEETING_STATUS.COMPLETED ? actor.name : "",
      completedByAccountId: nextStatus === MEETING_STATUS.COMPLETED ? actor.id : "",
      completedAt: nextStatus === MEETING_STATUS.COMPLETED ? (meeting.completedAt || now) : "",
      updatedAt: now,
    };
    if (!next.subject) throw new RepositoryError(400, "MEETING_SUBJECT_REQUIRED", "请输入会议主题");
    if (nextStatus === MEETING_STATUS.COMPLETED && !next.heldAt) next.heldAt = dateOnly(now);
    if (Object.hasOwn(patch, "ownerAccountId")) {
      const owner = patch.ownerAccountId ? this.getAccount(patch.ownerAccountId) : null;
      if (patch.ownerAccountId && (!owner || !owner.active)) {
        throw new RepositoryError(409, "INVALID_OWNER", "会议负责人账号不存在或已停用");
      }
      next.ownerAccountId = owner?.id ?? "";
    }
    let projects = current.state.projects;
    if (meeting.type === MEETING_TYPE.KICKOFF) {
      projects = current.state.projects.map((entry) => entry.id !== project.id ? entry : {
        ...entry,
        products: entry.products.map((productEntry) => productEntry.id !== product.id ? productEntry : {
          ...productEntry,
          phases: productEntry.phases.map((phaseEntry) => phaseEntry.id !== phase.id ? phaseEntry : {
            ...phaseEntry,
            lifecycle: nextStatus === MEETING_STATUS.COMPLETED
              ? PHASE_LIFECYCLE.ACTIVE
              : PHASE_LIFECYCLE.PENDING_KICKOFF,
            startedAt: nextStatus === MEETING_STATUS.COMPLETED ? (phaseEntry.startedAt || now) : "",
          }),
        }),
      }).map((entry) => ({ ...entry, phases: entry.products[0]?.phases ?? [] }));
    }
    const parsed = parseBusinessState({
      ...current.state,
      projects,
      meetings: current.state.meetings.map((entry, meetingIndex) => (
        meetingIndex === index ? next : entry
      )),
    });
    if (!parsed.success) throw new RepositoryError(400, "INVALID_MEETING", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "MEETING_UPDATE",
      entityType: "meeting",
      entityId: meetingId,
      details: { before: meeting, after: next, actorAccountId: actor.id },
    });
    const nextProject = parsed.data.projects.find(({ id }) => id === project.id);
    return { meeting: next, project: nextProject, revision };
  }

  transitionStage(projectId, productId, phaseId, input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const project = current.state.projects.find(({ id }) => id === projectId);
    if (!project) throw new RepositoryError(404, "PROJECT_NOT_FOUND", "项目不存在");
    const product = project.products.find(({ id }) => id === productId);
    if (!product) throw new RepositoryError(404, "PRODUCT_NOT_FOUND", "产品不存在");
    const phase = product.phases.find(({ id }) => id === phaseId);
    if (!phase) throw new RepositoryError(404, "STAGE_NOT_FOUND", "阶段不存在");
    if (getCurrentStandardPhase(product)?.id !== phaseId) {
      throw new RepositoryError(409, "STAGE_NOT_CURRENT", "只能推进产品当前阶段");
    }
    const action = String(input?.action || "");
    if (!["advance", "complete_product"].includes(action)) {
      throw new RepositoryError(400, "INVALID_STAGE_ACTION", "阶段推进操作无效");
    }
    const note = String(input?.note || "").trim();
    if (!note) throw new RepositoryError(400, "TRANSITION_NOTE_REQUIRED", "请填写阶段评审结论");
    const gate = getStageGateResult(product, phase, current.state.workflowItems, current.state.meetings);
    if (!gate.readyForTransition) {
      throw new RepositoryError(409, "STAGE_GATE_NOT_READY", "请先完成启动会、阶段门内容和阶段后评审会");
    }
    const now = isoNow(this.clock);
    let nextPhase = null;
    const standardPhases = product.phases
      .filter(({ type }) => STANDARD_STAGE_TYPES.includes(type))
      .toSorted((left, right) => STANDARD_STAGE_TYPES.indexOf(left.type) - STANDARD_STAGE_TYPES.indexOf(right.type));
    const phaseIndex = standardPhases.findIndex(({ id }) => id === phaseId);
    const configuredNextPhase = standardPhases[phaseIndex + 1] ?? null;
    let nextProduct = {
      ...product,
      phases: product.phases.map((entry) => entry.id === phaseId ? {
        ...entry,
        lifecycle: PHASE_LIFECYCLE.COMPLETED,
        completedAt: now,
        completedBy: actor.name,
        completedByAccountId: actor.id,
        completionNote: note,
      } : entry),
    };

    if (action === "advance") {
      const nextType = configuredNextPhase?.type ?? getNextStandardStageType(product);
      if (!nextType) throw new RepositoryError(409, "FINAL_STAGE", "MP 已是最终阶段，请完成产品流程");
      if (configuredNextPhase) {
        nextPhase = nextProduct.phases.find(({ id }) => id === configuredNextPhase.id);
      } else {
        const requestedQuantity = Number(input?.quantity);
        const quantity = Number.isInteger(requestedQuantity) && requestedQuantity > 0
          ? requestedQuantity
          : ({ P: 5, EB: 30, PP: 100, MP: 200 }[nextType] ?? 1);
        const sourceDate = new Date(`${String(phase.planDate || dateOnly(now)).slice(0, 10)}T00:00:00.000Z`);
        sourceDate.setUTCDate(sourceDate.getUTCDate() + 30);
        nextPhase = {
          id: `phase-${randomBytes(12).toString("hex")}`,
          type: nextType,
          label: STAGE_TEMPLATES[nextType].label,
          planDate: String(input?.planDate || sourceDate.toISOString().slice(0, 10)).slice(0, 64),
          quantity,
          lifecycle: PHASE_LIFECYCLE.PENDING_KICKOFF,
          startedAt: "",
          completedAt: "",
          completedBy: "",
          completedByAccountId: "",
          completionNote: "",
        };
        nextProduct = { ...nextProduct, phases: [...nextProduct.phases, nextPhase] };
      }
    } else {
      nextProduct = {
        ...nextProduct,
        workflowStatus: PRODUCT_WORKFLOW_STATUS.COMPLETED,
        terminalStageType: phase.type,
        workflowCompletedAt: now,
        workflowCompletedBy: actor.name,
        workflowCompletedByAccountId: actor.id,
        workflowCompletionNote: note,
      };
    }

    let nextProjects = current.state.projects.map((entry) => {
      if (entry.id !== projectId) return entry;
      const products = entry.products.map((productEntry) => productEntry.id === productId
        ? nextProduct
        : productEntry);
      return { ...entry, products, phases: products[0]?.phases ?? [] };
    });
    const ensured = ensureWorkflowState(nextProjects, current.state.workflowItems, current.state.meetings);
    nextProjects = ensured.projects;
    let workflowItems = ensured.workflowItems;
    if (action === "complete_product" && phase.type !== "MP") {
      workflowItems = workflowItems.map((item) => (
        item.productId === productId
        && item.kind === "deliverable"
        && !item.archivedAt
        && item.status !== TASK_STATUS.DONE
          ? {
            ...item,
            status: TASK_STATUS.NA,
            notes: `${item.notes ? `${item.notes}\n` : ""}产品于 ${phase.type} 阶段结束：${note}`.slice(0, 10_000),
            updatedAt: now,
          }
          : item
      ));
    }
    const parsed = parseBusinessState({
      ...current.state,
      projects: nextProjects,
      workflowItems,
      meetings: ensured.meetings,
    });
    if (!parsed.success) throw new RepositoryError(400, "INVALID_STAGE_TRANSITION", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: action === "advance" ? "STAGE_ADVANCE" : "PRODUCT_WORKFLOW_COMPLETE",
      entityType: action === "advance" ? "stage" : "product",
      entityId: action === "advance" ? phaseId : productId,
      details: { projectId, productId, phaseId, nextPhase, note, actorAccountId: actor.id },
    });
    const updatedProject = parsed.data.projects.find(({ id }) => id === projectId);
    const updatedProduct = updatedProject.products.find(({ id }) => id === productId);
    return {
      project: updatedProject,
      product: updatedProduct,
      phase: updatedProduct.phases.find(({ id }) => id === phaseId),
      nextPhase: nextPhase ? updatedProduct.phases.find(({ id }) => id === nextPhase.id) : null,
      revision,
    };
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

  bulkReadyBom(input, expectedRevision, actor, audit = {}) {
    actor = this.#freshActor(actor, { admin: true });
    const current = this.readBusinessState();
    if (Number(expectedRevision) !== current.revision) {
      throw new RepositoryError(409, "REVISION_CONFLICT", "共享数据已被其他用户更新，请刷新后重试");
    }
    const projectId = String(input?.projectId || "");
    const productId = String(input?.productId || "");
    const phaseId = String(input?.phaseId || "");
    const requestedIds = Array.isArray(input?.itemIds)
      ? new Set(input.itemIds.map((id) => String(id)))
      : null;
    const scoped = current.state.bomItems.filter((item) => (
      item.projectId === projectId
      && item.productId === productId
      && item.phaseId === phaseId
      && (!requestedIds || requestedIds.has(item.id))
      && ![BOM_STATUS.NA, BOM_STATUS.REMOVED, BOM_STATUS.READY].includes(item.status)
    ));
    if (!scoped.length) {
      throw new RepositoryError(400, "NO_BOM_ITEMS_TO_COMPLETE", "当前范围没有需要确认完成的材料");
    }
    if (requestedIds && scoped.length !== requestedIds.size) {
      throw new RepositoryError(409, "BOM_SCOPE_MISMATCH", "部分材料不属于当前阶段或不可批量完成");
    }
    const ids = new Set(scoped.map(({ id }) => id));
    const parentMaterialIds = new Set(scoped.map(({ parentMaterialId }) => parentMaterialId));
    const shortageCount = scoped.filter(({ status }) => status === BOM_STATUS.SHORTAGE).length;
    const now = isoNow(this.clock);
    const nextState = {
      ...current.state,
      tasks: [...current.state.tasks],
      bomItems: current.state.bomItems.map((item) => ids.has(item.id) ? {
        ...item,
        status: BOM_STATUS.READY,
        confirmedBy: actor.name,
        confirmedByAccountId: actor.id,
        confirmedAt: now,
        updatedAt: now,
      } : item),
    };
    parentMaterialIds.forEach((parentMaterialId) => syncMaterialReadinessTask(nextState, parentMaterialId, now));
    const parsed = parseBusinessState(nextState);
    if (!parsed.success) throw new RepositoryError(400, "INVALID_BOM_BULK_READY", parsed.error);
    const revision = this.#writeEntityState(parsed.data, current.revision, {
      ...audit,
      action: "BOM_BULK_READY",
      entityType: "bom_item",
      entityId: [...ids].join(","),
      details: { projectId, productId, phaseId, count: ids.size, shortageCount, actorAccountId: actor.id },
    });
    return { count: ids.size, shortageCount, revision };
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
