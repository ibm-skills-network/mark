/* eslint-disable */
import { DataTransformer, smartDecode, smartEncode } from "./data-transformer";

/**
 * Comprehensive edge cases and critical scenarios for data transformer
 * These tests ensure reliability and robustness of the encoding/decoding system
 */
describe("DataTransformer - Critical Edge Cases", () => {
  describe("Unicode and Special Characters", () => {
    it("should handle emoji and unicode characters correctly", () => {
      const testData = {
        question: "What is 2+2? 🤔 Choose the correct answer ✅",
        content: "Hello 世界 مرحبا мир",
      };

      const encoded = smartEncode(testData, {
        fields: ["question", "content"],
      });

      expect(encoded.data.question).not.toBe(testData.question);
      expect(encoded.data.content).not.toBe(testData.content);

      const decoded = smartDecode(encoded.data, {
        fields: ["question", "content"],
      });

      expect(decoded.question).toBe(testData.question);
      expect(decoded.content).toBe(testData.content);
    });

    it("should handle various unicode ranges", () => {
      const testData = {
        text: "Latin: café, Greek: αβγ, Cyrillic: абв, Arabic: العربية, Hebrew: עברית, Chinese: 中文, Japanese: 日本語, Korean: 한국어",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });

    it("should handle zero-width characters and combining diacritics", () => {
      const testData = {
        text: "Café with combining: Cafe\u0301, Zero-width joiner: \u200D, Zero-width non-joiner: \u200C",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });
  });

  describe("HTML and Special Markup", () => {
    it("should handle complex nested HTML correctly", () => {
      const testData = {
        content: `<div class="container">
          <p>This is <strong>bold</strong> and <em>italic</em> text.</p>
          <ul>
            <li>Item 1 with <a href="http://example.com">link</a></li>
            <li>Item 2 with <code>code</code></li>
          </ul>
          <pre><code>const x = 1;</code></pre>
        </div>`,
      };

      const encoded = smartEncode(testData, { fields: ["content"] });
      const decoded = smartDecode(encoded.data, { fields: ["content"] });

      expect(decoded.content).toBe(testData.content);
    });

    it("should handle HTML with attributes and special characters", () => {
      const testData = {
        html: `<div data-value="test & 'quotes' and \"double quotes\""><p>Content with < and > and &amp;</p></div>`,
      };

      const encoded = smartEncode(testData, { fields: ["html"] });
      const decoded = smartDecode(encoded.data, { fields: ["html"] });

      expect(decoded.html).toBe(testData.html);
    });

    it("should handle malformed HTML gracefully", () => {
      const testData = {
        html: "<div><p>Unclosed tags<span>nested",
      };

      const encoded = smartEncode(testData, { fields: ["html"] });
      const decoded = smartDecode(encoded.data, { fields: ["html"] });

      expect(decoded.html).toBe(testData.html);
    });
  });

  describe("Edge Case Values", () => {
    it("should handle empty strings", () => {
      const testData = { content: "" };
      const encoded = smartEncode(testData, { fields: ["content"] });
      const decoded = smartDecode(encoded.data, { fields: ["content"] });

      expect(decoded.content).toBe("");
    });

    it("should handle whitespace-only strings", () => {
      const testData = {
        space: " ",
        tab: "\t",
        newline: "\n",
        mixed: " \t\n ",
      };

      const encoded = smartEncode(testData, {
        fields: ["space", "tab", "newline", "mixed"],
      });
      const decoded = smartDecode(encoded.data, {
        fields: ["space", "tab", "newline", "mixed"],
      });

      expect(decoded.space).toBe(testData.space);
      expect(decoded.tab).toBe(testData.tab);
      expect(decoded.newline).toBe(testData.newline);
      expect(decoded.mixed).toBe(testData.mixed);
    });

    it("should handle very long strings", () => {
      const longString = "a".repeat(100000);
      const testData = { content: longString };

      const encoded = smartEncode(testData, { fields: ["content"] });
      const decoded = smartDecode(encoded.data, { fields: ["content"] });

      expect(decoded.content).toBe(longString);
      expect(decoded.content.length).toBe(100000);
    });

    it("should handle strings with newlines and special whitespace", () => {
      const testData = {
        content: "Line 1\nLine 2\r\nLine 3\tTabbed\fForm feed\vVertical tab",
      };

      const encoded = smartEncode(testData, { fields: ["content"] });
      const decoded = smartDecode(encoded.data, { fields: ["content"] });

      expect(decoded.content).toBe(testData.content);
    });

    it("should NOT encode numeric strings that look like years or IDs", () => {
      const testData = {
        year: "2024",
        id: "12345",
        score: "95",
      };

      const encoded = smartEncode(testData, {
        fields: ["year", "id", "score"],
      });

      expect(encoded.data.year).toBe(testData.year);
      expect(encoded.data.id).toBe(testData.id);
      expect(encoded.data.score).toBe(testData.score);
    });
  });

  describe("Nested Structures and Arrays", () => {
    it("should handle deeply nested objects with arrays", () => {
      const testData = {
        questions: [
          {
            id: 1,
            choices: [
              { choice: "Option A", feedback: "Correct!" },
              { choice: "Option B", feedback: "Incorrect" },
            ],
            scoring: {
              rubrics: [
                {
                  rubricQuestion: "Did they answer correctly?",
                  criteria: [
                    {
                      points: 0,
                      description: "Wrong answer",
                    },
                    {
                      points: 1,
                      description: "Correct answer",
                    },
                  ],
                },
              ],
            },
          },
        ],
      };

      const encoded = DataTransformer.encodeForDatabase(testData);
      const decoded = DataTransformer.decodeFromDatabase(encoded.data);

      expect(decoded.questions[0].choices[0].choice).toBe("Option A");
      expect(decoded.questions[0].choices[0].feedback).toBe("Correct!");
      expect(decoded.questions[0].scoring.rubrics[0].rubricQuestion).toBe(
        "Did they answer correctly?",
      );
      expect(
        decoded.questions[0].scoring.rubrics[0].criteria[0].description,
      ).toBe("Wrong answer");
    });

    it("should handle mixed array types", () => {
      const testData = {
        mixed: ["string", 123, null, { nested: "object" }],
        choices: [
          { choice: "A", isCorrect: true },
          { choice: "B", isCorrect: false },
        ],
      };

      const encoded = smartEncode(testData, {
        fields: ["choices.choice"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["choices.choice"],
        deep: true,
      });

      expect(decoded.choices[0].choice).toBe("A");
      expect(decoded.choices[1].choice).toBe("B");
      expect(decoded.mixed).toEqual(testData.mixed);
    });

    it("should handle empty arrays and nested empty arrays", () => {
      const testData = {
        emptyArray: [],
        nestedEmpty: [[], [], []],
        mixedEmpty: [{ items: [] }, { items: [{ subitems: [] }] }],
      };

      const encoded = smartEncode(testData, { deep: true });
      const decoded = smartDecode(encoded.data, { deep: true });

      expect(decoded.emptyArray).toEqual([]);
      expect(decoded.nestedEmpty).toEqual([[], [], []]);
      expect(decoded.mixedEmpty[0].items).toEqual([]);
    });
  });

  describe("Field Path Matching Edge Cases", () => {
    it("should not match fields with similar names", () => {
      const testData = {
        choice: "Top-level choice (should NOT be encoded)",
        choices: [
          {
            choice: "Nested choice (should be encoded)",
          },
        ],
      };

      const encoded = smartEncode(testData, {
        fields: ["choices.choice"],
        deep: true,
      });

      expect(encoded.data.choice).toBe(testData.choice);
      expect(encoded.data.choices[0].choice).not.toBe(
        testData.choices[0].choice,
      );

      const decoded = smartDecode(encoded.data, {
        fields: ["choices.choice"],
        deep: true,
      });

      expect(decoded.choice).toBe(testData.choice);
      expect(decoded.choices[0].choice).toBe(testData.choices[0].choice);
    });

    it("should handle array indices correctly in field paths", () => {
      const testData = {
        items: [
          { content: "Item 0" },
          { content: "Item 1" },
          { content: "Item 2" },
        ],
      };

      const encoded = smartEncode(testData, {
        fields: ["items.content"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["items.content"],
        deep: true,
      });

      expect(decoded.items[0].content).toBe("Item 0");
      expect(decoded.items[1].content).toBe("Item 1");
      expect(decoded.items[2].content).toBe("Item 2");
    });

    it("should handle multiple levels of nested arrays", () => {
      const testData = {
        levels: [
          {
            items: [
              {
                subitems: [
                  { text: "Level 3 - Item 0" },
                  { text: "Level 3 - Item 1" },
                ],
              },
            ],
          },
        ],
      };

      const encoded = smartEncode(testData, {
        fields: ["levels.items.subitems.text"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["levels.items.subitems.text"],
        deep: true,
      });

      expect(decoded.levels[0].items[0].subitems[0].text).toBe(
        "Level 3 - Item 0",
      );
      expect(decoded.levels[0].items[0].subitems[1].text).toBe(
        "Level 3 - Item 1",
      );
    });
  });

  describe("Base64 Detection Edge Cases", () => {
    it("should NOT decode plain text that looks like base64", () => {
      const testData = {
        content: "ABCD1234",
      };

      const decoded = smartDecode(testData, { fields: ["content"] });

      expect(decoded.content).toBe(testData.content);
    });

    it("should handle already-encoded data without double-encoding", () => {
      const original = "Hello World";
      const alreadyEncoded = Buffer.from(original).toString("base64");

      const testData = { content: alreadyEncoded };

      const encoded1 = smartEncode(testData, { fields: ["content"] });

      const decoded = smartDecode(encoded1.data, { fields: ["content"] });

      expect(decoded.content).toBe(original);
    });

    it("should handle base64 strings with padding variations", () => {
      const tests = [
        { input: "SGVsbG8=", expected: "Hello" },
        {
          input: "SGVsbG8",
          expected: "Hello",
        },
        {
          input: "VGVzdA==",
          expected: "Test",
        },
        {
          input: "VGVzdA",
          expected: "Test",
        },
      ];

      tests.forEach(({ input, expected }) => {
        const decoded = smartDecode({ text: input }, { fields: ["text"] });
        expect(decoded.text).toBe(expected);
      });
    });

    it("should NOT decode invalid base64 strings", () => {
      const invalidBase64Tests = ["~)^", "Hello!", "abc", "!!!!"];

      invalidBase64Tests.forEach((invalid) => {
        const decoded = smartDecode({ text: invalid }, { fields: ["text"] });
        expect(decoded.text).toBe(invalid);
      });
    });
  });

  describe("Multiple Encoding Layers", () => {
    it("should handle double-encoded data", () => {
      const original = "Test content";
      const once = Buffer.from(original).toString("base64");
      const twice = Buffer.from(once).toString("base64");

      const decoded = smartDecode({ text: twice }, { fields: ["text"] });

      expect(decoded.text).toBe(original);
    });

    it("should handle triple-encoded data", () => {
      const original = "<p>HTML Content</p>";
      const once = Buffer.from(original).toString("base64");
      const twice = Buffer.from(once).toString("base64");
      const thrice = Buffer.from(twice).toString("base64");

      const decoded = smartDecode({ text: thrice }, { fields: ["text"] });

      expect(decoded.text).toBe(original);
    });

    it("should stop at maximum depth to prevent infinite loops", () => {
      let encoded = "Test";
      for (let i = 0; i < 10; i++) {
        encoded = Buffer.from(encoded).toString("base64");
      }

      const decoded = smartDecode({ text: encoded }, { fields: ["text"] });

      expect(decoded.text).toBeDefined();
      expect(typeof decoded.text).toBe("string");
    });
  });

  describe("Null and Undefined Handling", () => {
    it("should handle null values in various positions", () => {
      const testData = {
        nullField: null,
        normalField: "value",
        nestedNull: {
          field: null,
        },
        arrayWithNull: [null, "value", null],
      };

      const encoded = smartEncode(testData, {
        fields: ["normalField"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["normalField"],
        deep: true,
      });

      expect(decoded.nullField).toBeNull();
      expect(decoded.nestedNull.field).toBeNull();
      expect(decoded.arrayWithNull).toEqual([null, "value", null]);
    });

    it("should handle undefined values", () => {
      const testData = {
        undefinedField: undefined,
        normalField: "value",
      };

      const encoded = smartEncode(testData, {
        fields: ["normalField"],
        deep: true,
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["normalField"],
        deep: true,
      });

      expect(decoded.undefinedField).toBeUndefined();
      expect(decoded.normalField).toBe("value");
    });
  });

  describe("Configuration Edge Cases", () => {
    it("should respect exclude configuration", () => {
      const testData = {
        id: "12345",
        content: "Should be encoded",
        createdAt: "2024-01-01",
      };

      const encoded = smartEncode(testData, {
        fields: ["id", "content", "createdAt"],
        exclude: ["id", "createdAt"],
      });

      expect(encoded.data.id).toBe(testData.id);
      expect(encoded.data.createdAt).toBe(testData.createdAt);
      expect(encoded.data.content).not.toBe(testData.content);
    });

    it("should handle empty field configuration", () => {
      const testData = {
        content: "Should not be encoded",
      };

      const encoded = smartEncode(testData, { fields: [] });

      expect(encoded.data.content).toBe(testData.content);
      expect(encoded.metadata.transformedFields).toHaveLength(0);
    });

    it("should handle conflicting field and exclude configurations", () => {
      const testData = {
        content: "Test",
      };

      const encoded = smartEncode(testData, {
        fields: ["content"],
        exclude: ["content"],
      });

      expect(encoded.data.content).toBe(testData.content);
    });
  });

  describe("JSON Parsing Edge Cases", () => {
    it("should decode JSON strings correctly", () => {
      const jsonString = JSON.stringify({ key: "value", number: 42 });
      const encoded = Buffer.from(jsonString).toString("base64");

      const decoded = smartDecode({ data: encoded }, { fields: ["data"] });

      expect(decoded.data).toEqual({ key: "value", number: 42 });
    });

    it("should handle stringified arrays", () => {
      const arrayString = JSON.stringify([1, 2, 3, "four"]);
      const encoded = Buffer.from(arrayString).toString("base64");

      const decoded = smartDecode({ data: encoded }, { fields: ["data"] });

      expect(decoded.data).toEqual([1, 2, 3, "four"]);
    });

    it("should return plain string when JSON parsing fails", () => {
      const plainText = "Not a JSON string";
      const encoded = Buffer.from(plainText).toString("base64");

      const decoded = smartDecode({ data: encoded }, { fields: ["data"] });

      expect(decoded.data).toBe(plainText);
    });
  });

  describe("Performance and Large Data", () => {
    it("should handle large arrays efficiently", () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        content: `Content ${i}`,
      }));

      const testData = { items: largeArray };

      const startTime = Date.now();
      const encoded = smartEncode(testData, {
        fields: ["items.content"],
        deep: true,
      });
      const encodeTime = Date.now() - startTime;

      const decodeStart = Date.now();
      const decoded = smartDecode(encoded.data, {
        fields: ["items.content"],
        deep: true,
      });
      const decodeTime = Date.now() - decodeStart;

      expect(decoded.items).toHaveLength(1000);
      expect(decoded.items[0].content).toBe("Content 0");
      expect(decoded.items[999].content).toBe("Content 999");

      expect(encodeTime).toBeLessThan(5000);
      expect(decodeTime).toBeLessThan(5000);
    });

    it("should handle deeply nested structures", () => {
      let nested: any = { value: "deep value" };
      for (let i = 0; i < 10; i++) {
        nested = { level: i, child: nested };
      }

      const testData = { data: nested };

      const encoded = smartEncode(testData, { deep: true });
      const decoded = smartDecode(encoded.data, { deep: true });

      let current = decoded.data;
      for (let i = 9; i >= 0; i--) {
        expect(current.level).toBe(i);
        current = current.child;
      }
      expect(current.value).toBe("deep value");
    });
  });

  describe("Batch Operations", () => {
    it("should handle batch encode with mixed data", () => {
      const dataArray = [
        { id: 1, content: "First" },
        { id: 2, content: "Second" },
        { id: 3, content: "Third" },
      ];

      const result = DataTransformer.batchEncode(dataArray, {
        fields: ["content"],
      });

      expect(result.data).toHaveLength(3);
      expect(result.metadata.transformedFields).toContain("content");

      const decoded = DataTransformer.batchDecode(result.data, {
        fields: ["content"],
      });

      expect(decoded[0].content).toBe("First");
      expect(decoded[1].content).toBe("Second");
      expect(decoded[2].content).toBe("Third");
    });

    it("should handle empty batch operations", () => {
      const emptyArray: any[] = [];

      const encoded = DataTransformer.batchEncode(emptyArray);
      const decoded = DataTransformer.batchDecode(emptyArray);

      expect(encoded.data).toEqual([]);
      expect(decoded).toEqual([]);
    });
  });

  describe("Error Recovery", () => {
    it("should handle corrupted base64 gracefully", () => {
      const corrupted = "SGVsbG8gV29ybGQ=!!!invalid!!!";

      const decoded = smartDecode({ text: corrupted }, { fields: ["text"] });

      expect(decoded.text).toBeDefined();
    });

    it("should handle non-string values in string fields", () => {
      const testData = {
        content: 12345 as any,
        normalField: "string",
      };

      const encoded = smartEncode(testData, {
        fields: ["content", "normalField"],
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["content", "normalField"],
      });

      expect(decoded.normalField).toBe("string");
    });

    it("should throw on circular references (expected behavior)", () => {
      const obj: any = { value: "test" };
      obj.self = obj;

      expect(() => {
        const encoded = smartEncode(obj, { fields: ["value"] });
      }).toThrow();
    });
  });
});
