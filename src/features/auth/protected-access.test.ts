import { describe, expect, it } from "vitest";

import { resolveProtectedAccess } from "./protected-access";

describe("resolveProtectedAccess", () => {
  it("没有成员会话时将受保护路径交给登录页", () => {
    expect(resolveProtectedAccess("/courses", null)).toEqual({
      status: "redirect_to_login",
      nextPath: "/courses",
    });
  });

  it("完整成员会话可以访问受保护路径", () => {
    expect(
      resolveProtectedAccess("/courses", {
        userId: "user-1",
        schoolId: "uw-madison",
      }),
    ).toEqual({ status: "allow" });
  });

  it("不存在的 signup 路径不属于公开白名单", () => {
    expect(resolveProtectedAccess("/signup", null)).toEqual({
      status: "redirect_to_login",
      nextPath: "/signup",
    });
  });

  it.each(["/", "/login"])(
    "没有成员会话也可以访问公开路径 %s",
    (pathname) => {
      expect(resolveProtectedAccess(pathname, null)).toEqual({
        status: "allow",
      });
    },
  );
});
