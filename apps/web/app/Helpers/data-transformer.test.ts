import {
  smartEncode,
  smartDecode,
  clearTransformCache,
  getCacheStats,
  DataTransformer,
} from "./data-transformer";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

describe("DataTransformer Web App", () => {
  beforeEach(() => {
    clearTransformCache();
  });

  describe("smartEncode", () => {
    it("should encode string fields correctly with UTF-8 support", () => {
      const testData = {
        introduction: "Hello world with special chars: café, naïve, résumé",
        normalField: "normal",
        number: 42,
      };

      const result = smartEncode(testData, {
        fields: ["introduction"],
      });

      expect(result.data.introduction).not.toBe(testData.introduction);
      expect(result.data.normalField).toBe(testData.normalField);
      expect(result.data.number).toBe(testData.number);
      expect(result.metadata.fields).toContain("introduction");
      expect(result.metadata.originalSize).toBeGreaterThan(0);
      expect(result.metadata.encodedSize).toBeGreaterThan(0);
    });

    it("should auto-detect fields to encode when no fields specified", () => {
      const testData = {
        shortField: "short",
        longField:
          "This is a very long field that should be automatically encoded",
        number: 42,
      };

      const result = smartEncode(testData);

      expect(result.data.shortField).toBe(testData.shortField);
      expect(result.data.longField).not.toBe(testData.longField);
      expect(result.data.number).toBe(testData.number);
      expect(result.metadata.fields).toContain("longField");
    });

    it("should encode short HTML snippets to preserve markup", () => {
      const htmlSnippet = "<p>Hi</p>";
      const testData = { html: htmlSnippet };

      const result = smartEncode(testData);

      expect(result.data.html).not.toBe(htmlSnippet);
      const decoder = new TextDecoder();
      const binaryString = atob(result.data.html);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      expect(decoder.decode(bytes)).toBe(htmlSnippet);
      expect(result.metadata.fields).toContain("html");
    });

    it("should exclude specified fields from encoding", () => {
      const testData = {
        shouldEncode: "This field should be encoded because it is long enough",
        shouldExclude: "This field should be excluded even though it is long",
      };

      const result = smartEncode(testData, {
        exclude: ["shouldExclude"],
      });

      expect(result.data.shouldEncode).not.toBe(testData.shouldEncode);
      expect(result.data.shouldExclude).toBe(testData.shouldExclude);
    });

    it("should handle nested objects when deep is true", () => {
      const testData = {
        level1: {
          level2: {
            introduction: "This should be encoded in nested structure",
          },
        },
      };

      const result = smartEncode(testData, {
        fields: ["introduction"],
        deep: true,
      });

      expect(result.data.level1.level2.introduction).not.toBe(
        testData.level1.level2.introduction,
      );
      expect(result.metadata.fields).toContain("introduction");
    });

    it("should not traverse nested objects when deep is false", () => {
      const testData = {
        introduction: "This should be encoded at root level",
        level1: {
          introduction: "This should not be encoded when deep is false",
        },
      };

      const result = smartEncode(testData, {
        fields: ["introduction"],
        deep: false,
      });

      expect(result.data.introduction).not.toBe(testData.introduction);
      expect(result.data.level1.introduction).toBe(
        testData.level1.introduction,
      );
      expect(result.metadata.fields).toContain("introduction");
      expect(result.metadata.fields).toHaveLength(1);
    });

    it("should handle arrays correctly", () => {
      const testData = {
        items: [
          { introduction: "First item introduction" },
          { introduction: "Second item introduction" },
        ],
      };

      const result = smartEncode(testData, {
        fields: ["introduction"],
        deep: true,
      });

      expect(result.data.items[0].introduction).not.toBe(
        testData.items[0].introduction,
      );
      expect(result.data.items[1].introduction).not.toBe(
        testData.items[1].introduction,
      );
      expect(result.metadata.fields).toContain("introduction");
    });

    it("should respect nested field configuration for array elements", () => {
      const testData = {
        questions: [
          {
            choices: [
              { choice: "<p>Option A</p>" },
              { choice: "<p>Option B</p>" },
            ],
          },
        ],
      };

      const config = {
        fields: ["questions.choices.choice"],
        deep: true,
      };

      const encoded = smartEncode(testData, config);

      expect(encoded.data.questions[0].choices[0].choice).not.toBe(
        testData.questions[0].choices[0].choice,
      );
      expect(encoded.data.questions[0].choices[1].choice).not.toBe(
        testData.questions[0].choices[1].choice,
      );

      const decoded = smartDecode(encoded.data, config);

      expect(decoded.questions[0].choices[0].choice).toBe(
        testData.questions[0].choices[0].choice,
      );
      expect(decoded.questions[0].choices[1].choice).toBe(
        testData.questions[0].choices[1].choice,
      );
    });

    it("should handle null and undefined values", () => {
      const testData = {
        nullField: null,
        undefinedField: undefined,
        normalField: "normal",
      };

      const result = smartEncode(testData);

      expect(result.data.nullField).toBe(null);
      expect(result.data.undefinedField).toBe(undefined);
      expect(result.data.normalField).toBe("normal");
    });

    it("should encode non-string values when specified in fields", () => {
      const testData = {
        objectField: { key: "value" },
        numberField: 12345,
      };

      const result = smartEncode(testData, {
        fields: ["objectField", "numberField"],
      });

      expect(result.data.objectField).not.toEqual(testData.objectField);
      expect(result.data.numberField).not.toBe(testData.numberField);
      expect(typeof result.data.objectField).toBe("string");
      expect(typeof result.data.numberField).toBe("string");
    });

    it("should skip already encoded base64 strings", () => {
      const alreadyEncoded = btoa("test string");
      const testData = {
        encodedField: alreadyEncoded,
        plainField: "This is a plain text field that should be encoded",
      };

      const result = smartEncode(testData);

      expect(result.data.encodedField).toBe(alreadyEncoded);
      expect(result.data.plainField).not.toBe(testData.plainField);
    });

    it("should not re-encode nested base64 strings", () => {
      const html = "<p>double encoded</p>";
      const once = btoa(html);
      const twice = btoa(once);
      const testData = { field: twice };

      const result = smartEncode(testData);

      expect(result.data.field).toBe(twice);
      expect(result.metadata.fields).not.toContain("field");
    });

    it("should handle compression for large strings", () => {
      const largeString = "a".repeat(1500);
      const testData = { large: largeString };

      const result = smartEncode(testData, { fields: ["large"] });

      expect(result.data.large).toMatch(/^comp:/);
      expect(result.data.large).not.toBe(largeString);
    });

    it("should use caching for performance", () => {
      const testData = { field: "test data for caching" };

      clearTransformCache();
      const initialStats = getCacheStats();
      expect(initialStats.size).toBe(0);

      const result1 = smartEncode(testData, { fields: ["field"] });
      const statsAfterFirst = getCacheStats();
      expect(statsAfterFirst.size).toBeGreaterThan(0);

      const result2 = smartEncode(testData, { fields: ["field"] });
      expect(result2.data).toEqual(result1.data);
    });

    it("should handle different compression levels", () => {
      const testData = { content: "Test content for compression" };

      const noneResult = smartEncode(testData, {
        fields: ["content"],
        compressionLevel: "none",
      });

      const lightResult = smartEncode(testData, {
        fields: ["content"],
        compressionLevel: "light",
      });

      const heavyResult = smartEncode(testData, {
        fields: ["content"],
        compressionLevel: "heavy",
      });

      expect(noneResult.data.content).not.toBe(testData.content);
      expect(lightResult.data.content).not.toBe(testData.content);
      expect(heavyResult.data.content).not.toBe(testData.content);
    });
  });

  describe("smartDecode", () => {
    it("should decode previously encoded string fields with UTF-8 support", () => {
      const originalData = {
        introduction: "Hello world with special chars: café, naïve, résumé",
        normalField: "normal",
      };

      const encoded = smartEncode(originalData, {
        fields: ["introduction"],
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["introduction"],
      });

      expect(decoded.introduction).toBe(originalData.introduction);
      expect(decoded.normalField).toBe(originalData.normalField);
    });

    it("should automatically decode base64 strings without explicit configuration", () => {
      const html = "<div>Auto decode</div>";
      const encoder = new TextEncoder();
      const encoded = encoder.encode(html);
      const base64 = btoa(String.fromCharCode(...Array.from(encoded)));
      const testData = { html: base64 };

      const decoded = smartDecode(testData);

      expect(decoded.html).toBe(html);
    });

    it("should decode base64 payloads even when wrapped with stray characters", () => {
      const html = "<p>Remediated content</p>";
      const base64 = btoa(html);
      const decoded = smartDecode({ html: `r\uFFFD\uFFFD${base64}` });

      expect(decoded.html).toBe(html);
    });

    it("should fully decode nested base64 layers", () => {
      const html = "<p>double decode</p>";
      const once = btoa(html);
      const twice = btoa(once);

      const decoded = smartDecode({ html: twice });

      expect(decoded.html).toBe(html);
    });

    it("should handle malformed base64 gracefully", () => {
      const testData = {
        invalidBase64: "not-valid-base64!@#",
        validField: "normal",
      };

      const result = smartDecode(testData, {
        fields: ["invalidBase64"],
      });

      expect(result.invalidBase64).toBe(testData.invalidBase64);
      expect(result.validField).toBe(testData.validField);
    });

    it("should decode JSON strings correctly", () => {
      const originalObject = { key: "value", number: 42 };
      const encoder = new TextEncoder();
      const encoded = encoder.encode(JSON.stringify(originalObject));
      const base64 = btoa(String.fromCharCode(...Array.from(encoded)));

      const testData = {
        jsonField: base64,
      };

      const result = smartDecode(testData, {
        fields: ["jsonField"],
      });

      expect(result.jsonField).toEqual(originalObject);
    });

    it("should return plain strings when JSON.parse fails", () => {
      const plainText = "This is just plain text";
      const encoder = new TextEncoder();
      const encoded = encoder.encode(plainText);
      const base64 = btoa(String.fromCharCode(...Array.from(encoded)));

      const testData = {
        textField: base64,
      };

      const result = smartDecode(testData, {
        fields: ["textField"],
      });

      expect(result.textField).toBe(plainText);
    });

    it("should handle nested objects correctly", () => {
      const originalData = {
        level1: {
          level2: {
            introduction: "Nested content with special chars: café",
          },
        },
      };

      const encoded = smartEncode(originalData, {
        fields: ["introduction"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["introduction"],
        deep: true,
      });

      expect(decoded.level1.level2.introduction).toBe(
        originalData.level1.level2.introduction,
      );
    });

    it("should handle arrays correctly", () => {
      const originalData = {
        items: [
          { introduction: "First with special: résumé" },
          { introduction: "Second with special: naïve" },
        ],
      };

      const encoded = smartEncode(originalData, {
        fields: ["introduction"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["introduction"],
        deep: true,
      });

      expect(decoded.items[0].introduction).toBe(
        originalData.items[0].introduction,
      );
      expect(decoded.items[1].introduction).toBe(
        originalData.items[1].introduction,
      );
    });

    it("should handle null and undefined values", () => {
      const testData = {
        nullField: null,
        undefinedField: undefined,
      };

      const result = smartDecode(testData);

      expect(result.nullField).toBe(null);
      expect(result.undefinedField).toBe(undefined);
    });

    it("should handle compressed strings correctly", () => {
      const largeString = "a".repeat(1500);
      const testData = { large: largeString };

      const encoded = smartEncode(testData, { fields: ["large"] });
      const decoded = smartDecode(encoded.data, { fields: ["large"] });

      expect(decoded.large).toBe(largeString);
    });

    it("should use caching for performance", () => {
      const testData = { field: "encoded content" };

      clearTransformCache();

      const result1 = smartDecode(testData, { fields: ["field"] });
      const statsAfterFirst = getCacheStats();
      expect(statsAfterFirst.size).toBeGreaterThan(0);

      const result2 = smartDecode(testData, { fields: ["field"] });
      expect(result2).toEqual(result1);
    });
  });

  describe("utility functions", () => {
    describe("isAlreadyEncoded", () => {
      it("should correctly identify base64 strings", () => {
        const plainText = "Hello world";
        const encoded = btoa(plainText);

        const testData = { field: encoded };
        const result = smartEncode(testData);

        expect(result.data.field).toBe(encoded);
        expect(result.metadata.fields).not.toContain("field");
      });

      it("should correctly identify non-base64 strings", () => {
        const plainText = "This is definitely not base64 encoded text";
        const testData = { field: plainText };

        const result = smartEncode(testData);

        expect(result.data.field).not.toBe(plainText);
        expect(result.metadata.fields).toContain("field");
      });
    });

    describe("shouldTransformField", () => {
      it("should transform fields specified in fields array", () => {
        const testData = { short: "hi", target: "x" };

        const result = smartEncode(testData, {
          fields: ["target"],
        });

        expect(result.data.short).toBe("hi");
        expect(result.data.target).not.toBe("x");
        expect(result.metadata.fields).toContain("target");
      });

      it("should auto-detect long fields when no fields specified", () => {
        const testData = {
          short: "tiny",
          long: "This is a very long string that should be automatically detected for encoding",
        };

        const result = smartEncode(testData);

        expect(result.data.short).toBe("tiny");
        expect(result.data.long).not.toBe(testData.long);
        expect(result.metadata.fields).toContain("long");
      });
    });
  });

  describe("cache management", () => {
    it("should clear cache correctly", () => {
      const testData = { field: "test data" };

      smartEncode(testData, { fields: ["field"] });
      expect(getCacheStats().size).toBeGreaterThan(0);

      clearTransformCache();
      expect(getCacheStats().size).toBe(0);
    });

    it("should provide cache statistics", () => {
      clearTransformCache();
      const stats = getCacheStats();

      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("entries");
      expect(stats.size).toBe(0);
      expect(Array.isArray(stats.entries)).toBe(true);
    });

    it("should handle cache expiry", (done) => {
      const testData = { field: "test data" };
      smartEncode(testData, { fields: ["field"] });

      const stats = getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
      done();
    });
  });

  describe("DataTransformer utility functions", () => {
    describe("encodeForAPI", () => {
      it("should encode specified fields for API transmission", () => {
        const testData = {
          introduction: "Test introduction with special chars: résumé",
          instructions: "Test instructions",
          otherField: "should not be encoded",
        };

        const result = DataTransformer.encodeForAPI(testData);

        expect(result.data.introduction).not.toBe(testData.introduction);
        expect(result.data.instructions).not.toBe(testData.instructions);
        expect(result.data.otherField).toBe(testData.otherField);
        expect(result.metadata.fields).toContain("introduction");
        expect(result.metadata.fields).toContain("instructions");
      });

      it("should handle nested objects with specified field paths", () => {
        const testData = {
          questions: {
            scoring: {
              rubrics: {
                rubricQuestion: "Test rubric question",
                criteria: {
                  description: "Test criteria description",
                },
              },
            },
          },
        };

        const result = DataTransformer.encodeForAPI(testData);

        expect(result.data.questions.scoring.rubrics.rubricQuestion).not.toBe(
          testData.questions.scoring.rubrics.rubricQuestion,
        );
        expect(
          result.data.questions.scoring.rubrics.criteria.description,
        ).not.toBe(testData.questions.scoring.rubrics.criteria.description);
      });
    });

    describe("decodeFromAPI", () => {
      it("should decode previously encoded data from API", () => {
        const originalData = {
          introduction: "Original introduction with café",
          instructions: "Original instructions with naïve",
          otherField: "unchanged",
        };

        const encoded = DataTransformer.encodeForAPI(originalData);
        const decoded = DataTransformer.decodeFromAPI(encoded.data);

        expect(decoded.introduction).toBe(originalData.introduction);
        expect(decoded.instructions).toBe(originalData.instructions);
        expect(decoded.otherField).toBe(originalData.otherField);
      });
    });

    describe("encodeFormData", () => {
      it("should exclude specified fields and encode shallow", () => {
        const testData = {
          id: 123,
          createdAt: "2023-01-01",
          updatedAt: "2023-01-01",
          longContent:
            "This is content that should be encoded for form submission",
          nested: {
            deepContent: "This should not be encoded due to deep: false",
          },
        };

        const result = DataTransformer.encodeFormData(testData);

        expect(result.data.id).toBe(testData.id);
        expect(result.data.createdAt).toBe(testData.createdAt);
        expect(result.data.updatedAt).toBe(testData.updatedAt);
        expect(result.data.longContent).not.toBe(testData.longContent);
        expect(result.data.nested.deepContent).toBe(
          testData.nested.deepContent,
        );
      });
    });

    describe("encodeForStorage", () => {
      it("should apply heavy compression for storage", () => {
        const testData = {
          content:
            "This content will be encoded for storage with heavy compression",
        };

        const result = DataTransformer.encodeForStorage(testData);

        expect(result.data.content).not.toBe(testData.content);
        expect(result.metadata.fields).toContain("content");
      });
    });
  });

  describe("edge cases", () => {
    it("should handle circular references gracefully", () => {
      const circularObj: any = { name: "test" };
      circularObj.self = circularObj;

      const result = smartEncode(circularObj);
      expect(result.data.self).toBe("[Circular]");
    });

    it("should handle very large strings", () => {
      const largeString = "a".repeat(10000);
      const testData = { large: largeString };

      const result = smartEncode(testData, { fields: ["large"] });

      expect(result.data.large).not.toBe(largeString);
      expect(result.metadata.fields).toContain("large");
    });

    it("should handle unicode characters correctly", () => {
      const unicodeString = "🚀 Unicode test: 测试 тест テスト";
      const testData = { unicode: unicodeString };

      const encoded = smartEncode(testData, { fields: ["unicode"] });
      const decoded = smartDecode(encoded.data, { fields: ["unicode"] });

      expect(decoded.unicode).toBe(unicodeString);
    });

    it("should handle empty strings", () => {
      const testData = { empty: "" };

      const encoded = smartEncode(testData, { fields: ["empty"] });
      const decoded = smartDecode(encoded.data, { fields: ["empty"] });

      expect(decoded.empty).toBe("");
    });

    it("should handle special characters in field names", () => {
      const testData = {
        "field-with-dashes": "content",
        "field.with.dots": "more content",
        "field with spaces": "even more content",
      };

      const encoded = smartEncode(testData, {
        fields: ["field-with-dashes", "field.with.dots", "field with spaces"],
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["field-with-dashes", "field.with.dots", "field with spaces"],
      });

      expect(decoded).toEqual(testData);
    });

    it("should handle mixed data types in arrays", () => {
      const testData = {
        mixedArray: ["string", 123, { object: "value" }, null, undefined, true],
      };

      const encoded = smartEncode(testData, { deep: true });
      const decoded = smartDecode(encoded.data, { deep: true });

      expect(decoded.mixedArray).toEqual(testData.mixedArray);
    });

    it("should handle deeply nested structures", () => {
      const testData = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  content: "Deep nested content that should be encoded",
                },
              },
            },
          },
        },
      };

      const encoded = smartEncode(testData, {
        fields: ["content"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["content"],
        deep: true,
      });

      expect(decoded).toEqual(testData);
    });

    it("should handle performance with large datasets", () => {
      const largeDataset = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          content: `Content item ${i} with some longer text that might be encoded`,
        })),
      };

      const startTime = performance.now();
      const encoded = smartEncode(largeDataset, {
        fields: ["content"],
        deep: true,
      });
      const encodeTime = performance.now() - startTime;

      const decodeStartTime = performance.now();
      const decoded = smartDecode(encoded.data, {
        fields: ["content"],
        deep: true,
      });
      const decodeTime = performance.now() - decodeStartTime;

      expect(decoded).toEqual(largeDataset);
      expect(encodeTime).toBeLessThan(5000);
      expect(decodeTime).toBeLessThan(5000);
    });
  });
});
