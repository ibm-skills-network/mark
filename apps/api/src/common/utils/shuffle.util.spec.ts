import { shuffleArray } from "./shuffle.util";

/** Returns the next value from a fixed queue — deterministic stand-in for Math.random. */
function fakeRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe("shuffleArray", () => {
  it("produces the Fisher-Yates permutation for a given RNG sequence", () => {
    // length 4 draws three values: index=3 -> floor(r*4), index=2 -> floor(r*3),
    // index=1 -> floor(r*2). All zeros rotates the first element to the end.
    const result = shuffleArray(["a", "b", "c", "d"], fakeRandom([0, 0, 0]));
    expect(result).toEqual(["b", "c", "d", "a"]);
  });

  it("can return the original order when the RNG keeps each element in place", () => {
    const result = shuffleArray(
      ["a", "b", "c", "d"],
      fakeRandom([0.99, 0.99, 0.99]),
    );
    expect(result).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves every element (is a permutation)", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffleArray(input);
    expect([...result].sort((a, b) => a - b)).toEqual(input);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c", "d"];
    const copy = [...input];
    shuffleArray(input, fakeRandom([0, 0, 0]));
    expect(input).toEqual(copy);
  });

  it("handles empty and single-element arrays", () => {
    expect(shuffleArray([])).toEqual([]);
    expect(shuffleArray(["only"])).toEqual(["only"]);
  });
});
