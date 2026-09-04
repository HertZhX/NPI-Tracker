import { describe, expect, it } from "vitest";
import {
  accountAssignmentPatch,
  createDefaultAccounts,
  findAccountForAssignment,
  isAssignedToAccount,
  normalizeUsername,
} from "./accounts.js";

describe("账号与责任人映射", () => {
  it("优先按稳定账号 ID 匹配，显示姓名重复时不猜测", () => {
    const accounts = [
      { id: "account-a", name: "李芳", username: "lifang-a" },
      { id: "account-b", name: "李芳", username: "lifang-b" },
    ];

    expect(findAccountForAssignment({ ownerAccountId: "account-b", owner: "旧姓名" }, accounts))
      .toBe(accounts[1]);
    expect(findAccountForAssignment({ owner: "李芳" }, accounts)).toBeNull();
  });

  it("兼容旧数据中的唯一姓名，并生成完整责任人补丁", () => {
    const accounts = createDefaultAccounts();
    const account = findAccountForAssignment({ owner: "孙洁" }, accounts);

    expect(account?.id).toBe("account-sunjie");
    expect(isAssignedToAccount({ owner: "孙洁" }, account, accounts)).toBe(true);
    expect(accountAssignmentPatch(account)).toEqual({
      ownerAccountId: "account-sunjie",
      owner: "孙洁",
      ownerRole: "PUR",
    });
    expect(normalizeUsername("  SunJie ")).toBe("sunjie");
  });
});
