import { describe, expect, it } from "vitest";

import { urlBase64ToUint8Array } from "./vapid-key";

describe("urlBase64ToUint8Array", () => {
  it("把 URL 安全的 base64 还原成字节，兼容缺省的填充", () => {
    // "hello?>" 的标准 base64 是 aGVsbG8/Pg==，URL 安全写法把 / 换成 _，并去掉 =
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8_Pg"))).toEqual(
      Array.from(new TextEncoder().encode("hello?>")),
    );
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([0xfb, 0xff]);
  });
});
