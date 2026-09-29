import {
  authorSessionHeaders,
  bindAuthorSession,
  learnerSuccessPath,
} from "../author-session";

beforeEach(() => window.history.replaceState({}, "", "/"));
afterEach(() => window.history.replaceState({}, "", "/"));

it("sends the editor identity and quiz context even without a referrer", () => {
  window.history.replaceState({}, "", "/author/4892/questions");
  bindAuthorSession(4892, "author@example.test");
  expect(authorSessionHeaders()).toEqual({
    "x-mark-author-assignment": "4892",
    "x-mark-author-user": "author@example.test",
  });
  expect(authorSessionHeaders(false)).toEqual({
    "x-mark-author-assignment": "4892",
  });
});

it("selects learner context without the author editor identity", () => {
  bindAuthorSession(4892, "author@example.test");
  window.history.replaceState({}, "", "/learner/4892");
  expect(authorSessionHeaders()).toEqual({
    "x-mark-learner-assignment": "4892",
  });
});

it("does not carry an editor identity into another quiz", () => {
  bindAuthorSession(4892, "author@example.test");
  window.history.replaceState({}, "", "/author/4941/questions");
  expect(authorSessionHeaders()).toEqual({
    "x-mark-author-assignment": "4941",
  });
});

it("selects author context only for deliberate author previews", () => {
  window.history.replaceState(
    {},
    "",
    "/learner/4892/questions?authorMode=true",
  );
  expect(authorSessionHeaders(false)).toEqual({
    "x-mark-author-assignment": "4892",
  });
});

it("keeps an author preview in author context on the results page", () => {
  window.history.replaceState(
    {},
    "",
    "/learner/4892/questions?authorMode=true&lang=en",
  );
  expect(learnerSuccessPath(4892, 77)).toBe(
    "/learner/4892/successPage/77?authorMode=true",
  );
});

it("leaves a learner's results path untouched", () => {
  window.history.replaceState({}, "", "/learner/4892/questions?lang=en");
  expect(learnerSuccessPath(4892, 77)).toBe("/learner/4892/successPage/77");
});
