/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { useAppConfig } from "@/stores/appConfig";
import TipsView from "../TipsView";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

describe("TipsView", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    act(() => {
      useAppConfig.setState({ tips: true, persistTips: false });
    });
    setViewportWidth(1024);
  });

  it("renders the tips sections on desktop", () => {
    render(<TipsView />);
    expect(screen.getByText("Tips")).toBeInTheDocument();
    expect(screen.getByText("Language Assistance")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  it("switches to the sheet variant on small screens", () => {
    const { container } = render(<TipsView />);
    expect(screen.queryByRole("dialog")).toBeNull();

    setViewportWidth(500);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    setViewportWidth(1024);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector(".fixed")).toBeNull();
  });

  it("supports dark mode on both variants", () => {
    const { container } = render(<TipsView />);
    // Desktop card surface adapts to dark mode.
    expect(container.querySelector(".dark\\:bg-gray-800")).not.toBeNull();
    // Headings turn light in dark mode.
    expect(screen.getByText("Tips").className).toContain("dark:text-gray-100");

    setViewportWidth(500);
    expect(container.querySelector(".dark\\:bg-gray-800")).not.toBeNull();
    expect(screen.getByText("Tips").className).toContain("dark:text-gray-100");
  });

  it("closes the panel via a labelled close button on desktop", () => {
    render(<TipsView />);
    fireEvent.click(screen.getByRole("button", { name: /close tips/i }));
    expect(useAppConfig.getState().tips).toBe(false);
  });

  it("persists the don't-show-again preference", () => {
    render(<TipsView />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useAppConfig.getState().persistTips).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useAppConfig.getState().persistTips).toBe(false);
  });

  describe("small viewports", () => {
    beforeEach(() => {
      setViewportWidth(393);
    });

    it("never paints over the header, which holds the submit button", () => {
      const { container } = render(<TipsView />);

      // A viewport-fixed layer sits on top of the header; the sheet has to stay
      // inside the question area it is rendered in.
      expect(container.querySelector(".fixed")).toBeNull();
      expect(
        container.querySelector('[data-testid="tips-sheet-backdrop"]')
          ?.className,
      ).toContain("absolute");
    });

    it("exposes a dialog with an accessible name and close button", () => {
      render(<TipsView />);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAccessibleName("Tips");
      expect(
        screen.getByRole("button", { name: /close tips/i }),
      ).toBeInTheDocument();
    });

    it("closes on the close button", () => {
      render(<TipsView />);
      fireEvent.click(screen.getByRole("button", { name: /close tips/i }));
      expect(useAppConfig.getState().tips).toBe(false);
    });

    it("closes on the confirmation button", () => {
      render(<TipsView />);
      fireEvent.click(screen.getByRole("button", { name: /got it/i }));
      expect(useAppConfig.getState().tips).toBe(false);
    });

    it("closes when the backdrop is tapped but not when the sheet is", () => {
      render(<TipsView />);

      fireEvent.click(screen.getByRole("dialog"));
      expect(useAppConfig.getState().tips).toBe(true);

      fireEvent.click(screen.getByTestId("tips-sheet-backdrop"));
      expect(useAppConfig.getState().tips).toBe(false);
    });

    it("closes on Escape", () => {
      render(<TipsView />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(useAppConfig.getState().tips).toBe(false);
    });

    it("remembers the dismissal so it does not return on the next load", () => {
      render(<TipsView />);
      fireEvent.click(screen.getByRole("button", { name: /close tips/i }));

      expect(sessionStorage.getItem("appConfig.tipsDismissedForSession")).toBe(
        "true",
      );
    });

    it("moves focus into the sheet and returns it on close", () => {
      const opener = document.createElement("button");
      opener.textContent = "open";
      document.body.append(opener);
      opener.focus();

      const view = render(<TipsView />);
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
        true,
      );

      view.unmount();
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });

    it("keeps Tab inside the sheet", () => {
      render(<TipsView />);
      const dialog = screen.getByRole("dialog");
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>("button, input"),
      );
      const last = focusable[focusable.length - 1];

      last.focus();
      fireEvent.keyDown(dialog, { key: "Tab" });

      expect(document.activeElement).toBe(focusable[0]);
    });
  });
});
