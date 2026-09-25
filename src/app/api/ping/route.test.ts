import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/ping", () => {
  it("返回没有内容的 204，并禁止缓存", async () => {
    const response = GET();

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});
