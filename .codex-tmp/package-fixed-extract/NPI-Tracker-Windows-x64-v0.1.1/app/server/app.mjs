import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { normalizeUsername } from "../src/domain/accounts.js";
import { RepositoryError } from "./repository.mjs";
import {
  clearSessionCookie,
  parseCookies,
  safeTokenEqual,
  sessionCookie,
} from "./security.mjs";

const JSON_LIMIT_BYTES = 3 * 1024 * 1024;
const QUOTATION_JSON_LIMIT_BYTES = 15 * 1024 * 1024;
const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requestIp(request) {
  return request.socket.remoteAddress || "";
}

function requestContext(request, actorAccountId = null) {
  return {
    actorAccountId,
    requestId: request.requestId,
    ipAddress: requestIp(request),
  };
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request, limitBytes = JSON_LIMIT_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "请求数据过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求不是有效的 JSON");
  }
}

function createLoginLimiter(clock, { maxAttempts, maxEntries = 5_000 }) {
  const attempts = new Map();
  const windowMs = 15 * 60 * 1000;

  function recentAttempts(key, now) {
    for (const [storedKey, timestamps] of attempts) {
      const recent = timestamps.filter((time) => now - time < windowMs);
      if (recent.length) attempts.set(storedKey, recent);
      else attempts.delete(storedKey);
    }
    while (attempts.size >= maxEntries) {
      attempts.delete(attempts.keys().next().value);
    }
    return attempts.get(key) ?? [];
  }

  return {
    assertAllowed(key) {
      const now = new Date(clock()).getTime();
      const recent = recentAttempts(key, now);
      attempts.set(key, recent);
      if (recent.length >= maxAttempts) {
        throw new HttpError(429, "LOGIN_RATE_LIMIT", "登录尝试过多，请稍后再试");
      }
    },
    fail(key) {
      const now = new Date(clock()).getTime();
      attempts.set(key, [...recentAttempts(key, now), now]);
    },
    success(key) {
      attempts.delete(key);
    },
  };
}

export function createNpiServer({
  repository,
  staticDir = "",
  allowedOrigins = ["http://127.0.0.1:4173", "http://localhost:4173"],
  clock = () => new Date(),
  secureCookies = false,
} = {}) {
  if (!repository) throw new Error("createNpiServer requires repository");
  const accountLoginLimiter = createLoginLimiter(clock, { maxAttempts: 5 });
  const ipLoginLimiter = createLoginLimiter(clock, { maxAttempts: 30 });
  const allowedOriginSet = new Set(allowedOrigins);
  const staticRoot = staticDir ? resolve(staticDir) : "";

  function applySecurityHeaders(response) {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (secureCookies) {
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  }

  function validateOrigin(request) {
    const origin = request.headers.origin;
    const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();
    const protocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
    const sameOrigin = request.headers.host ? `${protocol}://${request.headers.host}` : "";
    if (origin && origin !== sameOrigin && !allowedOriginSet.has(origin)) {
      throw new HttpError(403, "ORIGIN_REJECTED", "请求来源不受信任");
    }
  }

  function validateRequestedWith(request) {
    if (request.headers["x-npi-request"] !== "1") {
      throw new HttpError(403, "REQUEST_HEADER_REQUIRED", "请求缺少安全标记");
    }
  }

  function getSession(request) {
    const token = parseCookies(request.headers.cookie).npi_session || "";
    const session = repository.authenticate(token);
    return session ? { ...session, token } : null;
  }

  function requireSession(request, { allowPasswordChange = false } = {}) {
    const session = getSession(request);
    if (!session) throw new HttpError(401, "AUTH_REQUIRED", "请先登录");
    if (session.account.mustChangePassword && !allowPasswordChange) {
      throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED", "首次登录必须先修改密码");
    }
    return session;
  }

  function requireAdmin(session) {
    if (session.account.systemRole !== "admin") {
      throw new HttpError(403, "FORBIDDEN", "只有管理员可以执行此操作");
    }
  }

  function validateCsrf(request, session) {
    validateOrigin(request);
    validateRequestedWith(request);
    if (!safeTokenEqual(request.headers["x-csrf-token"], session.csrfToken)) {
      throw new HttpError(403, "CSRF_REJECTED", "安全令牌无效，请刷新后重试");
    }
  }

  async function serveStatic(pathname, response) {
    if (!staticRoot) return false;
    const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    let filePath = resolve(staticRoot, relative);
    if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) return false;
    try {
      const metadata = await stat(filePath);
      if (metadata.isDirectory()) filePath = resolve(filePath, "index.html");
      const content = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      });
      response.end(content);
      return true;
    } catch {
      if (extname(pathname)) return false;
      try {
        const content = await readFile(resolve(staticRoot, "index.html"));
        response.writeHead(200, { "Content-Type": MIME_TYPES[".html"], "Cache-Control": "no-cache" });
        response.end(content);
        return true;
      } catch {
        return false;
      }
    }
  }

  const server = createServer(async (request, response) => {
    request.requestId = randomBytes(10).toString("hex");
    response.setHeader("X-Request-Id", request.requestId);
    applySecurityHeaders(response);
    let session = null;

    try {
      const url = new URL(request.url, "http://npi.local");
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && pathname === "/api/auth/login") {
        validateOrigin(request);
        validateRequestedWith(request);
        const body = await readJson(request);
        const ipKey = requestIp(request) || "unknown";
        ipLoginLimiter.assertAllowed(ipKey);
        const username = normalizeUsername(body.username);
        const password = typeof body.password === "string" ? body.password : "";
        if (!/^[a-z0-9._-]{3,40}$/.test(username) || !password || password.length > 128) {
          ipLoginLimiter.fail(ipKey);
          throw new HttpError(401, "INVALID_CREDENTIALS", "账号或密码错误");
        }
        const key = `${ipKey}:${username}`;
        accountLoginLimiter.assertAllowed(key);
        const existingToken = parseCookies(request.headers.cookie).npi_session || "";
        if (existingToken) repository.revokeSession(existingToken);
        const account = await repository.verifyCredentials(username, password);
        if (!account) {
          accountLoginLimiter.fail(key);
          ipLoginLimiter.fail(ipKey);
          repository.recordAudit({
            ...requestContext(request),
            action: "LOGIN",
            entityType: "account",
            entityId: username,
            result: "DENIED",
            details: { reason: "INVALID_CREDENTIALS" },
          });
          throw new HttpError(401, "INVALID_CREDENTIALS", "账号或密码错误");
        }
        accountLoginLimiter.success(key);
        const created = repository.createSession(account.id, {
          ipAddress: requestIp(request),
          userAgent: request.headers["user-agent"],
        });
        repository.recordAudit({
          ...requestContext(request, account.id),
          action: "LOGIN",
          entityType: "account",
          entityId: account.id,
          details: { username: account.username },
        });
        sendJson(response, 200, {
          account,
          csrfToken: created.csrfToken,
          expiresAt: created.expiresAt,
        }, {
          "Set-Cookie": sessionCookie(created.token, { secure: secureCookies }),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/auth/me") {
        session = requireSession(request, { allowPasswordChange: true });
        sendJson(response, 200, {
          account: session.account,
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/auth/logout") {
        session = requireSession(request, { allowPasswordChange: true });
        validateCsrf(request, session);
        repository.revokeSession(session.token);
        repository.recordAudit({
          ...requestContext(request, session.account.id),
          action: "LOGOUT",
          entityType: "account",
          entityId: session.account.id,
          details: {},
        });
        sendJson(response, 200, { ok: true }, {
          "Set-Cookie": clearSessionCookie({ secure: secureCookies }),
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/auth/change-password") {
        session = requireSession(request, { allowPasswordChange: true });
        validateCsrf(request, session);
        const body = await readJson(request);
        const account = await repository.changePassword(
          session.account.id,
          body.currentPassword,
          body.newPassword,
          requestContext(request, session.account.id),
        );
        const created = repository.createSession(account.id, {
          ipAddress: requestIp(request),
          userAgent: request.headers["user-agent"],
        });
        sendJson(response, 200, {
          account,
          csrfToken: created.csrfToken,
          expiresAt: created.expiresAt,
        }, {
          "Set-Cookie": sessionCookie(created.token, { secure: secureCookies }),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/state") {
        session = requireSession(request);
        sendJson(response, 200, repository.getScopedState(session.account));
        return;
      }

      if (request.method === "PUT" && pathname === "/api/admin/state") {
        session = requireSession(request);
        requireAdmin(session);
        validateCsrf(request, session);
        const body = await readJson(request);
        const result = repository.replaceBusinessState(
          body.state,
          body.expectedRevision,
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, result);
        return;
      }

      const projectMatch = pathname.match(/^\/api\/admin\/projects\/([^/]+)$/);
      if (request.method === "DELETE" && projectMatch) {
        session = requireSession(request);
        requireAdmin(session);
        validateCsrf(request, session);
        const body = await readJson(request);
        const result = repository.deleteProject(
          decodeURIComponent(projectMatch[1]),
          body.expectedRevision,
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/accounts") {
        session = requireSession(request);
        requireAdmin(session);
        validateCsrf(request, session);
        const body = await readJson(request);
        const result = await repository.createAccount(body, requestContext(request, session.account.id));
        sendJson(response, 201, result);
        return;
      }

      const accountMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/);
      if (request.method === "PATCH" && accountMatch) {
        session = requireSession(request);
        requireAdmin(session);
        validateCsrf(request, session);
        const body = await readJson(request);
        const account = repository.updateAccount(
          decodeURIComponent(accountMatch[1]),
          body,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "DELETE" && accountMatch) {
        session = requireSession(request);
        requireAdmin(session);
        validateCsrf(request, session);
        const account = repository.deleteAccount(
          decodeURIComponent(accountMatch[1]),
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, { account });
        return;
      }

      const resetPasswordMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/reset-password$/);
      if (request.method === "POST" && resetPasswordMatch) {
        session = requireSession(request);
        requireAdmin(session);
        validateCsrf(request, session);
        const result = await repository.resetPassword(
          decodeURIComponent(resetPasswordMatch[1]),
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, result);
        return;
      }

      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (request.method === "PATCH" && taskMatch) {
        session = requireSession(request);
        validateCsrf(request, session);
        const body = await readJson(request);
        const result = repository.patchTask(
          decodeURIComponent(taskMatch[1]),
          body,
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, result);
        return;
      }

      const workflowItemMatch = pathname.match(/^\/api\/workflow-items\/([^/]+)$/);
      if (request.method === "PATCH" && workflowItemMatch) {
        session = requireSession(request);
        validateCsrf(request, session);
        const body = await readJson(request);
        const result = repository.patchWorkflowItem(
          decodeURIComponent(workflowItemMatch[1]),
          body,
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, result);
        return;
      }

      const bomMatch = pathname.match(/^\/api\/bom-items\/([^/]+)$/);
      if (request.method === "PATCH" && bomMatch) {
        session = requireSession(request);
        validateCsrf(request, session);
        const body = await readJson(request);
        const result = repository.patchBomItem(
          decodeURIComponent(bomMatch[1]),
          body,
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/quotations") {
        session = requireSession(request);
        validateCsrf(request, session);
        const body = await readJson(request, QUOTATION_JSON_LIMIT_BYTES);
        const quotation = repository.createQuotation(
          body,
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 201, { quotation });
        return;
      }

      const quotationDownloadMatch = pathname.match(/^\/api\/quotations\/([^/]+)\/download$/);
      if (request.method === "GET" && quotationDownloadMatch) {
        session = requireSession(request);
        const result = repository.getQuotationFile(
          decodeURIComponent(quotationDownloadMatch[1]),
          session.account,
        );
        const fallbackName = result.quotation.fileName
          .replace(/[^\x20-\x7E]/g, "_")
          .replace(/["\\]/g, "_");
        response.writeHead(200, {
          "Content-Type": result.quotation.mimeType || "application/octet-stream",
          "Content-Length": result.content.length,
          "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(result.quotation.fileName)}`,
          "Cache-Control": "no-store",
        });
        response.end(result.content);
        return;
      }

      const quotationMatch = pathname.match(/^\/api\/quotations\/([^/]+)$/);
      if (request.method === "DELETE" && quotationMatch) {
        session = requireSession(request);
        validateCsrf(request, session);
        const quotation = repository.deleteQuotation(
          decodeURIComponent(quotationMatch[1]),
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, { quotation });
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/bom-items/bulk-assign") {
        session = requireSession(request);
        requireAdmin(session);
        validateCsrf(request, session);
        const body = await readJson(request);
        const result = repository.bulkAssignBom(
          body.itemIds,
          body.accountId || null,
          session.account,
          requestContext(request, session.account.id),
        );
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/audit") {
        session = requireSession(request);
        requireAdmin(session);
        sendJson(response, 200, { entries: repository.getAuditLog(url.searchParams.get("limit")) });
        return;
      }

      if (pathname.startsWith("/api/")) {
        throw new HttpError(404, "NOT_FOUND", "接口不存在");
      }

      if (request.method === "GET" && await serveStatic(pathname, response)) return;
      throw new HttpError(404, "NOT_FOUND", "页面不存在");
    } catch (error) {
      const status = error instanceof HttpError || error instanceof RepositoryError
        ? error.status
        : 500;
      const code = error instanceof HttpError || error instanceof RepositoryError
        ? error.code
        : "INTERNAL_ERROR";
      if (status === 403 && session?.account) {
        repository.recordAudit({
          ...requestContext(request, session.account.id),
          action: "AUTHORIZATION",
          entityType: "request",
          entityId: request.url,
          result: "DENIED",
          details: { method: request.method, code },
        });
      }
      if (status >= 500) console.error(`[${request.requestId}]`, error);
      sendJson(response, status, {
        error: {
          code,
          message: status >= 500 ? "服务器处理失败，请联系管理员" : error.message,
          requestId: request.requestId,
        },
      }, status === 401 ? {
        "Set-Cookie": clearSessionCookie({ secure: secureCookies }),
      } : {});
    }
  });

  return server;
}
