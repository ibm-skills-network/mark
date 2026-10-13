import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AdminGuard } from "../guards/admin.guard";
import { AdminAuthController } from "./admin-auth.controller";

describe("AdminAuthController test-email", () => {
  it("requires an admin session, so it cannot email arbitrary addresses", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminAuthController.prototype.testEmail,
    ) as unknown[];

    expect(guards).toContain(AdminGuard);
  });
});
