import {
  smartEncode,
  smartDecode,
  DataTransformer,
  batchEncode,
  batchDecode,
} from "../data-transformer";

describe("Backend Data Transformer", () => {
  describe("smartEncode", () => {
    it("should encode learnerTextResponse and learnerChoices", () => {
      const data = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<p>Test response</p>",
            learnerChoices: ["Option A", "Option B"],
          },
        ],
      };

      const result = smartEncode(data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const encoded = result.data.responsesForQuestions[0];
      expect(encoded.learnerTextResponse).not.toBe("<p>Test response</p>");
      expect(encoded.learnerChoices[0]).not.toBe("Option A");

      expect(
        Buffer.from(encoded.learnerTextResponse, "base64").toString("utf8"),
      ).toBe("<p>Test response</p>");
      expect(
        Buffer.from(encoded.learnerChoices[0], "base64").toString("utf8"),
      ).toBe("Option A");

      expect(result.metadata.transformedFields).toEqual([
        "learnerTextResponse",
        "learnerChoices",
      ]);
    });

    it("should handle nested structures with deep transformation", () => {
      const data = {
        assignment: {
          introduction: "Welcome to the course",
          questions: [
            {
              question: "What is Node.js?",
              variants: [
                {
                  content: "<p>Explain Node.js runtime</p>",
                },
              ],
            },
          ],
        },
        responsesForQuestions: [
          {
            learnerTextResponse: "<p>Node.js is a runtime</p>",
            learnerChoices: ["Runtime environment"],
          },
        ],
      };

      const result = smartEncode(data, {
        fields: [
          "introduction",
          "question",
          "content",
          "learnerTextResponse",
          "learnerChoices",
        ],
        deep: true,
      });

      const resultData = result.data;

      expect(resultData.assignment.introduction).not.toBe(
        "Welcome to the course",
      );
      expect(resultData.assignment.questions[0].question).not.toBe(
        "What is Node.js?",
      );
      expect(resultData.assignment.questions[0].variants[0].content).not.toBe(
        "<p>Explain Node.js runtime</p>",
      );
      expect(resultData.responsesForQuestions[0].learnerTextResponse).not.toBe(
        "<p>Node.js is a runtime</p>",
      );
      expect(resultData.responsesForQuestions[0].learnerChoices[0]).not.toBe(
        "Runtime environment",
      );
    });

    it("should exclude specified fields", () => {
      const data = {
        id: 123,
        createdAt: "2023-01-01",
        learnerTextResponse: "<p>Test</p>",
        content: "Should be encoded",
      };

      const result = smartEncode(data, {
        fields: ["learnerTextResponse", "content"],
        exclude: ["id", "createdAt"],
        deep: true,
      });

      expect(result.data.id).toBe(123);
      expect(result.data.createdAt).toBe("2023-01-01");

      expect(result.data.learnerTextResponse).not.toBe("<p>Test</p>");
      expect(result.data.content).not.toBe("Should be encoded");
    });

    it("should preserve data types correctly", () => {
      const data = {
        responsesForQuestions: [
          {
            id: 123,
            submitted: true,
            score: 95.5,
            learnerTextResponse: "<p>Answer</p>",
            choices: null,
            metadata: undefined,
          },
        ],
      };

      const result = smartEncode(data, {
        fields: ["learnerTextResponse"],
        deep: true,
      });

      const encoded = result.data.responsesForQuestions[0];
      expect(typeof encoded.id).toBe("number");
      expect(typeof encoded.submitted).toBe("boolean");
      expect(typeof encoded.score).toBe("number");
      expect(encoded.choices).toBeNull();
      expect(encoded.metadata).toBeUndefined();
    });
  });

  describe("smartDecode", () => {
    it("should decode base64 encoded fields", () => {
      const encodedData = {
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: Buffer.from(
              "<p>Encoded response</p>",
            ).toString("base64"),
            learnerChoices: [
              Buffer.from("Encoded choice A").toString("base64"),
              Buffer.from("Encoded choice B").toString("base64"),
            ],
          },
        ],
      };

      const result = smartDecode(encodedData, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const decoded = result.responsesForQuestions[0];
      expect(decoded.learnerTextResponse).toBe("<p>Encoded response</p>");
      expect(decoded.learnerChoices).toEqual([
        "Encoded choice A",
        "Encoded choice B",
      ]);
    });

    it("should handle malformed base64 gracefully", () => {
      const malformedData = {
        learnerTextResponse: "not-valid-base64!@#",
        learnerChoices: ["also-invalid-base64!"],
      };

      expect(() => {
        smartDecode(malformedData, {
          fields: ["learnerTextResponse", "learnerChoices"],
          deep: true,
        });
      }).not.toThrow();

      const result = smartDecode(malformedData, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(result.learnerTextResponse).toBe("not-valid-base64!@#");
      expect(result.learnerChoices).toEqual(["also-invalid-base64!"]);
    });

    it("should handle JSON encoded arrays in learnerChoices", () => {
      const jsonEncodedChoices = Buffer.from(
        JSON.stringify(["Choice A", "Choice B"]),
      ).toString("base64");

      const data = {
        responsesForQuestions: [
          {
            learnerChoices: jsonEncodedChoices,
          },
        ],
      };

      const result = smartDecode(data, {
        fields: ["learnerChoices"],
        deep: true,
      });

      expect(result.responsesForQuestions[0].learnerChoices).toEqual([
        "Choice A",
        "Choice B",
      ]);
    });
  });

  describe("DataTransformer utility methods", () => {
    describe("encodeForDatabase/decodeFromDatabase", () => {
      it("should include learnerTextResponse and learnerChoices in database operations", () => {
        const data = {
          introduction: "Course intro",
          learnerTextResponse: "<p>Student answer</p>",
          learnerChoices: ["Option 1", "Option 2"],
          id: 123,
        };

        const encoded = DataTransformer.encodeForDatabase(data);

        expect(encoded.data.learnerTextResponse).not.toBe(
          "<p>Student answer</p>",
        );
        expect(encoded.data.learnerChoices[0]).not.toBe("Option 1");

        expect(encoded.data.introduction).not.toBe("Course intro");

        expect(encoded.data.id).toBe(123);

        const decoded = DataTransformer.decodeFromDatabase(encoded.data);
        expect(decoded.learnerTextResponse).toBe("<p>Student answer</p>");
        expect(decoded.learnerChoices).toEqual(["Option 1", "Option 2"]);
        expect(decoded.introduction).toBe("Course intro");
      });
    });

    describe("encodeForAPI/decodeFromAPI", () => {
      it("should use exclude patterns for API operations", () => {
        const data = {
          id: 123,
          createdAt: "2023-01-01",
          updatedAt: "2023-01-01",
          content: "Should be encoded",
          learnerTextResponse: "<p>Response</p>",
        };

        const encoded = DataTransformer.encodeForAPI(data);

        expect(encoded.data.id).toBe(123);
        expect(encoded.data.createdAt).toBe("2023-01-01");
        expect(encoded.data.updatedAt).toBe("2023-01-01");
      });
    });
  });

  describe("Batch operations", () => {
    it("should encode multiple items with batchEncode", () => {
      const dataArray = [
        {
          learnerTextResponse: "<p>Response 1</p>",
          learnerChoices: ["Choice A1"],
        },
        {
          learnerTextResponse: "<p>Response 2</p>",
          learnerChoices: ["Choice A2"],
        },
      ];

      const result = batchEncode(dataArray, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].learnerTextResponse).not.toBe("<p>Response 1</p>");
      expect(result.data[1].learnerTextResponse).not.toBe("<p>Response 2</p>");

      expect(result.metadata.transformedFields).toEqual([
        "learnerTextResponse",
        "learnerChoices",
      ]);
    });

    it("should decode multiple items with batchDecode", () => {
      const encodedArray = [
        {
          learnerTextResponse:
            Buffer.from("<p>Response 1</p>").toString("base64"),
          learnerChoices: [Buffer.from("Choice A1").toString("base64")],
        },
        {
          learnerTextResponse:
            Buffer.from("<p>Response 2</p>").toString("base64"),
          learnerChoices: [Buffer.from("Choice A2").toString("base64")],
        },
      ];

      const result = batchDecode(encodedArray, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(result).toHaveLength(2);
      expect(result[0].learnerTextResponse).toBe("<p>Response 1</p>");
      expect(result[1].learnerTextResponse).toBe("<p>Response 2</p>");
      expect(result[0].learnerChoices).toEqual(["Choice A1"]);
      expect(result[1].learnerChoices).toEqual(["Choice A2"]);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty arrays", () => {
      const data = {
        responsesForQuestions: [],
      };

      const encoded = smartEncode(data, {
        fields: ["learnerTextResponse"],
        deep: true,
      });

      expect(encoded.data.responsesForQuestions).toEqual([]);
    });

    it("should handle null and undefined values in arrays", () => {
      const data = {
        responsesForQuestions: [
          null,
          undefined,
          {
            learnerTextResponse: "<p>Valid response</p>",
          },
        ],
      };

      const encoded = smartEncode(data, {
        fields: ["learnerTextResponse"],
        deep: true,
      });

      expect(encoded.data.responsesForQuestions[0]).toBeNull();
      expect(encoded.data.responsesForQuestions[1]).toBeUndefined();
      expect(
        encoded.data.responsesForQuestions[2].learnerTextResponse,
      ).not.toBe("<p>Valid response</p>");
    });

    it("should handle Unicode and special characters", () => {
      const data = {
        learnerTextResponse: "<p>测试 🚀 émojis & special chars: @#$%</p>",
        learnerChoices: ["选择 A 🎉", "Выбор Б", "選択肢 C"],
      };

      const encoded = smartEncode(data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["learnerTextResponse", "learnerChoices"],
        deep: true,
      });

      expect(decoded).toEqual(data);
    });

    it("should handle very large strings efficiently", () => {
      const largeText = "<p>" + "A".repeat(50_000) + "</p>";
      const data = {
        learnerTextResponse: largeText,
      };

      const startTime = Date.now();

      const encoded = smartEncode(data, {
        fields: ["learnerTextResponse"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["learnerTextResponse"],
        deep: true,
      });

      const endTime = Date.now();

      expect(decoded.learnerTextResponse).toBe(largeText);
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});
