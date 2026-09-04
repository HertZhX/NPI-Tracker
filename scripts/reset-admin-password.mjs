import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUsername } from "../src/domain/accounts.js";
import { NpiRepository } from "../server/repository.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolve(
  process.env.NPI_DB_PATH || resolve(rootDirectory, "server-data", "npi-tracker.sqlite"),
);
const configuredUsername = normalizeUsername(process.env.NPI_ADMIN_USERNAME || "");
const candidateUsernames = configuredUsername ? [configuredUsername] : ["admin", "zhangmin"];
const repository = await NpiRepository.open({ dbPath });

try {
  const accounts = repository.getAccounts();
  const candidates = candidateUsernames
    .map((username) => accounts.find((entry) => entry.username === username))
    .filter(Boolean);
  const account = candidates.find((entry) => entry.active && entry.systemRole === "admin");
  if (!account) {
    if (!candidates.length) throw new Error(`找不到管理员账号：${candidateUsernames.join(" 或 ")}`);
    throw new Error(`账号 ${candidates[0].username} 不是启用状态的管理员`);
  }

  const result = await repository.resetPassword(account.id, {
    actorAccountId: account.id,
    actionSource: "local_admin_recovery",
    requestId: `cli-reset-${Date.now()}`,
  });
  console.log("\n管理员密码已重置（临时密码仅显示本次）：");
  console.log(`账号：${result.account.username}`);
  console.log(`临时密码：${result.initialPassword}`);
  console.log("请立即登录并按提示设置新密码。\n");
} finally {
  repository.close();
}
