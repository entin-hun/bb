import { describe, expect, it } from "vitest";
import { canManageThreadSharing } from "./thread-access-queries";

describe("canManageThreadSharing", () => {
  it.each([
    ["owner", true],
    ["maintainer", true],
    ["member", false],
    ["viewer", false],
    [null, true],
    [undefined, false],
  ] as const)("maps %s to %s", (role, expected) => {
    expect(canManageThreadSharing(role)).toBe(expected);
  });
});
