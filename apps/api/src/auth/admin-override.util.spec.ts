import { isAdminOverride } from "./admin-override.util";

describe("isAdminOverride", () => {
  it("is true only when adminOverride === true", () => {
    expect(isAdminOverride({ adminOverride: true })).toBe(true);
    expect(isAdminOverride({ adminOverride: false })).toBe(false);
    expect(isAdminOverride({})).toBe(false);
    expect(isAdminOverride(undefined)).toBe(false);
  });
});
