import { FilesService } from "./files.service";
import { PrismaService } from "src/database/prisma.service";
import { S3Service } from "./s3.service";
import { FileProcessingBudgetService } from "./file-processing-budget.service";

describe("retained original mutation boundaries", () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    attemptSource: { findFirst: jest.fn() },
    sourceObjectDeletion: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
    ),
  };
  const s3 = {
    getBucketName: jest.fn().mockReturnValue("bucket"),
    deleteObject: jest.fn().mockResolvedValue({}),
    deleteObjects: jest.fn().mockResolvedValue({ Deleted: [{ Key: "a" }] }),
    copyObject: jest.fn().mockResolvedValue({}),
    listObjectsV2: jest.fn(),
  };
  let service: FilesService;
  beforeEach(() => {
    jest.clearAllMocks();
    tx.attemptSource.findFirst.mockResolvedValue(undefined);
    s3.deleteObject.mockResolvedValue({});
    s3.listObjectsV2.mockResolvedValue({
      Contents: [{ Key: "folder/a" }, { Key: "folder/b" }],
    });
    service = new FilesService(
      s3 as unknown as S3Service,
      prisma as unknown as PrismaService,
      {} as FileProcessingBudgetService,
    );
  });
  it("refuses retained originals before object-store deletion", async () => {
    tx.attemptSource.findFirst.mockResolvedValue({ id: "bound" });
    await expect(service.deleteFile("learner", "a")).rejects.toMatchObject({
      status: 409,
    });
    expect(s3.deleteObject).not.toHaveBeenCalled();
    expect(tx.sourceObjectDeletion.upsert).not.toHaveBeenCalled();
  });
  it("reserves a legacy key before deleting and allows idempotent retry", async () => {
    s3.deleteObject.mockImplementation(async () => {
      expect(tx.sourceObjectDeletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { bucket: "bucket", storageKey: "a" },
        }),
      );
      return {};
    });
    await expect(service.deleteFile("learner", "a")).resolves.toMatchObject({
      success: true,
    });
    await expect(service.deleteFile("learner", "a")).resolves.toMatchObject({
      success: true,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it("keeps the reservation after an uncertain storage failure", async () => {
    s3.deleteObject.mockRejectedValue(new Error("storage unavailable"));
    await expect(service.deleteFile("learner", "a")).rejects.toThrow(
      "storage unavailable",
    );
    expect(tx.sourceObjectDeletion.upsert).toHaveBeenCalledTimes(1);
  });
  it("checks all folder keys before any batch deletion", async () => {
    tx.attemptSource.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "bound" });
    await expect(
      service.deleteFolder("learner", "/folder"),
    ).rejects.toMatchObject({ status: 409 });
    expect(s3.deleteObjects).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it("rejects move and rename overwrites of retained destinations", async () => {
    tx.attemptSource.findFirst.mockImplementation(
      async ({ where }: { where: { storageKey: string } }) =>
        where.storageKey === "a" ? { id: "bound" } : undefined,
    );
    await expect(
      service.moveFile({
        sourceKey: "other/a",
        targetPath: "/",
        bucket: "bucket",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.renameFile({
        sourceKey: "b",
        newFileName: "a",
        bucket: "bucket",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(s3.copyObject).not.toHaveBeenCalled();
  });
});
