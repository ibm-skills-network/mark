import { ArtifactCapabilitiesController } from "./artifact-capabilities.controller";
import { artifactFormatCapabilities } from "backend-contracts";
import { PARSER_LIMITS } from "./parser/isolated-artifact-parser";

describe("authoritative artifact capability inventory", () => {
  it("keeps UI rollout off and publishes the actual parser byte limits", () => {
    const result = new ArtifactCapabilitiesController().getCapabilities();
    expect(result.rolloutEnabled).toBe(false);
    expect(result.gradeable).toBe(false);
    expect(result.limits.inputBytes).toBe(PARSER_LIMITS.inputBytes);
    expect(result.formats.map((format) => format.format)).toEqual(
      artifactFormatCapabilities.map((format) => format.format),
    );
    expect(result.formats.every((format) => !format.canonicalAccepted)).toBe(
      true,
    );
  });
  it("advertises only explicitly enabled parser variants while grading stays disabled", () => {
    const previous = process.env.ARTIFACT_PREVIEW_ASSIGNMENT_IDS;
    try {
      process.env.ARTIFACT_PREVIEW_ASSIGNMENT_IDS = "41, 42";
      const controller = new ArtifactCapabilitiesController();
      const enabled = controller.getCapabilities("42");
      expect(enabled.rolloutEnabled).toBe(true);
      expect(enabled.gradeable).toBe(false);
      expect(
        enabled.formats.find((format) => format.format === "spreadsheet"),
      ).toMatchObject({
        canonicalAccepted: true,
        canonicalExtensions: [".xlsx"],
      });
      expect(
        enabled.formats.find((format) => format.format === "repository")
          ?.canonicalAccepted,
      ).toBe(false);
      expect(controller.getCapabilities("43").rolloutEnabled).toBe(false);
      expect(controller.getCapabilities().rolloutEnabled).toBe(false);
      expect(() => controller.getCapabilities("42junk")).toThrow(
        "Invalid assignment",
      );
    } finally {
      if (previous === undefined)
        delete process.env.ARTIFACT_PREVIEW_ASSIGNMENT_IDS;
      else process.env.ARTIFACT_PREVIEW_ASSIGNMENT_IDS = previous;
    }
  });
});
