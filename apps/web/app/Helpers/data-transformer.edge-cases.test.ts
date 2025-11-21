/* eslint-disable */
import { DataTransformer, smartDecode, smartEncode } from "./data-transformer";

/**
 * Comprehensive edge cases and critical scenarios for web data transformer
 * These tests ensure reliability and robustness of the encoding/decoding system
 */
describe("DataTransformer Web - Critical Edge Cases", () => {
  describe("Browser-Specific Encoding", () => {
    it("should handle TextEncoder/TextDecoder correctly", () => {
      const testData = {
        question: "What is the answer? 🎯",
        content: "Test with émojis and spëcial çharacters",
      };

      const encoded = smartEncode(testData, {
        fields: ["question", "content"],
      });

      expect(encoded.data.question).not.toBe(testData.question);

      const decoded = smartDecode(encoded.data, {
        fields: ["question", "content"],
      });

      expect(decoded.question).toBe(testData.question);
      expect(decoded.content).toBe(testData.content);
    });

    it("should handle btoa/atob edge cases", () => {
      const testData = {
        text: "Test\u0000null\u0001control\u001Fchars",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });
  });

  describe("Unicode Edge Cases", () => {
    it("should handle emoji sequences correctly", () => {
      const testData = {
        text: "👨‍👩‍👧‍👦 Family emoji, 🏳️‍🌈 Flag, 👍🏽 Skin tone",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });

    it("should handle surrogate pairs correctly", () => {
      const testData = {
        text: "𝕳𝖊𝖑𝖑𝖔 𝖂𝖔𝖗𝖑𝖉 🎼 𝄞",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });

    it("should handle right-to-left text", () => {
      const testData = {
        text: "Mixed: Hello مرحبا שלום back to LTR",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });
  });

  describe("HTML in Browser Context", () => {
    it("should handle script tags safely", () => {
      const testData = {
        html: "<script>alert('test')</script><p>Content</p>",
      };

      const encoded = smartEncode(testData, { fields: ["html"] });
      const decoded = smartDecode(encoded.data, { fields: ["html"] });

      expect(decoded.html).toBe(testData.html);
    });

    it("should handle HTML entities", () => {
      const testData = {
        html: "&lt;div&gt;&amp;nbsp;&lt;/div&gt; &copy; 2024",
      };

      const encoded = smartEncode(testData, { fields: ["html"] });
      const decoded = smartDecode(encoded.data, { fields: ["html"] });

      expect(decoded.html).toBe(testData.html);
    });

    it("should handle inline styles and attributes", () => {
      const testData = {
        html: "<div style=\"color: red; background: url('data:image/png;base64,iVBORw...')\">Test</div>",
      };

      const encoded = smartEncode(testData, { fields: ["html"] });
      const decoded = smartDecode(encoded.data, { fields: ["html"] });

      expect(decoded.html).toBe(testData.html);
    });
  });

  describe("Large Data in Browser", () => {
    it("should handle large strings without memory issues", () => {
      const largeString = "x".repeat(50000);
      const testData = { content: largeString };

      const encoded = smartEncode(testData, { fields: ["content"] });
      const decoded = smartDecode(encoded.data, { fields: ["content"] });

      expect(decoded.content).toBe(largeString);
      expect(decoded.content.length).toBe(50000);
    });

    it("should handle large arrays efficiently", () => {
      const largeArray = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        choice: `Choice ${i}`,
        feedback: `Feedback for choice ${i}`,
      }));

      const testData = { choices: largeArray };

      const startTime = performance.now();
      const encoded = smartEncode(testData, {
        fields: ["choices.choice", "choices.feedback"],
        deep: true,
      });
      const encodeTime = performance.now() - startTime;

      const decodeStart = performance.now();
      const decoded = smartDecode(encoded.data, {
        fields: ["choices.choice", "choices.feedback"],
        deep: true,
      });
      const decodeTime = performance.now() - decodeStart;

      expect(decoded.choices).toHaveLength(500);
      expect(decoded.choices[0].choice).toBe("Choice 0");
      expect(decoded.choices[499].feedback).toBe("Feedback for choice 499");

      expect(encodeTime).toBeLessThan(3000);
      expect(decodeTime).toBeLessThan(3000);
    });
  });

  describe("API Response Scenarios", () => {
    it("should decode API responses with base64 fields", () => {
      const apiResponse = {
        id: 2246,
        questionId: 6998,
        question:
          "PHA+V2hpY2ggU1FMIHF1ZXJ5IGNvcnJlY3RseSByZXRyaWV2ZXMgdGhlIGZpcnN0IDEwMCByb3dzPzwvcD4=",
        choices: [
          {
            choice: "U0VMRUNUICogRlJPTSBzYWxlc19kZXRhaWwgTElNSVQgMTAwOw==",
            feedback: "Q29ycmVjdCEgVXNlcyB0aGUgTElNSVQgY2xhdXNlLg==",
          },
        ],
      };

      const decoded = DataTransformer.decodeFromAPI(apiResponse, {
        fields: ["question", "choices.choice", "choices.feedback"],
        deep: true,
      });

      expect(decoded.question).toContain("Which SQL query");
      expect(decoded.choices[0].choice).toContain("SELECT * FROM");
      expect(decoded.choices[0].feedback).toContain("Correct!");
    });

    it("should handle mixed encoded/plain data from API", () => {
      const apiResponse = {
        id: 123,
        name: "Test Assignment",
        question: "RW5jb2RlZCBxdWVzdGlvbg==",
        createdAt: "2024-01-01T00:00:00Z",
      };

      const decoded = DataTransformer.decodeFromAPI(apiResponse, {
        fields: ["question"],
      });

      expect(decoded.id).toBe(123);
      expect(decoded.name).toBe("Test Assignment");
      expect(decoded.question).toBe("Encoded question");
      expect(decoded.createdAt).toBe("2024-01-01T00:00:00Z");
    });
  });

  describe("Edge Cases with Compression Prefix", () => {
    it("should handle comp: prefix correctly", () => {
      const longText = "x".repeat(10000);
      const encoder = new TextEncoder();
      const encoded = encoder.encode(longText);
      const binaryString = Array.from(encoded, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      const base64 = btoa(binaryString);
      const withPrefix = "comp:" + base64;

      const decoded = smartDecode({ text: withPrefix }, { fields: ["text"] });

      expect(decoded.text).toBe(longText);
    });

    it("should handle comp: prefix with multiple encoding layers", () => {
      const text = "Test content";
      const encoder = new TextEncoder();

      const encoded1 = encoder.encode(text);
      const binary1 = Array.from(encoded1, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      const base64_1 = btoa(binary1);

      const encoded2 = encoder.encode(base64_1);
      const binary2 = Array.from(encoded2, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      const base64_2 = btoa(binary2);
      const withPrefix = "comp:" + base64_2;

      const decoded = smartDecode({ text: withPrefix }, { fields: ["text"] });

      expect(decoded.text).toBe(text);
    });
  });

  describe("Type Coercion and Mixed Types", () => {
    it("should handle number to string coercion", () => {
      const testData = {
        choice: 123 as any,
        normalField: "string",
      };

      const encoded = smartEncode(testData, {
        fields: ["choice", "normalField"],
      });

      const decoded = smartDecode(encoded.data, {
        fields: ["choice", "normalField"],
      });

      expect(decoded.normalField).toBe("string");
    });

    it("should handle boolean values", () => {
      const testData = {
        isCorrect: true,
        isGraded: false,
      };

      const encoded = smartEncode(testData, { deep: true });
      const decoded = smartDecode(encoded.data, { deep: true });

      expect(decoded.isCorrect).toBe(true);
      expect(decoded.isGraded).toBe(false);
    });

    it("should handle Date objects", () => {
      const testData = {
        submittedAt: new Date("2024-01-01T00:00:00Z"),
        content: "Test",
      };

      const encoded = smartEncode(testData, { fields: ["content"] });

      expect(encoded.data.submittedAt).toBeDefined();
    });
  });

  describe("Caching Behavior", () => {
    it("should handle cache correctly", () => {
      const testData = {
        id: 1,
        content: "Cached content",
      };

      const encoded1 = smartEncode(testData, { fields: ["content"] });
      const encoded2 = smartEncode(testData, { fields: ["content"] });

      expect(encoded1.data.content).toBe(encoded2.data.content);

      const decoded1 = smartDecode(encoded1.data, { fields: ["content"] });
      const decoded2 = smartDecode(encoded2.data, { fields: ["content"] });

      expect(decoded1.content).toBe("Cached content");
      expect(decoded2.content).toBe("Cached content");
    });
  });

  describe("Error Handling in Browser", () => {
    it("should handle malformed base64 without crashing", () => {
      const malformed = "SGVsbG8gV29ybGQ=!!!invalid!!!";

      expect(() => {
        const decoded = smartDecode({ text: malformed }, { fields: ["text"] });
        expect(decoded.text).toBeDefined();
      }).not.toThrow();
    });

    it("should handle atob errors gracefully", () => {
      const invalidBase64 = "This is not base64!";

      expect(() => {
        const decoded = smartDecode(
          { text: invalidBase64 },
          { fields: ["text"] },
        );
        expect(decoded.text).toBe(invalidBase64);
      }).not.toThrow();
    });

    it("should handle TextDecoder errors", () => {
      const invalidUtf8 = "\uD800";

      expect(() => {
        const encoded = smartEncode(
          { text: invalidUtf8 },
          { fields: ["text"] },
        );
        expect(encoded.data).toBeDefined();
      }).not.toThrow();
    });
  });

  describe("Field Configuration Edge Cases", () => {
    it("should respect deep: false configuration", () => {
      const testData = {
        level1: {
          level2: {
            content: "Should not be processed",
          },
        },
        topLevel: "Should be processed",
      };

      const encoded = smartEncode(testData, {
        fields: ["topLevel"],
        deep: false,
      });

      expect(encoded.data.topLevel).not.toBe(testData.topLevel);
      expect(encoded.data.level1.level2.content).toBe(
        testData.level1.level2.content,
      );
    });

    it("should handle exclude with deep structures", () => {
      const testData = {
        id: 123,
        nested: {
          id: 456,
          content: "Test",
        },
      };

      const encoded = smartEncode(testData, {
        fields: ["id", "nested.content"],
        exclude: ["id"],
        deep: true,
      });

      expect(encoded.data.id).toBe(123);
      expect(encoded.data.nested.id).toBe(456);
      expect(encoded.data.nested.content).not.toBe(testData.nested.content);
    });
  });

  describe("Metadata Validation", () => {
    it("should provide accurate metadata", () => {
      const testData = {
        introduction: "This is an introduction",
        question: "What is the question?",
        normalField: 123,
      };

      const result = smartEncode(testData, {
        fields: ["introduction", "question"],
      });

      expect(result.metadata.transformedFields).toContain("introduction");
      expect(result.metadata.transformedFields).toContain("question");
      expect(result.metadata.originalSize).toBeGreaterThan(0);
      expect(result.metadata.transformedSize).toBeGreaterThan(0);
      expect(result.metadata.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("should track compression ratio", () => {
      const longText = "a".repeat(10000);
      const testData = { content: longText };

      const result = smartEncode(testData, { fields: ["content"] });

      expect(result.metadata.compressionRatio).toBeDefined();
      expect(result.metadata.encodedSize).toBeDefined();
    });
  });

  describe("Regression Tests for Browser Issues", () => {
    it("should handle Chrome-specific edge cases", () => {
      const testData = {
        text: "Test\u2028line\u2029separator",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });

    it("should handle Safari-specific edge cases", () => {
      const testData = {
        text: "Test with various whitespace\u00A0\u2000\u2001",
      };

      const encoded = smartEncode(testData, { fields: ["text"] });
      const decoded = smartDecode(encoded.data, { fields: ["text"] });

      expect(decoded.text).toBe(testData.text);
    });
  });

  describe("Security Considerations", () => {
    it("should handle potential XSS payloads safely", () => {
      const xssPayload = {
        html: '<img src=x onerror="alert(1)">',
      };

      const encoded = smartEncode(xssPayload, { fields: ["html"] });
      const decoded = smartDecode(encoded.data, { fields: ["html"] });

      expect(decoded.html).toBe(xssPayload.html);
    });

    it("should handle data URLs safely", () => {
      const testData = {
        content: "data:text/html,<script>alert('xss')</script>",
      };

      const encoded = smartEncode(testData, { fields: ["content"] });
      const decoded = smartDecode(encoded.data, { fields: ["content"] });

      expect(decoded.content).toBe(testData.content);
    });
  });
});
