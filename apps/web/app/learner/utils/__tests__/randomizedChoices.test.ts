import { parseRandomizedChoices } from "../randomizedChoices";

describe("parseRandomizedChoices", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts the array the attempt read now sends", () => {
    expect(
      parseRandomizedChoices([
        { id: 2, choice: "B" },
        { id: 1, choice: "A" },
      ]),
    ).toEqual([
      { id: 2, choice: "B" },
      { id: 1, choice: "A" },
    ]);
  });

  it("still accepts the legacy JSON string", () => {
    expect(
      parseRandomizedChoices(
        JSON.stringify([
          { id: null, choice: "B" },
          { id: 1, choice: "A" },
        ]),
      ),
    ).toEqual([
      { id: null, choice: "B" },
      { id: 1, choice: "A" },
    ]);
  });

  it("treats null, an unparsable string and non-arrays as null", () => {
    expect(parseRandomizedChoices(null)).toBeNull();
    expect(parseRandomizedChoices(undefined)).toBeNull();
    expect(parseRandomizedChoices("not json")).toBeNull();
    expect(parseRandomizedChoices("false")).toBeNull();
    expect(parseRandomizedChoices(true)).toBeNull();
  });

  it("drops entries without a text choice", () => {
    expect(
      parseRandomizedChoices([{ id: 1, choice: "A" }, { id: 2 }, null, "x"]),
    ).toEqual([{ id: 1, choice: "A" }]);
  });
});
