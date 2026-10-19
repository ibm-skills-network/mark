/** @jest-environment node */

jest.mock("react-pdftotext", () => {
  throw new ReferenceError("DOMMatrix is not defined");
});
jest.mock("remark", () => ({ remark: jest.fn() }));

it("loads file readers on the server without evaluating the browser PDF parser", () => {
  expect(() => require("./fileReader")).not.toThrow();
});
