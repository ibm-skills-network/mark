import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { getJobQueueSecret } from "../../job-queue/job-payload.crypto";
import { SavedSessionsController } from "./saved-sessions.controller";
import { SavedSessionsService } from "./saved-sessions.service";

const key = {
  storeId: "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11",
  role: "author",
  assignmentId: 4892,
};

describe("SavedSessionsController", () => {
  const service = { find: jest.fn(), save: jest.fn() };
  const controller = new SavedSessionsController(
    service as unknown as SavedSessionsService,
  );
  const secret = getJobQueueSecret();

  beforeEach(() => jest.clearAllMocks());

  it.each([undefined, "wrong-secret", ["wrong-secret"]])(
    "rejects callers without the internal secret (%p)",
    async (header) => {
      await expect(controller.lookup(header, key)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        controller.save(header, { ...key, token: "jwt" }),
      ).rejects.toThrow(ForbiddenException);
      expect(service.find).not.toHaveBeenCalled();
      expect(service.save).not.toHaveBeenCalled();
    },
  );

  it("checks the secret before the body, so callers without it get 403", async () => {
    await expect(
      controller.lookup(undefined, { storeId: "nope" }),
    ).rejects.toThrow(ForbiddenException);
    await expect(controller.save(undefined, {})).rejects.toThrow(
      ForbiddenException,
    );
    expect(service.find).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });

  it("returns the saved token", async () => {
    service.find.mockResolvedValue("jwt");
    await expect(controller.lookup(secret, key)).resolves.toEqual({
      token: "jwt",
    });
    expect(service.find).toHaveBeenCalledWith(key);
  });

  it("returns null when nothing is saved", async () => {
    service.find.mockResolvedValue(undefined);
    await expect(controller.lookup([secret], key)).resolves.toEqual({
      token: null,
    });
  });

  it("saves a token", async () => {
    await controller.save(secret, { ...key, token: "jwt" });
    expect(service.save).toHaveBeenCalledWith(key, "jwt");
  });

  it.each([
    { ...key, storeId: "not-a-guid" },
    { ...key, role: "admin" },
    { ...key, assignmentId: 0 },
    { ...key, assignmentId: 1.5 },
    { ...key, assignmentId: "4892" },
    { ...key, assignmentId: 2_147_483_648 },
    undefined,
  ])("rejects an invalid key %p", async (body) => {
    await expect(controller.lookup(secret, body)).rejects.toThrow(
      BadRequestException,
    );
    expect(service.find).not.toHaveBeenCalled();
  });

  it.each(["", 42, "x".repeat(16_385)])(
    "rejects an invalid token %p",
    async (token) => {
      await expect(controller.save(secret, { ...key, token })).rejects.toThrow(
        BadRequestException,
      );
      expect(service.save).not.toHaveBeenCalled();
    },
  );
});
