import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(await readFile(join(rootDirectory, "package.json"), "utf8"));
const packageName = `NPI-Tracker-Windows-x64-v${packageMetadata.version}`;
const releaseDirectory = join(rootDirectory, "release");
const packageDirectory = join(releaseDirectory, packageName);
let zipPath = join(releaseDirectory, `${packageName}.zip`);
let checksumPath = `${zipPath}.sha256`;

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Windows 便携包必须在 Windows x64 环境中生成");
}
if (dirname(packageDirectory) !== releaseDirectory) {
  throw new Error("发布目录校验失败");
}

async function ensureFile(filePath, label) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`缺少${label}：${relative(rootDirectory, filePath)}`);
}

async function copyRuntimeFile(sourcePath, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function sha256(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

await ensureFile(join(rootDirectory, "dist", "index.html"), "前端构建产物");
await ensureFile(process.execPath, "Node.js 运行时");
await ensureFile(join(rootDirectory, "node_modules", "zod", "package.json"), "Zod 运行依赖");

await mkdir(releaseDirectory, { recursive: true });
await rm(packageDirectory, { recursive: true, force: true });
try {
  await rm(zipPath, { force: true });
  await rm(checksumPath, { force: true });
} catch (error) {
  if (!["EBUSY", "EPERM"].includes(error?.code)) throw error;
  const buildStamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
  zipPath = join(releaseDirectory, `${packageName}-${buildStamp}.zip`);
  checksumPath = `${zipPath}.sha256`;
  console.warn(`原发布包正被占用，改为生成：${relative(rootDirectory, zipPath)}`);
}

await mkdir(packageDirectory, { recursive: true });
await cp(join(rootDirectory, "dist"), join(packageDirectory, "app", "dist"), { recursive: true });
await cp(
  join(rootDirectory, "node_modules", "zod"),
  join(packageDirectory, "app", "node_modules", "zod"),
  { recursive: true },
);

const runtimeFiles = [
  "server/app.mjs",
  "server/index.mjs",
  "server/repository.mjs",
  "server/security.mjs",
  "server/state-schema.mjs",
  "scripts/reset-admin-password.mjs",
  "scripts/diagnose-windows.mjs",
  "src/data/seed.js",
  "src/domain/accounts.js",
  "src/domain/bom.js",
  "src/domain/productFiles.js",
  "src/domain/projects.js",
  "src/domain/statuses.js",
  "src/domain/workflow.js",
];
for (const relativePath of runtimeFiles) {
  await copyRuntimeFile(
    join(rootDirectory, relativePath),
    join(packageDirectory, "app", relativePath),
  );
}

await writeFile(
  join(packageDirectory, "app", "package.json"),
  `${JSON.stringify({ name: packageMetadata.name, version: packageMetadata.version, private: true, type: "module" }, null, 2)}\n`,
  "utf8",
);
await copyRuntimeFile(process.execPath, join(packageDirectory, "runtime", "node.exe"));
await cp(join(rootDirectory, "deployment", "windows"), packageDirectory, { recursive: true });
for (const batchFile of [
  "config.cmd",
  "diagnose-npi.cmd",
  "reset-admin-password.cmd",
  "start-npi.cmd",
]) {
  const batchPath = join(packageDirectory, batchFile);
  const content = await readFile(batchPath, "utf8");
  await writeFile(batchPath, content.replace(/\r?\n/g, "\r\n"), "utf8");
}
await mkdir(join(packageDirectory, "data"), { recursive: true });
await mkdir(join(packageDirectory, "LICENSES"), { recursive: true });
await copyFile(
  join(rootDirectory, "node_modules", "zod", "LICENSE"),
  join(packageDirectory, "LICENSES", "Zod-LICENSE.txt"),
);

const builtAt = new Date().toISOString();
await writeFile(
  join(packageDirectory, "data", "README.txt"),
  "NPI Tracker 数据目录。停止服务后再复制整个目录进行备份；请勿在运行中删除数据库、-wal 或 -shm 文件。\r\n",
  "utf8",
);
await writeFile(
  join(packageDirectory, "LICENSES", "NODE-RUNTIME-NOTICE.txt"),
  [
    `This package bundles Node.js ${process.version} (${process.arch}).`,
    "Node.js is distributed under its own license and third-party notices.",
    `Official release: https://nodejs.org/download/release/${process.version}/`,
    `License: https://github.com/nodejs/node/blob/${process.version}/LICENSE`,
    "",
  ].join("\r\n"),
  "utf8",
);
await writeFile(
  join(packageDirectory, "manifest.json"),
  `${JSON.stringify({
    name: "NPI Tracker Windows Portable",
    appVersion: packageMetadata.version,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    builtAt,
  }, null, 2)}\n`,
  "utf8",
);

const archiveCommand = [
  `Compress-Archive -LiteralPath ${quotePowerShell(packageDirectory)}`,
  `-DestinationPath ${quotePowerShell(zipPath)}`,
  "-CompressionLevel Optimal -Force",
].join(" ");
let archived = spawnSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", archiveCommand],
  { cwd: rootDirectory, stdio: "inherit" },
);
if (archived.status !== 0) {
  console.warn("PowerShell 压缩组件不可用，改用 Windows tar.exe 生成 ZIP。");
  archived = spawnSync(
    "tar.exe",
    ["-a", "-c", "-f", zipPath, "-C", releaseDirectory, packageName],
    { cwd: rootDirectory, stdio: "inherit" },
  );
}
if (archived.status !== 0) throw new Error("Windows ZIP 压缩失败");

const digest = await sha256(zipPath);
await writeFile(checksumPath, `${digest}  ${basename(zipPath)}\n`, "utf8");
const folderSize = (await stat(join(packageDirectory, "runtime", "node.exe"))).size;
const zipSize = (await stat(zipPath)).size;

console.log("\nWindows 便携包已生成：");
console.log(packageDirectory);
console.log(zipPath);
console.log(`SHA-256: ${digest}`);
console.log(`Node runtime: ${(folderSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`ZIP: ${(zipSize / 1024 / 1024).toFixed(1)} MB\n`);
