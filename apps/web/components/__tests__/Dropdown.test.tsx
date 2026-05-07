/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Dropdown from "../Dropdown";

describe("Dropdown", () => {
  const baseItems = [
    { value: "a", label: "A" },
    { value: "es", label: "Spanish" },
  ];

  it("opens the menu and selects an item when not disabled", () => {
    const setSelectedItem = jest.fn();

    render(
      <Dropdown
        items={baseItems}
        selectedItem=""
        setSelectedItem={setSelectedItem}
      />,
    );

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    const itemA = screen.getByText("A");
    fireEvent.click(itemA);

    expect(setSelectedItem).toHaveBeenCalledWith("a");
  });

  it.each([
    {
      name: "blocks open and never calls setSelectedItem when disabled",
      disabled: true as const,
    },
  ])("$name", ({ disabled }) => {
    const setSelectedItem = jest.fn();

    render(
      <Dropdown
        items={baseItems}
        selectedItem=""
        setSelectedItem={setSelectedItem}
        disabled={disabled}
      />,
    );

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    expect(screen.queryByText("A")).toBeNull();
    expect(setSelectedItem).not.toHaveBeenCalled();
  });

  it("renders the disabledTooltip text in the DOM when disabled and disabledTooltip is set", () => {
    const setSelectedItem = jest.fn();

    render(
      <Dropdown
        items={baseItems}
        selectedItem=""
        setSelectedItem={setSelectedItem}
        disabled={true}
        disabledTooltip="Tooltip copy here."
      />,
    );

    expect(screen.getByText("Tooltip copy here.")).toBeInTheDocument();
  });

  it("does not render any tooltip text when disabled but no disabledTooltip is provided", () => {
    const setSelectedItem = jest.fn();

    render(
      <Dropdown
        items={baseItems}
        selectedItem=""
        setSelectedItem={setSelectedItem}
        disabled={true}
      />,
    );

    expect(screen.queryByText(/Tooltip/)).toBeNull();
  });

  it("still shows the selected item's label when disabled", () => {
    const setSelectedItem = jest.fn();

    render(
      <Dropdown
        items={baseItems}
        selectedItem="es"
        setSelectedItem={setSelectedItem}
        disabled={true}
      />,
    );

    expect(screen.getByText("Spanish")).toBeInTheDocument();
  });
});
