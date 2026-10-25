import { NextFunction, Request, Response } from "express";
import {
  INTERNAL_CONTRACT_HEADER,
  INTERNAL_CONTRACT_VERSION,
  InternalContractMiddleware,
} from "./internal-contract.middleware";

describe("InternalContractMiddleware", () => {
  it("stamps the contract version on the response and continues", () => {
    const setHeader = jest.fn();
    const next: NextFunction = jest.fn();

    new InternalContractMiddleware().use(
      {} as Request,
      { setHeader } as unknown as Response,
      next,
    );

    expect(setHeader).toHaveBeenCalledWith(
      INTERNAL_CONTRACT_HEADER,
      String(INTERNAL_CONTRACT_VERSION),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("speaks contract 1 until an internal shape changes", () => {
    // The Rust API's default minimum is 1; raising this without raising that
    // minimum is harmless, lowering it is not.
    expect(INTERNAL_CONTRACT_VERSION).toBeGreaterThanOrEqual(1);
    expect(INTERNAL_CONTRACT_HEADER).toBe("x-mark-internal-contract");
  });
});
