import { authorSessionHeaders, bindAuthorSession } from "../author-session";

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

it("does not send author context to learner previews", () => {
  bindAuthorSession(4892, "author@example.test");
  window.history.replaceState({}, "", "/learner/4892");
  expect(authorSessionHeaders()).toEqual({});
});

it("does not carry an editor identity into another quiz", () => {
  bindAuthorSession(4892, "author@example.test");
  window.history.replaceState({}, "", "/author/4941/questions");
  expect(authorSessionHeaders()).toEqual({
    "x-mark-author-assignment": "4941",
  });
});
