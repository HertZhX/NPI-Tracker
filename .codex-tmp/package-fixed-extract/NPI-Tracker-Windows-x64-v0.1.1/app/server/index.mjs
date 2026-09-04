import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNpiServer } from "./app.mjs";
import { NpiRepository } from "./repository.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const apiOnly = process.env.NPI_API_ONLY === "1";
const dbPath = resolve(process.env.NPI_DB_PATH || resolve(rootDirectory, "server-data", "npi-tracker.sqlite"));
const secureCookies = process.env.NPI_COOKIE_SECURE === "1";
const configuredOrigins = String(process.env.NPI_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!["127.0.0.1", "localhost", "::1"].includes(host) && !secureCookies) {
  console.warn("\n安全警告：当前服务将监听非本机地址且未启用 Secure Cookie。");
  console.warn("正式局域网使用请通过 IIS/Nginx 提供 HTTPS，并设置 NPI_COOKIE_SECURE=1。\n");
}

await mkdir(dirname(dbPath), { recursive: true });
const repository = await NpiRepository.open({
  dbPath,
  secureCookies,
  bootstrapPassword: process.env.NPI_BOOTSTRAP_PASSWORD || "",
});

if (repository.bootstrapCredentials) {
  console.log("\n首次启动管理员账号（仅显示本次）：");
  console.log(`账号：${repository.bootstrapCredentials.username}`);
  console.log(`初始密码：${repository.bootstrapCredentials.password}`);
  console.log("登录后必须立即修改密码。\n");
}

const server = createNpiServer({
  repository,
  staticDir: apiOnly ? "" : resolve(rootDirectory, "dist"),
  allowedOrigins: [
    ...configuredOrigins,
    `http://${host}:${port}`,
    "http://127.0.0.1:4173",
    "http://localhost:4173",
  ],
  secureCookies,
});

server.listen(port, host, () => {
  console.log(`NPI Tracker 服务已启动：http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
