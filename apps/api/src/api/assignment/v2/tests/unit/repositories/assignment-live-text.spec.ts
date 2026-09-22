/* eslint-disable unicorn/no-null */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "src/database/prisma.service";

import {
  AssignmentRepository,
  resolveAssignmentMeta,
  resolveAssignmentName,
} from "../../../repositories/assignment.repository";

/**
 * Publishing writes the assignment's text to the active version and leaves the
 * base `Assignment` row at whatever it held before versioning. Anything that
 * reads the base row directly therefore sees a title no learner is shown —
 * which is how the translator came to translate the wrong string, and to skip
 * the title entirely on every rerun because the stale value never changed.
 *
 * These cover the one rule every reader now shares.
 */
describe("live assignment text", () => {
  const version = (overrides: Record<string, unknown> = {}) => ({
    isActive: true,
    name: "Unit 3 Review",
    introduction: "Version intro",
    instructions: "Version instructions",
    gradingCriteriaOverview: "Version criteria",
    ...overrides,
  });

  const baseRow = (overrides: Record<string, unknown> = {}) => ({
    name: "Untitled Assignment",
    introduction: "Stale intro",
    instructions: "Stale instructions",
    gradingCriteriaOverview: "Stale criteria",
    currentVersion: null,
    versions: [],
    ...overrides,
  });

  describe("resolveAssignmentName", () => {
    it("prefers the active version's name over the base row", () => {
      expect(
        resolveAssignmentName(baseRow({ currentVersion: version() })),
      ).toBe("Unit 3 Review");
    });

    it("falls back to the base row when no version exists", () => {
      // The 2025 versioning backfill swallowed per-row failures, so published
      // assignments with no version at all are a live data state, not a
      // hypothetical. They must keep rendering their base-row title.
      expect(resolveAssignmentName(baseRow())).toBe("Untitled Assignment");
    });

    it("ignores a current version that is no longer active", () => {
      expect(
        resolveAssignmentName(
          baseRow({ currentVersion: version({ isActive: false }) }),
        ),
      ).toBe("Untitled Assignment");
    });

    it("uses the newest active version when the pointer is stale", () => {
      expect(
        resolveAssignmentName(
          baseRow({
            currentVersion: version({ isActive: false }),
            versions: [version({ name: "Newest Active" })],
          }),
        ),
      ).toBe("Newest Active");
    });

    it("falls back per field rather than wholesale", () => {
      // A version may legitimately carry a null introduction while the base row
      // has one. Taking the version as an all-or-nothing unit would blank it.
      expect(
        resolveAssignmentMeta(
          baseRow({ currentVersion: version({ introduction: null }) }),
        ),
      ).toEqual({
        name: "Unit 3 Review",
        introduction: "Stale intro",
        instructions: "Version instructions",
        gradingCriteriaOverview: "Version criteria",
      });
    });
  });

  describe("AssignmentRepository.findMetaById", () => {
    let repository: AssignmentRepository;
    let findUnique: jest.Mock;

    beforeEach(async () => {
      findUnique = jest.fn();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AssignmentRepository,
          {
            provide: PrismaService,
            useValue: { assignment: { findUnique } },
          },
        ],
      }).compile();

      repository = module.get<AssignmentRepository>(AssignmentRepository);
    });

    it("returns the active version's text, not the base row's", async () => {
      findUnique.mockResolvedValue({
        id: 7,
        ...baseRow({ currentVersion: version() }),
      });

      await expect(repository.findMetaById(7)).resolves.toEqual({
        id: 7,
        name: "Unit 3 Review",
        introduction: "Version intro",
        instructions: "Version instructions",
        gradingCriteriaOverview: "Version criteria",
      });
    });

    it("returns null for an assignment that does not exist", async () => {
      findUnique.mockResolvedValue(null);

      await expect(repository.findMetaById(7)).resolves.toBeNull();
    });
  });
});
