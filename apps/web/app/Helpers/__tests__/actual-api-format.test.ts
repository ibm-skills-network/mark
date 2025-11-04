import { DataTransformer } from "../data-transformer";
import { API_DECODE_CONFIG } from "../transform-config";

/**
 * Test with the ACTUAL API response format from production
 */
describe("Actual API Response Format", () => {
  it("should decode choices that come as a JSON string", () => {
    // This is the EXACT format from the user's API response
    const apiResponse = {
      id: 2246,
      questionId: 6998,
      totalPoints: 2,
      type: "SINGLE_CORRECT",
      responseType: "OTHER",
      question:
        "PHA+V2hpY2ggU1FMIHF1ZXJ5IGNvcnJlY3RseSByZXRyaWV2ZXMgdGhlIGZpcnN0IDEwMCByb3dzIGZyb20gdGhlIHNhbGVzX2RldGFpbCB0YWJsZSBpbiBQb3N0Z3JlU1FMPzwvcD4=",
      maxWords: null,
      scoring: null,
      // NOTE: choices comes as a JSON STRING, not an array!
      choices:
        '[{"choice":"U0VMRUNUICogRlJPTSBzYWxlc19kZXRhaWwgTElNSVQgMTAwOw==","isCorrect":true,"points":2,"feedback":"Q29ycmVjdCEgVGhpcyBxdWVyeSByZXRyaWV2ZXMgdGhlIGZpcnN0IDEwMCByb3dzIGZyb20gdGhlIHNhbGVzX2RldGFpbCB0YWJsZSB1c2luZyB0aGUgTElNSVQgY2xhdXNlLg=="},{"choice":"U0VMRUNUIFRPUCAxMDAgKiBGUk9NIHNhbGVzX2RldGFpbDs=","isCorrect":false,"points":0,"feedback":"SW5jb3JyZWN0LiBUaGUgVE9QIGNsYXVzZSBpcyB1c2VkIGluIFNRTCBTZXJ2ZXIsIG5vdCBpbiBQb3N0Z3JlU1FMLg=="}]',
      randomizedChoices: true,
    };

    console.log("\n=== BEFORE DECODE ===");
    console.log("Question (base64):", apiResponse.question);
    console.log("Choices type:", typeof apiResponse.choices);
    console.log(
      "Choices value:",
      apiResponse.choices.substring(0, 100) + "...",
    );

    // Decode using the DataTransformer
    const decoded = DataTransformer.decodeFromAPI(
      apiResponse,
      API_DECODE_CONFIG,
    );

    console.log("\n=== AFTER DECODE ===");
    console.log("Question:", decoded.question);
    console.log("Choices type:", typeof decoded.choices);
    console.log("Choices:", JSON.stringify(decoded.choices, null, 2));

    // Verify the question is decoded
    expect(decoded.question).toBe(
      "<p>Which SQL query correctly retrieves the first 100 rows from the sales_detail table in PostgreSQL?</p>",
    );

    // Verify choices is now an array (parsed from JSON string)
    expect(Array.isArray(decoded.choices)).toBe(true);
    expect(decoded.choices).toHaveLength(2);

    // Verify the first choice is decoded
    expect(decoded.choices[0].choice).toBe(
      "SELECT * FROM sales_detail LIMIT 100;",
    );
    expect(decoded.choices[0].feedback).toBe(
      "Correct! This query retrieves the first 100 rows from the sales_detail table using the LIMIT clause.",
    );

    // Verify the second choice is decoded
    expect(decoded.choices[1].choice).toBe(
      "SELECT TOP 100 * FROM sales_detail;",
    );
    expect(decoded.choices[1].feedback).toBe(
      "Incorrect. The TOP clause is used in SQL Server, not in PostgreSQL.",
    );
  });

  it("should handle the full questionVersions structure", () => {
    const apiResponse = {
      id: 1025,
      questionVersions: [
        {
          id: 2246,
          questionId: 6998,
          question:
            "PHA+V2hpY2ggU1FMIHF1ZXJ5IGNvcnJlY3RseSByZXRyaWV2ZXMgdGhlIGZpcnN0IDEwMCByb3dzIGZyb20gdGhlIHNhbGVzX2RldGFpbCB0YWJsZSBpbiBQb3N0Z3JlU1FMPzwvcD4=",
          choices:
            '[{"choice":"U0VMRUNUICogRlJPTSBzYWxlc19kZXRhaWwgTElNSVQgMTAwOw==","isCorrect":true,"points":2,"feedback":"Q29ycmVjdCEgVGhpcyBxdWVyeSByZXRyaWV2ZXMgdGhlIGZpcnN0IDEwMCByb3dzIGZyb20gdGhlIHNhbGVzX2RldGFpbCB0YWJsZSB1c2luZyB0aGUgTElNSVQgY2xhdXNlLg=="}]',
        },
      ],
    };

    const decoded = DataTransformer.decodeFromAPI(
      apiResponse,
      API_DECODE_CONFIG,
    );

    console.log("\n=== QUESTION VERSIONS STRUCTURE ===");
    console.log(
      "Question:",
      decoded.questionVersions[0].question.substring(0, 50) + "...",
    );
    console.log("Choices:", decoded.questionVersions[0].choices);

    expect(decoded.questionVersions[0].question).toContain(
      "Which SQL query correctly retrieves",
    );
    expect(Array.isArray(decoded.questionVersions[0].choices)).toBe(true);
    expect(decoded.questionVersions[0].choices[0].choice).toBe(
      "SELECT * FROM sales_detail LIMIT 100;",
    );
    expect(decoded.questionVersions[0].choices[0].feedback).toContain(
      "Correct! This query retrieves",
    );
  });
});
