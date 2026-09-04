export const JOB_ROLE_OPTIONS = Object.freeze([
  "NPI/PM",
  "RD",
  "EE",
  "PE",
  "ME",
  "QE",
  "TE",
  "PUR",
  "SQE",
  "PMC",
  "生产",
]);

export const DEFAULT_ACCOUNTS = Object.freeze([
  { id: "account-zhangwei", username: "zhangwei", name: "张伟", department: "工程部", jobRole: "PE", active: true },
  { id: "account-zhaofeng", username: "zhaofeng", name: "赵峰", department: "工程部", jobRole: "ME", active: true },
  { id: "account-liuting", username: "liuting", name: "刘婷", department: "品质部", jobRole: "QE", active: true },
  { id: "account-sunjie", username: "sunjie", name: "孙洁", department: "采购部", jobRole: "PUR", active: true },
  { id: "account-zhangmin", username: "admin", name: "张敏", department: "项目部", jobRole: "NPI/PM", active: true },
  { id: "account-lichen", username: "lichen", name: "李晨", department: "项目部", jobRole: "NPI/PM", active: true },
]);

export function createDefaultAccounts() {
  return DEFAULT_ACCOUNTS.map((account) => ({ ...account }));
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function findAccountForAssignment(assignment, accounts = []) {
  if (!assignment) return null;
  if (assignment.ownerAccountId) {
    const byId = accounts.find(({ id }) => id === assignment.ownerAccountId);
    if (byId) return byId;
  }
  const ownerName = String(assignment.owner || assignment.manager || "").trim();
  if (!ownerName) return null;
  const matches = accounts.filter(({ name }) => name === ownerName);
  return matches.length === 1 ? matches[0] : null;
}

export function isAssignedToAccount(assignment, account, accounts = []) {
  if (!assignment || !account) return false;
  return findAccountForAssignment(assignment, accounts)?.id === account.id;
}

export function accountAssignmentPatch(account) {
  return account
    ? { ownerAccountId: account.id, owner: account.name, ownerRole: account.jobRole }
    : { ownerAccountId: "", owner: "待分配" };
}

export function accountLabel(account) {
  if (!account) return "未分配";
  return `${account.name} · ${account.jobRole}`;
}
