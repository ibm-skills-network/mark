/* eslint-disable */

import { AppService } from "./app.service";

describe("AppService", () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("root", () => {
    it("should return a greeting", () => {
      const result = service.root();
      expect(result).toBe("👋\n");
    });

    it("should return a string", () => {
      const result = service.root();
      expect(typeof result).toBe("string");
    });
  });
});
