import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteEntry = resolve(rootDirectory, "node_modules", "vite", "bin", "vite.js");
const childOptions = { cwd: rootDirectory, stdio: "inherit", env: process.env };
const api = spawn(process.execPath, ["server/index.mjs"], {
  ...childOptions,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "4174",
    NPI_API_ONLY: "1",
  },
});
const web = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "4173"], childOptions);

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  process.exitCode = exitCode;
}

api.on("exit", (code) => {
  if (!stopping) stop(code || 1);
});
web.on("exit", (code) => {
  if (!stopping) stop(code || 1);
});
api.on("error", (error) => {
  console.error("API 服务启动失败：", error.message);
  stop(1);
});
web.on("error", (error) => {
  console.error("前端服务启动失败：", error.message);
  stop(1);
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
