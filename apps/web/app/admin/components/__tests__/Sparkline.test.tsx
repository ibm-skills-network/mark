/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { Sparkline } from "../Sparkline";

describe("Sparkline", () => {
  it("renders no polyline for an empty series", () => {
    const { container } = render(<Sparkline values={[]} label="empty" />);
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("renders a polyline with one point per sample", () => {
    const { container } = render(
      <Sparkline values={[0, 5, 10, 5]} label="series" />,
    );
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline?.getAttribute("points") ?? "";
    expect(points.trim().split(/\s+/)).toHaveLength(4);
  });

  it("exposes an accessible label", () => {
    render(<Sparkline values={[1, 2]} label="failed history" />);
    expect(screen.getByRole("img", { name: "failed history" })).toBeTruthy();
  });
});
