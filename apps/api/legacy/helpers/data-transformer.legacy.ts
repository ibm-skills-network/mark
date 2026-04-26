/* eslint-disable */
import {
  batchDecode,
  batchEncode,
  DataTransformer,
  smartDecode,
  smartEncode,
} from "./data-transformer";

describe("DataTransformer API", () => {
  describe("smartEncode", () => {
    it("should encode string fields correctly", () => {
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
      expect(result.metadata.transformedFields).toContain("introduction");
      expect(result.metadata.originalSize).toBeGreaterThan(0);
      expect(result.metadata.transformedSize).toBeGreaterThan(0);
    });

    it("should not transform fields when no explicit configuration provided", () => {
      const testData = {
        shortField: "short",
        longField:
          "This is a very long field that will NOT be encoded without explicit config",
        number: 42,
      };

      const result = smartEncode(testData);

      expect(result.data.shortField).toBe(testData.shortField);
      expect(result.data.longField).toBe(testData.longField);
      expect(result.data.number).toBe(testData.number);
      expect(result.metadata.transformedFields).toHaveLength(0);
    });

    it("should encode short HTML snippets when explicitly configured", () => {
      const htmlSnippet = "<p>Hi</p>";
      const testData = { html: htmlSnippet };

      const result = smartEncode(testData, { fields: ["html"] });

      expect(result.data.html).not.toBe(htmlSnippet);
      expect(Buffer.from(result.data.html, "base64").toString("utf8")).toBe(
        htmlSnippet,
      );
      expect(result.metadata.transformedFields).toContain("html");
    });

    it("should exclude specified fields from encoding", () => {
      const testData = {
        shouldEncode: "This field should be encoded because it is configured",
        shouldExclude: "This field should be excluded",
      };

      const result = smartEncode(testData, {
        fields: ["shouldEncode", "shouldExclude"],
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
      expect(result.metadata.transformedFields).toContain(
        "level1.level2.introduction",
      );
    });

    it("should not traverse nested objects when deep is false", () => {
      const testData = {
        level1: {
          introduction: "This should not be encoded when deep is false",
        },
      };

      const result = smartEncode(testData, {
        fields: ["introduction"],
        deep: false,
      });

      expect(result.data.level1.introduction).toBe(
        testData.level1.introduction,
      );
      expect(result.metadata.transformedFields).toEqual([]);
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
      expect(result.metadata.transformedFields).toContain(
        "items[0].introduction",
      );
      expect(result.metadata.transformedFields).toContain(
        "items[1].introduction",
      );
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
      expect(encoded.metadata.transformedFields).toContain(
        "questions[0].choices[0].choice",
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
        numberField: 12_345,
      };

      const result = smartEncode(testData, {
        fields: ["objectField", "numberField"],
      });

      expect(result.data.objectField).not.toEqual(testData.objectField);
      expect(result.data.numberField).not.toBe(testData.numberField);
      expect(typeof result.data.objectField).toBe("string");
      expect(typeof result.data.numberField).toBe("string");
    });

    it("should transform fields when explicitly configured", () => {
      const plainText = "test string";
      const testData = {
        field1: plainText,
        field2: "This is a plain text field",
      };

      const result = smartEncode(testData, {
        fields: ["field1", "field2"],
      });

      expect(result.data.field1).not.toBe(plainText);
      expect(result.data.field2).not.toBe(testData.field2);
      expect(result.metadata.transformedFields).toContain("field1");
      expect(result.metadata.transformedFields).toContain("field2");
    });

    it("should not re-encode nested base64 strings", () => {
      const html = "<p>double encoded</p>";
      const once = Buffer.from(html, "utf8").toString("base64");
      const twice = Buffer.from(once, "utf8").toString("base64");
      const testData = { field: twice };

      const result = smartEncode(testData);

      expect(result.data.field).toBe(twice);
      expect(result.metadata.transformedFields).not.toContain("field");
    });
  });

  describe("smartDecode", () => {
    it("should decode previously encoded string fields", () => {
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

    it("should decode base64 strings with explicit configuration", () => {
      const html = "<div>Auto decode</div>";
      const encodedHtml = Buffer.from(html, "utf8").toString("base64");
      const testData = { html: encodedHtml };

      const decoded = smartDecode(testData, { fields: ["html"] });

      expect(decoded.html).toBe(html);
    });

    it("should NOT decode base64 payloads when wrapped with stray characters (safer behavior)", () => {
      const html = "<p>Corrupted payload</p>";
      const encodedHtml = Buffer.from(html, "utf8").toString("base64");
      const corrupted = `r\uFFFD\uFFFD${encodedHtml}`;

      const decoded = smartDecode({ html: corrupted }, { fields: ["html"] });

      expect(decoded.html).toBe(corrupted);
    });

    it("should fully decode nested base64 layers", () => {
      const html = "<p>double decode</p>";
      const once = Buffer.from(html, "utf8").toString("base64");
      const twice = Buffer.from(once, "utf8").toString("base64");
      const decoded = smartDecode({ html: twice }, { fields: ["html"] });

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

      expect(result.validField).toBe(testData.validField);
      expect(typeof result.invalidBase64).toBe("string");
    });

    it("should decode JSON strings correctly", () => {
      const originalObject = { key: "value", number: 42 };
      const encoded = Buffer.from(
        JSON.stringify(originalObject),
        "utf8",
      ).toString("base64");
      const testData = {
        jsonField: encoded,
      };

      const result = smartDecode(testData, {
        fields: ["jsonField"],
      });

      expect(result.jsonField).toEqual(originalObject);
    });

    it("should return plain strings when JSON.parse fails", () => {
      const plainText = "This is just plain text";
      const encoded = Buffer.from(plainText, "utf8").toString("base64");
      const testData = {
        textField: encoded,
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
  });

  describe("utility functions", () => {
    describe("isBase64Encoded", () => {
      it("should encode configured fields", () => {
        const plainText = "Hello world";
        const testData = { field: plainText };
        const result = smartEncode(testData, { fields: ["field"] });

        expect(result.data.field).not.toBe(plainText);
        expect(result.metadata.transformedFields).toContain("field");
      });

      it("should not encode unconfigured fields", () => {
        const plainText = "This text won't be encoded";
        const testData = { field: plainText };

        const result = smartEncode(testData);

        expect(result.data.field).toBe(plainText);
        expect(result.metadata.transformedFields).not.toContain("field");
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
        expect(result.metadata.transformedFields).toContain("target");
      });

      it("should not transform fields when no configuration provided", () => {
        const testData = {
          short: "tiny",
          long: "This is a very long string that won't be transformed without configuration",
        };

        const result = smartEncode(testData);

        expect(result.data.short).toBe("tiny");
        expect(result.data.long).toBe(testData.long);
        expect(result.metadata.transformedFields).toHaveLength(0);
      });
    });
  });

  describe("batchEncode", () => {
    it("should encode multiple objects correctly", () => {
      const dataArray = [
        { introduction: "First introduction" },
        { introduction: "Second introduction" },
      ];

      const result = batchEncode(dataArray, {
        fields: ["introduction"],
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].introduction).not.toBe(dataArray[0].introduction);
      expect(result.data[1].introduction).not.toBe(dataArray[1].introduction);
      expect(result.metadata.transformedFields).toContain("introduction");
      expect(result.metadata.originalSize).toBeGreaterThan(0);
      expect(result.metadata.transformedSize).toBeGreaterThan(0);
    });

    it("should handle empty arrays", () => {
      const result = batchEncode([]);

      expect(result.data).toEqual([]);
      expect(result.metadata.transformedFields).toEqual([]);
      expect(result.metadata.originalSize).toBe(0);
      expect(result.metadata.transformedSize).toBe(0);
    });
  });

  describe("batchDecode", () => {
    it("should decode multiple objects correctly", () => {
      const originalArray = [
        { introduction: "First with special: café" },
        { introduction: "Second with special: naïve" },
      ];

      const encoded = batchEncode(originalArray, {
        fields: ["introduction"],
      });

      const decoded = batchDecode(encoded.data, {
        fields: ["introduction"],
      });

      expect(decoded).toHaveLength(2);
      expect(decoded[0].introduction).toBe(originalArray[0].introduction);
      expect(decoded[1].introduction).toBe(originalArray[1].introduction);
    });

    it("should handle empty arrays", () => {
      const result = batchDecode([]);
      expect(result).toEqual([]);
    });
  });

  describe("DataTransformer utility functions", () => {
    describe("encodeForDatabase", () => {
      it("should encode specified fields for database storage", () => {
        const testData = {
          introduction: "Test introduction with special chars: résumé",
          instructions: "Test instructions",
          otherField: "should not be encoded",
        };

        const result = DataTransformer.encodeForDatabase(testData);

        expect(result.data.introduction).not.toBe(testData.introduction);
        expect(result.data.instructions).not.toBe(testData.instructions);
        expect(result.data.otherField).toBe(testData.otherField);
        expect(result.metadata.transformedFields).toContain("introduction");
        expect(result.metadata.transformedFields).toContain("instructions");
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

        const result = DataTransformer.encodeForDatabase(testData);

        expect(result.data.questions.scoring.rubrics.rubricQuestion).not.toBe(
          testData.questions.scoring.rubrics.rubricQuestion,
        );
        expect(
          result.data.questions.scoring.rubrics.criteria.description,
        ).not.toBe(testData.questions.scoring.rubrics.criteria.description);
      });
    });

    describe("decodeFromDatabase", () => {
      it("should decode previously encoded data from database", () => {
        const originalData = {
          introduction: "Original introduction with café",
          instructions: "Original instructions with naïve",
          otherField: "unchanged",
        };

        const encoded = DataTransformer.encodeForDatabase(originalData);
        const decoded = DataTransformer.decodeFromDatabase(encoded.data);

        expect(decoded.introduction).toBe(originalData.introduction);
        expect(decoded.instructions).toBe(originalData.instructions);
        expect(decoded.otherField).toBe(originalData.otherField);
      });
    });

    describe("encodeForAPI", () => {
      it("should exclude specified fields but not auto-encode", () => {
        const testData = {
          id: 123,
          createdAt: "2023-01-01",
          updatedAt: "2023-01-01",
          longContent: "This content won't be encoded without explicit config",
          nested: {
            deepContent: "This deep content also won't be encoded",
          },
        };

        const result = DataTransformer.encodeForAPI(testData);

        expect(result.data.id).toBe(testData.id);
        expect(result.data.createdAt).toBe(testData.createdAt);
        expect(result.data.updatedAt).toBe(testData.updatedAt);
        expect(result.data.longContent).toBe(testData.longContent);
        expect(result.data.nested.deepContent).toBe(
          testData.nested.deepContent,
        );
      });
    });

    describe("decodeFromAPI", () => {
      it("should exclude specified fields from transformation", () => {
        const testData = {
          id: 123,
          createdAt: "2023-01-01",
          updatedAt: "2023-01-01",
          shortText: "short",
        };

        const decoded = DataTransformer.decodeFromAPI(testData);

        expect(decoded.id).toBe(testData.id);
        expect(decoded.createdAt).toBe(testData.createdAt);
        expect(decoded.updatedAt).toBe(testData.updatedAt);
        expect(decoded.shortText).toBe(testData.shortText);
      });

      it("should decode with explicit fields configuration", () => {
        const originalData = {
          content: "This content should be decoded when fields are specified",
        };

        const encoded = smartEncode(originalData, { fields: ["content"] });
        const decoded = smartDecode(encoded.data, { fields: ["content"] });

        expect(decoded.content).toBe(originalData.content);
      });
    });
  });

  describe("edge cases", () => {
    it("should handle circular references gracefully", () => {
      const circularObject: any = { name: "test" };
      circularObject.self = circularObject;

      expect(() => smartEncode(circularObject)).toThrow();
    });

    it("should handle very large strings", () => {
      const largeString = "a".repeat(10_000);
      const testData = { large: largeString };

      const result = smartEncode(testData, { fields: ["large"] });

      expect(result.data.large).not.toBe(largeString);
      expect(result.metadata.transformedFields).toContain("large");
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

    it("should handle malformed input data", () => {
      const testData = {
        validField: "valid content",
        invalidBase64: "invalid-base64-data-@#$",
      };

      const result = smartDecode(testData, {
        fields: ["invalidBase64"],
      });

      expect(result.validField).toBe(testData.validField);
      expect(typeof result.invalidBase64).toBe("string");
    });
  });
});
