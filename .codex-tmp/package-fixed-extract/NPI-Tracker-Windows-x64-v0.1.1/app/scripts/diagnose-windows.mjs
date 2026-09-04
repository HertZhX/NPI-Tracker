import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, platform, release } from "node:os";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectory = resolve(appDirectory, "..");
const host = String(process.env.HOST || process.env.NPI_HOST || "0.0.0.0");
const port = Number(process.env.PORT || process.env.NPI_PORT || 4173);
const dbPath = resolve(
  process.env.NPI_DB_PATH || resolve(packageDirectory, "data", "npi-tracker.sqlite"),
);
const checks = [];

async function check(label, operation) {
  try {
    await operation();
    checks.push({ label, ok: true });
  } catch (error) {
    checks.push({ label, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await check("Node.js version and architecture", async () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22 || process.arch !== "x64" || process.platform !== "win32") {
    throw new Error(`requires Windows x64 with Node.js 22+, found ${process.platform} ${process.arch} ${process.version}`);
  }
});

await check("Application files", async () => {
  for (const filePath of [
    resolve(appDirectory, "server", "index.mjs"),
    resolve(appDirectory, "dist", "index.html"),
  ]) {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`missing file: ${filePath}`);
  }
  await import("../server/state-schema.mjs");
});

await check("SQLite runtime", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE smoke_test (id INTEGER PRIMARY KEY)");
  } finally {
    database.close();
  }
});

await check("Data directory write access", async () => {
  const dataDirectory = dirname(dbPath);
  const probePath = resolve(dataDirectory, `.npi-write-test-${process.pid}`);
  await mkdir(dataDirectory, { recursive: true });
  try {
    await writeFile(probePath, "ok", "utf8");
  } finally {
    await rm(probePath, { force: true });
  }
});

await check(`Listen address ${host}:${port}`, async () => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("port must be an integer from 1 through 65535");
  }
  await new Promise((resolveCheck, rejectCheck) => {
    const server = createServer();
    server.once("error", rejectCheck);
    server.listen(port, host, () => server.close(resolveCheck));
  });
});

console.log("NPI Tracker Windows diagnostics");
console.log(`OS: ${platform()} ${release()} ${arch()}`);
console.log(`Node.js: ${process.version} ${process.arch}`);
console.log(`Package: ${packageDirectory}`);
console.log(`Database: ${dbPath}`);
console.log("");
for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.error ? `: ${item.error}` : ""}`);
}

if (checks.some(({ ok }) => !ok)) process.exitCode = 1;
