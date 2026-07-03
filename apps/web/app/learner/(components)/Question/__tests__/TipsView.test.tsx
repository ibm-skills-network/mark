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

  it("switches to the overlay variant on small screens", () => {
    const { container } = render(<TipsView />);
    expect(container.querySelector(".fixed.inset-0")).toBeNull();

    setViewportWidth(500);
    expect(container.querySelector(".fixed.inset-0")).not.toBeNull();

    setViewportWidth(1024);
    expect(container.querySelector(".fixed.inset-0")).toBeNull();
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

  it("closes the panel via the close icon", () => {
    const { container } = render(<TipsView />);
    const closeIcon = container.querySelector("svg.cursor-pointer");
    if (!closeIcon) throw new Error("close icon not found");
    fireEvent.click(closeIcon);
    expect(useAppConfig.getState().tips).toBe(false);
  });

  it("persists the don't-show-again preference", () => {
    render(<TipsView />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useAppConfig.getState().persistTips).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useAppConfig.getState().persistTips).toBe(false);
  });
});
