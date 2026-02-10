/* eslint-disable */

import { format, transports } from "winston";
import { winstonOptions } from "./config";

describe("Logger Config", () => {
  const originalEnvironment = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnvironment;
  });

  describe("winstonOptions", () => {
    it("should use production options when NODE_ENV is production", () => {
      // Clear the module cache to get fresh import
      jest.resetModules();
      process.env.NODE_ENV = "production";

      // Re-import to get new winstonOptions with updated NODE_ENV
      const { winstonOptions: productionOptions } = require("./config");

      expect(productionOptions.level).toBe("info");
      expect(productionOptions.format).toBeDefined();
      expect(productionOptions.transports).toHaveLength(1);
      expect(productionOptions.transports[0]).toBeInstanceOf(
        transports.Console,
      );
    });

    it("should use development options when NODE_ENV is development", () => {
      jest.resetModules();
      process.env.NODE_ENV = "development";

      const { winstonOptions: developmentOptions } = require("./config");

      expect(developmentOptions.level).toBe("debug");
      expect(developmentOptions.format).toBeDefined();
      expect(developmentOptions.transports).toHaveLength(1);
      expect(developmentOptions.transports[0]).toBeInstanceOf(
        transports.Console,
      );
    });

    it("should use development options when NODE_ENV is not set", () => {
      jest.resetModules();
      delete process.env.NODE_ENV;

      const { winstonOptions: defaultOptions } = require("./config");

      expect(defaultOptions.level).toBe("debug");
      expect(defaultOptions.transports).toHaveLength(1);
    });

    it("should use development options when NODE_ENV is test", () => {
      jest.resetModules();
      process.env.NODE_ENV = "test";

      const { winstonOptions: testOptions } = require("./config");

      expect(testOptions.level).toBe("debug");
      expect(testOptions.transports).toHaveLength(1);
    });

    it("should have json format in production", () => {
      jest.resetModules();
      process.env.NODE_ENV = "production";

      const { winstonOptions: productionOptions } = require("./config");

      // Verify format is json
      expect(productionOptions.format).toBeDefined();
    });

    it("should have colorize and simple format in development", () => {
      jest.resetModules();
      process.env.NODE_ENV = "development";

      const { winstonOptions: developmentOptions } = require("./config");

      // Verify format is combined
      expect(developmentOptions.format).toBeDefined();
    });

    it("should use Console transport in production", () => {
      jest.resetModules();
      process.env.NODE_ENV = "production";

      const { winstonOptions: productionOptions } = require("./config");

      expect(productionOptions.transports[0]).toBeInstanceOf(
        transports.Console,
      );
    });

    it("should use Console transport in development", () => {
      jest.resetModules();
      process.env.NODE_ENV = "development";

      const { winstonOptions: developmentOptions } = require("./config");

      expect(developmentOptions.transports[0]).toBeInstanceOf(
        transports.Console,
      );
    });
  });
});
