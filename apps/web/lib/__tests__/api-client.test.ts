import { APIClient, APIError } from "../api-client";
import { DataTransformer } from "../../app/Helpers/data-transformer";

// Mock the DataTransformer
jest.mock("../../app/Helpers/data-transformer", () => ({
  DataTransformer: {
    encodeForAPI: jest.fn(),
    decodeFromAPI: jest.fn(),
  },
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("APIClient Data Transformation", () => {
  let apiClient: APIClient;

  beforeEach(() => {
    jest.clearAllMocks();
    apiClient = new APIClient({
      baseURL: "http://localhost:3000",
      autoTransform: true,
      transformConfig: {
        fields: [
          "introduction",
          "instructions",
          "learnerTextResponse",
          "learnerChoices",
        ],
        deep: true,
      },
    });
  });

  describe("Request Encoding", () => {
    it("should encode learnerTextResponse fields in assignment submission", async () => {
      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, gradingJobId: "123" }),
      });

      // Mock DataTransformer to return encoded data
      const mockEncodedData = {
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "PHA+dGVzdDwvcD4=", // base64 encoded "<p>test</p>"
            learnerChoices: ["VXNlIHRoZSBASW5qZWN0YWJsZSgp"], // base64 encoded choice
          },
        ],
      };
      (DataTransformer.encodeForAPI as jest.Mock).mockReturnValue({
        data: mockEncodedData,
      });

      const requestData = {
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<p>test</p>",
            learnerChoices: ["Use the @Injectable()"],
          },
        ],
      };

      await apiClient.patch("/api/assignments/1/attempts/1", requestData);

      // Verify DataTransformer.encodeForAPI was called with correct config
      expect(DataTransformer.encodeForAPI).toHaveBeenCalledWith(
        requestData,
        expect.objectContaining({
          fields: expect.arrayContaining([
            "learnerTextResponse",
            "learnerChoices",
          ]),
          deep: true,
        }),
      );

      // Verify fetch was called with encoded data
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/assignments/1/attempts/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify(mockEncodedData),
        }),
      );
    });

    it("should handle complex nested learner responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const complexData = {
        submitted: true,
        responsesForQuestions: [
          {
            id: 1,
            learnerTextResponse: "<p>Complex <strong>HTML</strong> content</p>",
            learnerChoices: [
              "Choice with special chars: @Injectable()",
              "Another choice with <em>HTML</em>",
            ],
          },
          {
            id: 2,
            learnerTextResponse: "<div>Another response</div>",
            learnerChoices: ["Simple choice"],
          },
        ],
      };

      (DataTransformer.encodeForAPI as jest.Mock).mockReturnValue({
        data: complexData,
      });

      await apiClient.post("/api/test", complexData);

      expect(DataTransformer.encodeForAPI).toHaveBeenCalledWith(
        complexData,
        expect.objectContaining({
          fields: expect.arrayContaining([
            "learnerTextResponse",
            "learnerChoices",
          ]),
          deep: true,
        }),
      );
    });

    it("should skip transformation when autoTransform is false", async () => {
      const clientNoTransform = new APIClient({
        baseURL: "http://localhost:3000",
        autoTransform: false,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const data = {
        learnerTextResponse: "<p>test</p>",
      };

      await clientNoTransform.post("/api/test", data);

      expect(DataTransformer.encodeForAPI).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/test",
        expect.objectContaining({
          body: JSON.stringify(data),
        }),
      );
    });
  });

  describe("Response Decoding", () => {
    it("should decode response data", async () => {
      const encodedResponse = {
        introduction: "V2VsY29tZSE=", // base64 encoded "Welcome!"
        learnerTextResponse: "PHA+dGVzdDwvcD4=", // base64 encoded "<p>test</p>"
      };

      const decodedResponse = {
        introduction: "Welcome!",
        learnerTextResponse: "<p>test</p>",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => encodedResponse,
      });

      (DataTransformer.decodeFromAPI as jest.Mock).mockReturnValue(
        decodedResponse,
      );

      const result = await apiClient.get("/api/test");

      expect(DataTransformer.decodeFromAPI).toHaveBeenCalledWith(
        encodedResponse,
        expect.objectContaining({
          fields: expect.arrayContaining([
            "introduction",
            "learnerTextResponse",
          ]),
          deep: true,
        }),
      );

      expect(result).toEqual(decodedResponse);
    });
  });

  describe("Error Handling", () => {
    it("should throw APIError on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      await expect(apiClient.get("/api/test")).rejects.toThrow(APIError);
    });

    it("should handle transformation errors gracefully", async () => {
      (DataTransformer.encodeForAPI as jest.Mock).mockImplementation(() => {
        throw new Error("Transformation failed");
      });

      await expect(
        apiClient.post("/api/test", { learnerTextResponse: "<p>test</p>" }),
      ).rejects.toThrow("Transformation failed");
    });
  });
});
