// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SafeMessageText } from "./safe-message-text";

afterEach(cleanup);

describe("safe message text", () => {
  it("renders HTML and script URLs as text while linking HTTP(S) safely", () => {
    const { container } = render(
      <SafeMessageText text={'<img src=x onerror=alert(1)> javascript:alert(1) https://example.com/a?q=1'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByRole("link", { name: "https://example.com/a?q=1" }))
      .toMatchObject({
        target: "_blank",
        rel: "noopener noreferrer",
      });
  });
});
