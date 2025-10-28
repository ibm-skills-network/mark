import { APIClient } from "../api-client";
import { DataTransformer } from "@/app/Helpers/data-transformer";

/**
 * Integration tests for the complete data transformation pipeline
 * These tests verify the end-to-end encoding/decoding flow
 */
describe("Data Transformation Integration", () => {
  beforeEach(() => {
    // Clear the cache before each test to prevent contamination
    DataTransformer.clearCache();
  });
  describe("Complete Pipeline", () => {
    it("should encode and decode learnerTextResponse correctly", () => {
      const originalData = {
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse:
              "<p>This is a <strong>test</strong> response</p>",
            learnerChoices: ["Option A", "Option B"],
          },
          {
            id: 2,
            learnerTextResponse:
              "<div>Another response with <em>emphasis</em></div>",
            learnerChoices: [
              "Choice 1",
              "Choice 2 with special chars: @#$%^&*()",
            ],
          },
        ],
      };

      // Step 1: Frontend encodes the data
      const encodedResult = DataTransformer.encodeForAPI(originalData, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      // Verify that the data was encoded
      expect(
        encodedResult.data.responsesForQuestions[0].learnerTextResponse,
      ).not.toBe("<p>This is a <strong>test</strong> response</p>");
      expect(
        encodedResult.data.responsesForQuestions[0].learnerChoices[0],
      ).not.toBe("Option A");

      // Step 2: Backend decodes the data (simulating middleware/interceptor)
      const decodedData = DataTransformer.decodeFromAPI(encodedResult.data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      // Verify that we get back the original data
      expect(decodedData).toEqual(originalData);
    });

    it("should handle complex nested structures", () => {
      const complexData = {
        assignment: {
          introduction: "Welcome to <strong>Advanced JavaScript</strong>",
          questions: [
            {
              question:
                "What is the difference between <code>let</code> and <code>var</code>?",
              variants: [
                {
                  content: "<p>Explain the scoping differences</p>",
                },
              ],
            },
          ],
        },
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse:
              "<p><code>let</code> has block scope while <code>var</code> has function scope</p>",
            learnerChoices: [
              "Block scoping vs function scoping",
              "Hoisting behavior differences",
            ],
          },
        ],
      };

      // Encode
      const encoded = DataTransformer.encodeForAPI(complexData, {
        fields: [
          "introduction",
          "question",
          "content",
          "learnerTextResponse",
          "learnerChoices",
        ],
        deep: true,
      });

      // Decode
      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: [
          "introduction",
          "question",
          "content",
          "learnerTextResponse",
          "learnerChoices",
        ],
        deep: true,
      });

      expect(decoded).toEqual(complexData);
    });

    it("should preserve non-string data types", () => {
      const mixedData = {
        responsesForQuestions: [
          {
            id: 123, // number
            submitted: true, // boolean
            learnerTextResponse: "<p>Text response</p>", // string to encode
            learnerChoices: ["Choice A"], // array of strings to encode
            metadata: {
              timestamp: 1634567890, // number
              valid: false, // boolean
            },
          },
        ],
      };

      const encoded = DataTransformer.encodeForAPI(mixedData, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(decoded).toEqual(mixedData);
      expect(typeof decoded.responsesForQuestions[0].id).toBe("number");
      expect(typeof decoded.responsesForQuestions[0].submitted).toBe("boolean");
      expect(typeof decoded.responsesForQuestions[0].metadata.timestamp).toBe(
        "number",
      );
      expect(typeof decoded.responsesForQuestions[0].metadata.valid).toBe(
        "boolean",
      );
    });

    it("should handle empty and null values gracefully", () => {
      const dataWithEmpties = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "", // empty string
            learnerChoices: [], // empty array
          },
          {
            id: 2,
            learnerTextResponse: null, // null value
            learnerChoices: null, // null value
          },
          {
            id: 3,
            learnerTextResponse: undefined, // undefined value
            learnerChoices: undefined, // undefined value
          },
        ],
      };

      const encoded = DataTransformer.encodeForAPI(dataWithEmpties, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(decoded).toEqual(dataWithEmpties);
    });

    it("should handle special characters and unicode", () => {
      const unicodeData = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse:
              "<p>测试中文字符 🚀 émojis and special chars: @#$%^&*()</p>",
            learnerChoices: [
              "选项 A with émojis 🎉",
              "Опция Б (Cyrillic)",
              "アオプション C (Japanese)",
            ],
          },
        ],
      };

      const encoded = DataTransformer.encodeForAPI(unicodeData, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(decoded).toEqual(unicodeData);
    });

    it("should handle large data structures efficiently", () => {
      // Create a large dataset
      const largeData = {
        responsesForQuestions: Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          learnerTextResponse: `<p>This is response ${i + 1} with some <strong>HTML</strong> content</p>`,
          learnerChoices: [
            `Choice A for question ${i + 1}`,
            `Choice B for question ${i + 1}`,
            `Choice C for question ${i + 1}`,
          ],
        })),
      };

      const startTime = performance.now();

      const encoded = DataTransformer.encodeForAPI(largeData, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const endTime = performance.now();

      expect(decoded).toEqual(largeData);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed base64 during decoding", () => {
      const malformedData = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "this-is-not-valid-base64!@#$%",
            learnerChoices: ["also-not-valid-base64!"],
          },
        ],
      };

      // This should not throw an error
      expect(() => {
        DataTransformer.decodeFromAPI(malformedData, {
          fields: ["learnerTextResponse", "learnerChoices"],
          deep: true,
        });
      }).not.toThrow();
    });

    it("should handle circular references gracefully", () => {
      const circularData: any = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<p>Test</p>",
          },
        ],
      };

      // Create circular reference
      circularData.self = circularData;

      // This should handle the circular reference without infinite recursion
      expect(() => {
        DataTransformer.encodeForAPI(circularData, {
          fields: ["learnerTextResponse"],
          deep: true,
        });
      }).not.toThrow();
    });

    it("should handle very large strings", () => {
      const largeString = "<p>" + "A".repeat(10000) + "</p>";
      const dataWithLargeString = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: largeString,
            learnerChoices: ["Short choice"],
          },
        ],
      };

      const encoded = DataTransformer.encodeForAPI(dataWithLargeString, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const decoded = DataTransformer.decodeFromAPI(encoded.data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(decoded).toEqual(dataWithLargeString);
    });
  });

  describe("Performance", () => {
    it("should maintain metadata about transformations", () => {
      const data = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<p>Test response</p>",
            learnerChoices: ["Choice A", "Choice B"],
          },
        ],
      };

      const result = DataTransformer.encodeForAPI(data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata.transformedFields).toContain(
        "learnerTextResponse",
      );
      expect(result.metadata.transformedFields).toContain("learnerChoices");
      expect(typeof result.metadata.originalSize).toBe("number");
      expect(typeof result.metadata.transformedSize).toBe("number");
      expect(typeof result.metadata.timestamp).toBe("number");
    });
  });
});
