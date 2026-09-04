import { afterEach, describe, expect, it, vi } from "vitest";
import { npiApi } from "./api.js";

afterEach(() => {
  npiApi.clearSession();
  vi.unstubAllGlobals();
});

describe("npiApi.deleteProject", () => {
  it("sends the project id and expected revision to the admin delete endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ project: { id: "project/测试" }, revision: 8 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await npiApi.deleteProject("project/测试", 7);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/projects/project%2F%E6%B5%8B%E8%AF%95",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
        body: JSON.stringify({ expectedRevision: 7 }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-NPI-Request": "1",
        }),
      }),
    );
  });

  it("sends project and product ids to the product delete endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ product: { id: "product/测试" }, revision: 9 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await npiApi.deleteProduct("project/测试", "product/测试", 8);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/projects/project%2F%E6%B5%8B%E8%AF%95/products/product%2F%E6%B5%8B%E8%AF%95",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
        body: JSON.stringify({ expectedRevision: 8 }),
      }),
    );
  });
});
