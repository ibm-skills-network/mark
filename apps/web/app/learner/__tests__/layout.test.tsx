/**
 * @jest-environment jsdom
 */

import { createElement } from "react";
import { render } from "@testing-library/react";
import LearnerRouteShell from "../layout";

// The shell used to size its content pane from a hard-coded header height
// (100vh minus 80 or 100 px). Whenever the header was taller than that number
// — which the stacked header is, at every width it is used — the route grew
// past the viewport and scrolled the header, and its submit button, out of
// view. The pane is now sized by the layout instead.

jest.mock("../(components)/Header", () => ({
  __esModule: true,
  default: () => createElement("header", null, "header"),
}));
jest.mock("@/components/RouteUiTranslator", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/promo/PromoProvider", () => ({
  __esModule: true,
  default: (props: { children?: React.ReactNode }) => props.children,
}));

const classesOf = (element: Element | null) =>
  new Set((element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

describe("learner route shell", () => {
  it("fills the viewport exactly and lets the content pane take what is left", () => {
    const { container } = render(
      createElement(LearnerRouteShell, {
        children: createElement("main", { "data-testid": "route" }, "content"),
      }),
    );

    const root = container.querySelector("#learner-route-root");
    expect(root).not.toBeNull();

    // A definite height, so the flex column has a main size to distribute.
    expect(classesOf(root).has("h-screen")).toBe(true);
    expect(classesOf(root).has("min-h-screen")).toBe(false);

    const contentPane = root?.querySelector(":scope > div");
    expect(contentPane).not.toBeNull();
    expect(classesOf(contentPane).has("flex-1")).toBe(true);
    expect(classesOf(contentPane).has("min-h-0")).toBe(true);
    expect(classesOf(contentPane).has("overflow-auto")).toBe(true);
  });
});
