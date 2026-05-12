import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CompleteAssignmentFileDto,
  InitiateAssignmentFilesDto,
} from "./assignment-file-upload.dto";

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  fileName: "notes.pdf",
  mimeType: "application/pdf",
  fileSize: 1024,
  ...overrides,
});

describe("InitiateAssignmentFilesDto", () => {
  it("accepts a single valid file", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: [makeItem()],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts exactly 10 files (max)", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: Array.from({ length: 10 }, () => makeItem()),
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects empty files array", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, { files: [] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("files");
    expect(errors[0].constraints?.arrayMinSize).toBeDefined();
  });

  it("rejects more than 10 files", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: Array.from({ length: 11 }, () => makeItem()),
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.arrayMaxSize).toBeDefined();
  });

  it("rejects missing files property", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].property).toBe("files");
  });

  it("rejects item with negative fileSize", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: [makeItem({ fileSize: -1 })],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    const nested = errors[0].children?.[0]?.children ?? [];
    const fileSizeError = nested.find((e) => e.property === "fileSize");
    expect(fileSizeError?.constraints?.isPositive).toBeDefined();
  });

  it("rejects item with zero fileSize", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: [makeItem({ fileSize: 0 })],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects item with non-string fileName", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: [makeItem({ fileName: 123 })],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects item missing mimeType", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: [{ fileName: "a.pdf", fileSize: 10 }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects unsupported mimeType values", async () => {
    const dto = plainToInstance(InitiateAssignmentFilesDto, {
      files: [makeItem({ mimeType: "application/x-msdownload" })],
    });
    const errors = await validate(dto);
    const nested = errors[0].children?.[0]?.children ?? [];
    const mimeTypeError = nested.find((e) => e.property === "mimeType");
    expect(mimeTypeError?.constraints?.isIn).toBeDefined();
  });
});

describe("CompleteAssignmentFileDto", () => {
  const validPart = { partNumber: 1, etag: "etag-1" };

  it("accepts a valid payload", async () => {
    const dto = plainToInstance(CompleteAssignmentFileDto, {
      uploadId: "mpu-xyz",
      parts: [validPart],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects missing uploadId", async () => {
    const dto = plainToInstance(CompleteAssignmentFileDto, {
      parts: [validPart],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.property === "uploadId")).toBe(true);
  });

  it("rejects non-string uploadId", async () => {
    const dto = plainToInstance(CompleteAssignmentFileDto, {
      uploadId: 42,
      parts: [validPart],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "uploadId")).toBe(true);
  });

  it("rejects empty parts array", async () => {
    const dto = plainToInstance(CompleteAssignmentFileDto, {
      uploadId: "mpu-xyz",
      parts: [],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("parts");
    expect(errors[0].constraints?.arrayMinSize).toBeDefined();
  });

  it("rejects part with non-positive partNumber", async () => {
    const dto = plainToInstance(CompleteAssignmentFileDto, {
      uploadId: "mpu-xyz",
      parts: [{ partNumber: 0, etag: "etag-1" }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects part missing etag", async () => {
    const dto = plainToInstance(CompleteAssignmentFileDto, {
      uploadId: "mpu-xyz",
      parts: [{ partNumber: 1 }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
