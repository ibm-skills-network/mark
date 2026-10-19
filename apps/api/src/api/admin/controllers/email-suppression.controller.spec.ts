import { NotFoundException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { EmailSuppressionReason } from "@prisma/client";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { EmailSuppressionService } from "src/auth/services/email-suppression.service";
import { EmailSuppressionController } from "./email-suppression.controller";

describe("EmailSuppressionController", () => {
  const suppressions = {
    list: jest.fn(),
    suppress: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new EmailSuppressionController(
    suppressions as unknown as EmailSuppressionService,
  );
  const request = {
    userSession: { userId: "admin@example.com" },
  } as unknown as UserSessionRequest;

  beforeEach(() => jest.clearAllMocks());

  it("is admin-only", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      EmailSuppressionController,
    ) as unknown[];
    expect(guards).toContain(AdminGuard);
  });

  it("records the acting admin on a new suppression", async () => {
    suppressions.suppress.mockResolvedValue({ id: 1 });

    await controller.create(
      {
        email: "gone@example.com",
        reason: "COMPLAINT",
        note: "Marked as spam",
      },
      request,
    );

    expect(suppressions.suppress).toHaveBeenCalledWith(
      "gone@example.com",
      EmailSuppressionReason.COMPLAINT,
      "Marked as spam",
      "admin@example.com",
    );
  });

  it("defaults paging", async () => {
    suppressions.list.mockResolvedValue({ items: [], total: 0 });

    await expect(controller.list({}, request)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    expect(suppressions.list).toHaveBeenCalledWith(1, 25, undefined);
  });

  it("returns 404 when removing an unknown suppression", async () => {
    suppressions.remove.mockResolvedValue(false);

    await expect(controller.remove(9, request)).rejects.toThrow(
      NotFoundException,
    );
  });
});
