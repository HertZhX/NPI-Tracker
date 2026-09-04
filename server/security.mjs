import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function generateTemporaryPassword() {
  return `Npi!${randomBytes(9).toString("base64url")}`;
}

export function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8) return "密码至少需要 8 位";
  if (value.length > 128) return "密码不能超过 128 位";
  return "";
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return [
    "scrypt",
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password, encodedHash) {
  const [algorithm, n, r, p, saltText, hashText] = String(encodedHash || "").split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = await scryptAsync(password, Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function createCsrfToken(secret, sessionToken) {
  return createHmac("sha256", secret).update(sessionToken).digest("base64url");
}

export function safeTokenEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    try {
      return [
        decodeURIComponent(part.slice(0, separator).trim()),
        decodeURIComponent(part.slice(separator + 1).trim()),
      ];
    } catch {
      return ["", ""];
    }
  }).filter(([name]) => name));
}

export function sessionCookie(token, { secure = false, maxAge = 8 * 60 * 60 } = {}) {
  const parts = [
    `npi_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie({ secure = false } = {}) {
  return sessionCookie("", { secure, maxAge: 0 });
}
