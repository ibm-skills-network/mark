import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DirectUploadDto, UploadType } from "./upload.dto";

describe("DirectUploadDto", () => {
  it("accepts every UploadType enum value", async () => {
    for (const value of Object.values(UploadType)) {
      const dto = plainToInstance(DirectUploadDto, { uploadType: value });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it("rejects stray-quoted uploadType (the bruno-test regression case)", async () => {
    const dto = plainToInstance(DirectUploadDto, { uploadType: '"author"' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isEnum).toBeDefined();
  });

  it("rejects unknown uploadType", async () => {
    const dto = plainToInstance(DirectUploadDto, { uploadType: "admin" });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isEnum).toBeDefined();
  });

  it("rejects missing uploadType", async () => {
    const dto = plainToInstance(DirectUploadDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].property).toBe("uploadType");
  });

  it("accepts context as a string (JSON blob parsed by the controller)", async () => {
    const dto = plainToInstance(DirectUploadDto, {
      uploadType: "learner",
      context: '{"assignmentId":1,"questionId":2}',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects non-string context", async () => {
    const dto = plainToInstance(DirectUploadDto, {
      uploadType: "learner",
      context: { assignmentId: 1 },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("context");
  });
});
